/**
 * Script de migration CRM Selfizee (MySQL dump) → PostgreSQL (Prisma)
 *
 * Usage:
 *   npx ts-node scripts/migrate-from-crm.ts <dossier-sql/>                     (tout migrer)
 *   npx ts-node scripts/migrate-from-crm.ts <dossier-sql/> --only=devis        (une table)
 *   npx ts-node scripts/migrate-from-crm.ts <dossier-sql/> --only=clients,devis (plusieurs)
 *   npx ts-node scripts/migrate-from-crm.ts <dump.sql>                          (mode legacy)
 *
 * Tables disponibles pour --only :
 *   clients, client_contacts, clients_has_secteurs_activites,
 *   devis, devis_factures, avoirs, reglements
 *
 * Mode dossier : lit chaque table depuis son fichier SQL dédié en streaming.
 * Mode fichier : charge un seul dump SQL complet en mémoire (legacy).
 */

import { PrismaClient, ClientType, TypeCommercial, DevisStatus, FactureStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Single connection + high timeout for bulk inserts over remote connections
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('connection_limit')) {
  const sep = process.env.DATABASE_URL.includes('?') ? '&' : '?';
  process.env.DATABASE_URL += `${sep}connection_limit=1&pool_timeout=300`;
}
const prisma = new PrismaClient();

// ── Mapping table → fichier ─────────────────────────────────────

const TABLE_FILE_MAP: Record<string, string | null> = {
  payss:                            'payss.sql',
  groupe_clients:                   'groupe_clients.sql',
  source_leads:                     null,   // fichier absent → ignoré
  secteurs_activites:               'secteurs_activites.sql',
  contact_types:                    null,   // fichier absent → ignoré
  users:                            null,   // fichier absent → ignoré
  moyen_reglements:                 'moyen_reglements(1).sql',
  clients:                          'clients.sql',
  clients_has_secteurs_activites:   'clients_has_secteurs_activites.sql',
  client_contacts:                  'client_contacts.sql',
  devis:                            'devis.sql',
  devis_factures:                   'devis_factures.sql',
  avoirs:                           'avoirs.sql',
  reglements:                       'reglements.sql',
  reglements_has_devis_factures:    'reglements_has_devis_factures.sql',
  reglements_has_avoirs:            'reglements_has_avoirs.sql',
};

// ── SQL Parser (legacy — utilisé par mode fichier unique) ────────

function parseInserts(sql: string, tableName: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  const insertRegex = new RegExp(
    `INSERT\\s+INTO\\s+\`?${tableName}\`?\\s*\\(([^)]+)\\)\\s*VALUES\\s*(.+?)(?:;|$)`,
    'gis'
  );
  let match;
  while ((match = insertRegex.exec(sql)) !== null) {
    const columns = match[1]
      .split(',')
      .map((c) => c.trim().replace(/`/g, '').replace(/'/g, ''));
    const rows = parseValueRows(match[2]);
    for (const row of rows) {
      const obj: Record<string, any> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i] !== undefined ? row[i] : null;
      }
      results.push(obj);
    }
  }
  return results;
}

/**
 * Parse the VALUES section: (v1, v2, ...), (v1, v2, ...), ...
 */
function parseValueRows(valuesStr: string): any[][] {
  const rows: any[][] = [];
  let i = 0;
  const len = valuesStr.length;

  while (i < len) {
    while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\n' || valuesStr[i] === '\r' || valuesStr[i] === '\t' || valuesStr[i] === ',')) {
      i++;
    }
    if (i >= len || valuesStr[i] !== '(') break;
    i++;
    const values: any[] = [];

    while (i < len) {
      while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\t')) i++;
      if (i >= len || valuesStr[i] === ')') { i++; break; }

      if (valuesStr[i] === "'") {
        let str = '';
        i++;
        while (i < len) {
          if (valuesStr[i] === '\\' && i + 1 < len) {
            const next = valuesStr[i + 1];
            if (next === "'") { str += "'"; i += 2; }
            else if (next === '\\') { str += '\\'; i += 2; }
            else if (next === 'n') { str += '\n'; i += 2; }
            else if (next === 'r') { str += '\r'; i += 2; }
            else if (next === 't') { str += '\t'; i += 2; }
            else if (next === '0') { str += '\0'; i += 2; }
            else { str += next; i += 2; }
          } else if (valuesStr[i] === "'" && i + 1 < len && valuesStr[i + 1] === "'") {
            str += "'"; i += 2;
          } else if (valuesStr[i] === "'") {
            i++; break;
          } else {
            str += valuesStr[i]; i++;
          }
        }
        values.push(str);
      } else if (valuesStr.slice(i, i + 4).toUpperCase() === 'NULL') {
        values.push(null); i += 4;
      } else {
        let num = '';
        while (i < len && valuesStr[i] !== ',' && valuesStr[i] !== ')' && valuesStr[i] !== ' ') {
          num += valuesStr[i]; i++;
        }
        const parsed = parseFloat(num);
        values.push(isNaN(parsed) ? num : parsed);
      }

      while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\t')) i++;
      if (i < len && valuesStr[i] === ',') i++;
    }
    rows.push(values);
  }
  return rows;
}

// ── Streaming SQL Parsers ────────────────────────────────────────

/**
 * Charge toutes les rows d'une table depuis un fichier SQL en streaming.
 * Utilisé pour les petites tables (< 10 Mo).
 */
function parseTableFromFile(filePath: string, tableName: string): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    const results: Record<string, any>[] = [];
    const insertRegex = new RegExp(
      `INSERT\\s+INTO\\s+\`?${tableName}\`?\\s*\\(([^)]+)\\)\\s*VALUES\\s*(.+)$`,
      'is'
    );

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let stmt = '';

    rl.on('line', (line) => {
      stmt += line + '\n';
      if (line.trim().endsWith(';')) {
        const m = stmt.match(insertRegex);
        if (m) {
          const columns = m[1].split(',').map((c) => c.trim().replace(/`/g, '').replace(/'/g, ''));
          let valuesStr = m[2];
          if (valuesStr.trim().endsWith(';')) valuesStr = valuesStr.trim().slice(0, -1);
          const rows = parseValueRows(valuesStr);
          for (const row of rows) {
            const obj: Record<string, any> = {};
            for (let i = 0; i < columns.length; i++) {
              obj[columns[i]] = row[i] !== undefined ? row[i] : null;
            }
            results.push(obj);
          }
        }
        stmt = '';
      }
    });

    rl.on('close', () => resolve(results));
    rl.on('error', reject);
  });
}

/**
 * Streame une grande table SQL et appelle onRow pour chaque ligne.
 * Pause/resume readline pour ne pas accumuler des milliers de promesses Prisma.
 */
function streamTableRows(
  filePath: string,
  tableName: string,
  onRow: (row: Record<string, any>) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const insertRegex = new RegExp(
      `INSERT\\s+INTO\\s+\`?${tableName}\`?\\s*\\(([^)]+)\\)\\s*VALUES\\s*(.+)$`,
      'is'
    );

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let stmt = '';
    let columns: string[] | null = null;
    let processing = false;
    let closed = false;

    const processStatement = async (stmtStr: string) => {
      processing = true;
      rl.pause();

      const m = stmtStr.match(insertRegex);
      if (m) {
        if (!columns) {
          columns = m[1].split(',').map((c) => c.trim().replace(/`/g, '').replace(/'/g, ''));
        }
        let valuesStr = m[2];
        if (valuesStr.trim().endsWith(';')) valuesStr = valuesStr.trim().slice(0, -1);
        const rows = parseValueRows(valuesStr);
        for (const row of rows) {
          const obj: Record<string, any> = {};
          for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = row[i] !== undefined ? row[i] : null;
          }
          try {
            await onRow(obj);
          } catch (e) {
            reject(e);
            return;
          }
        }
      }

      processing = false;
      if (closed) {
        resolve();
      } else {
        rl.resume();
      }
    };

    rl.on('line', (line) => {
      stmt += line + '\n';
      if (line.trim().endsWith(';')) {
        const stmtCopy = stmt;
        stmt = '';
        processStatement(stmtCopy);
      }
    });

    rl.on('close', () => {
      closed = true;
      if (!processing) resolve();
    });

    rl.on('error', reject);
  });
}

/**
 * Charge une table en mémoire depuis un dossier, avec gestion fichier absent.
 */
async function loadTableRows(dir: string, tableName: string): Promise<Record<string, any>[]> {
  const filename = TABLE_FILE_MAP[tableName];
  if (!filename) {
    console.warn(`  [WARN] Table "${tableName}" : pas de fichier défini, ignorée.`);
    return [];
  }
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  [WARN] Fichier absent pour "${tableName}": ${path.basename(filePath)}, ignoré.`);
    return [];
  }
  console.log(`  Streaming ${filename}...`);
  const rows = await parseTableFromFile(filePath, tableName);
  console.log(`  ${tableName}: ${rows.length} lignes`);
  return rows;
}

// ── Helpers ─────────────────────────────────────────────────────

function toStr(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  // Remove null bytes (0x00) which PostgreSQL UTF8 rejects
  return String(v).replace(/\0/g, '').trim() || null;
}

function toInt(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function toDecimal(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function toDate(v: any): Date | null {
  if (v === null || v === undefined || v === '' || v === '0000-00-00' || v === '0000-00-00 00:00:00') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toBool(v: any): boolean {
  if (v === null || v === undefined) return false;
  return v === 1 || v === '1' || v === true || v === 'true';
}

// ── Status Mappers ──────────────────────────────────────────────

function mapDevisStatus(status: string): DevisStatus {
  const map: Record<string, DevisStatus> = {
    'draft': 'brouillon', 'brouillon': 'brouillon',
    'sent': 'envoye', 'envoye': 'envoye', 'expedie': 'envoye', 'lu': 'envoye',
    'open': 'envoye', 'clicked': 'envoye', 'relance': 'envoye',
    'accepted': 'accepte', 'accepte': 'accepte', 'acompte': 'accepte',
    'billing': 'accepte', 'billed': 'accepte', 'partially_billed': 'accepte',
    'paid': 'accepte', 'partially_paid': 'accepte', 'awaiting_validation': 'brouillon',
    'refused': 'refuse', 'refuse': 'refuse',
    'canceled': 'annule', 'annule': 'annule', 'expired': 'annule',
    'error': 'annule', 'blocked': 'annule', 'spam': 'annule',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapFactureStatus(status: string): FactureStatus {
  const map: Record<string, FactureStatus> = {
    'draft': 'brouillon', 'brouillon': 'brouillon',
    'fix': 'emise', 'emise': 'emise',
    'paid': 'payee', 'payee': 'payee',
    'partial-payment': 'partiellement_payee', 'partiellement_payee': 'partiellement_payee',
    'canceled': 'annulee', 'annulee': 'annulee',
    'delay': 'en_recouvrement', 'delay_litigation': 'en_recouvrement',
    'en_recouvrement': 'en_recouvrement', 'relance': 'en_recouvrement',
    'report': 'emise', 'irrecouvrable': 'en_recouvrement',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapAvoirStatus(status: string): FactureStatus {
  const map: Record<string, FactureStatus> = {
    'draft': 'brouillon', 'fix': 'emise', 'paid': 'payee',
    'partial-payment': 'partiellement_payee', 'canceled': 'annulee',
    'relance': 'en_recouvrement',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapReglementType(type: string): string {
  if (type === 'credit' || type === 'C') return 'C';
  if (type === 'debit' || type === 'D') return 'D';
  return 'C';
}

// ── Migration depuis un dossier (mode streaming) ─────────────────

// Tables filtrables via --only (les tables de lookup sont toujours chargées)
const FILTERABLE_TABLES = ['clients', 'clients_has_secteurs_activites', 'client_contacts', 'devis', 'devis_factures', 'avoirs', 'reglements'] as const;
type FilterableTable = typeof FILTERABLE_TABLES[number];

async function migrateFromDirectory(dir: string, only: Set<FilterableTable> | null) {
  const shouldRun = (t: FilterableTable) => only === null || only.has(t);
  console.log(`Dossier SQL: ${dir}`);
  if (only) console.log(`  Tables sélectionnées: ${[...only].join(', ')}`);

  // ── Phase 1 : Charger les petites tables lookup en mémoire ────
  console.log('\n── Phase 1 : Chargement des tables de référence ──');

  const paysRows        = await loadTableRows(dir, 'payss');
  const groupeRows      = await loadTableRows(dir, 'groupe_clients');
  const sourceRows      = await loadTableRows(dir, 'source_leads');
  const secteurRows     = await loadTableRows(dir, 'secteurs_activites');
  const contactTypeRows = await loadTableRows(dir, 'contact_types');
  const userRows        = await loadTableRows(dir, 'users');
  const moyenRows       = await loadTableRows(dir, 'moyen_reglements');
  const reglementRows   = await loadTableRows(dir, 'reglements');
  const reglFactureRows = await loadTableRows(dir, 'reglements_has_devis_factures');
  const reglAvoirRows   = await loadTableRows(dir, 'reglements_has_avoirs');

  // ── Phase 2 : Construction des Maps ───────────────────────────
  console.log('\n── Phase 2 : Construction des maps ──');

  const userMap = new Map<number, string>();
  for (const u of userRows) {
    const id = toInt(u.id);
    if (id) {
      const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.username || `User ${id}`;
      userMap.set(id, nom);
    }
  }

  const moyenMap = new Map<number, string>();
  for (const m of moyenRows) {
    const id = toInt(m.id);
    if (id) moyenMap.set(id, toStr(m.name || m.nom) || `Moyen ${id}`);
  }

  const crmContactTypeMap = new Map<number, string>();
  for (const ct of contactTypeRows) {
    const id = toInt(ct.id);
    if (id) crmContactTypeMap.set(id, toStr(ct.nom) || '');
  }

  // Map crmId → montant pour calculer restantDu des factures et avoirs
  const reglementMontantMap = new Map<number, number>();
  for (const r of reglementRows) {
    const id = toInt(r.id);
    if (id) reglementMontantMap.set(id, toDecimal(r.montant) || 0);
  }

  const factureReglements = new Map<number, { count: number; sum: number }>();
  for (const r of reglFactureRows) {
    const factureId = toInt(r.devis_factures_id);
    const reglId = toInt(r.reglements_id);
    if (!factureId) continue;
    const existing = factureReglements.get(factureId) || { count: 0, sum: 0 };
    existing.count++;
    existing.sum += reglementMontantMap.get(reglId!) || 0;
    factureReglements.set(factureId, existing);
  }

  const avoirReglements = new Map<number, { count: number; sum: number }>();
  for (const r of reglAvoirRows) {
    const avoirId = toInt(r.avoir_id);
    const reglId = toInt(r.reglements_id);
    if (!avoirId) continue;
    const existing = avoirReglements.get(avoirId) || { count: 0, sum: 0 };
    existing.count++;
    existing.sum += reglementMontantMap.get(reglId!) || 0;
    avoirReglements.set(avoirId, existing);
  }

  const pgContactTypes = await prisma.contactType.findMany();
  const contactTypeByName = new Map<string, number>();
  for (const ct of pgContactTypes) {
    contactTypeByName.set(ct.nom.toLowerCase(), ct.id);
  }

  console.log(`  userMap: ${userMap.size}, moyenMap: ${moyenMap.size}, reglementMontantMap: ${reglementMontantMap.size}`);
  console.log(`  factureReglements: ${factureReglements.size}, avoirReglements: ${avoirReglements.size}`);

  // ── 1. Pays ───────────────────────────────────────────────────
  console.log('\n── 1. Migration des pays ──');
  const paysMap = new Map<number, number>();
  let paysCreated = 0;
  for (const p of paysRows) {
    const crmId = toInt(p.id);
    if (!crmId) continue;
    const nom = toStr(p.nom) || toStr(p.name) || `Pays ${crmId}`;
    const code = toStr(p.code);
    const phonecode = toStr(p.phonecode) || toStr(p.indicatif);
    let existing = code ? await prisma.country.findUnique({ where: { code } }) : null;
    if (!existing) existing = await prisma.country.findFirst({ where: { nom } });
    if (existing) {
      paysMap.set(crmId, existing.id);
    } else {
      const created = await prisma.country.create({ data: { nom, code, phonecode } });
      paysMap.set(crmId, created.id);
      paysCreated++;
    }
  }
  console.log(`  ${paysCreated} pays créés, ${paysRows.length - paysCreated} existants`);

  // ── 2. Groupes ────────────────────────────────────────────────
  console.log('\n── 2. Migration des groupes ──');
  const groupeMap = new Map<number, number>();
  let groupeCreated = 0;
  for (const g of groupeRows) {
    const crmId = toInt(g.id);
    if (!crmId) continue;
    const nom = toStr(g.nom) || `Groupe ${crmId}`;
    let existing = await prisma.groupeClient.findFirst({ where: { nom } });
    if (existing) {
      groupeMap.set(crmId, existing.id);
    } else {
      const created = await prisma.groupeClient.create({ data: { nom } });
      groupeMap.set(crmId, created.id);
      groupeCreated++;
    }
  }
  console.log(`  ${groupeCreated} groupes créés, ${groupeRows.length - groupeCreated} existants`);

  // ── 3. Sources ────────────────────────────────────────────────
  console.log('\n── 3. Migration des sources ──');
  const sourceMap = new Map<number, number>();
  let sourceCreated = 0;
  for (const s of sourceRows) {
    const crmId = toInt(s.id);
    if (!crmId) continue;
    const nom = toStr(s.nom) || `Source ${crmId}`;
    let existing = await prisma.sourceLead.findFirst({ where: { nom } });
    if (existing) {
      sourceMap.set(crmId, existing.id);
    } else {
      const created = await prisma.sourceLead.create({ data: { nom } });
      sourceMap.set(crmId, created.id);
      sourceCreated++;
    }
  }
  console.log(`  ${sourceCreated} sources créées, ${sourceRows.length - sourceCreated} existantes`);

  // ── 4. Secteurs ───────────────────────────────────────────────
  console.log('\n── 4. Migration des secteurs ──');
  const secteurMap = new Map<number, number>();
  let secteurCreated = 0;
  for (const s of secteurRows) {
    const crmId = toInt(s.id);
    if (!crmId) continue;
    const nom = toStr(s.nom) || `Secteur ${crmId}`;
    let existing = await prisma.secteurActivite.findFirst({ where: { nom } });
    if (existing) {
      secteurMap.set(crmId, existing.id);
    } else {
      const created = await prisma.secteurActivite.create({ data: { nom } });
      secteurMap.set(crmId, created.id);
      secteurCreated++;
    }
  }
  console.log(`  ${secteurCreated} secteurs créés, ${secteurRows.length - secteurCreated} existants`);

  // ── 6. Clients (streaming) ────────────────────────────────────
  console.log('\n── 6. Migration des clients ──');
  const clientMap = new Map<number, number>();
  let clientCreated = 0, clientSkipped = 0, clientCount = 0;

  const clientFile = path.join(dir, TABLE_FILE_MAP['clients']!);
  if (shouldRun('clients') && fs.existsSync(clientFile)) {
    const existingClients = await prisma.client.findMany({ select: { id: true, idClientCrm: true } });
    const existingClientsSet = new Set(existingClients.map(c => c.idClientCrm));
    for (const c of existingClients) {
      if (c.idClientCrm) {
        const crmId = parseInt(c.idClientCrm, 10);
        if (!isNaN(crmId)) clientMap.set(crmId, c.id);
      }
    }
    console.log(`  ${existingClientsSet.size} clients déjà en DB`);

    const BATCH = 100;
    let buffer: any[] = [];

    const flushClients = async () => {
      if (buffer.length === 0) return;
      const result = await prisma.client.createManyAndReturn({
        data: buffer, skipDuplicates: true,
        select: { id: true, idClientCrm: true },
      });
      for (const c of result) {
        if (c.idClientCrm) {
          const crmId = parseInt(c.idClientCrm, 10);
          if (!isNaN(crmId)) clientMap.set(crmId, c.id);
        }
      }
      clientCreated += result.length;
      buffer = [];
    };

    await streamTableRows(clientFile, 'clients', async (c) => {
      clientCount++;
      const crmId = toInt(c.id);
      if (!crmId) { clientSkipped++; return; }
      const idClientCrm = String(crmId);
      const nom = toStr(c.nom);
      if (!nom) { clientSkipped++; return; }
      if (existingClientsSet.has(idClientCrm)) return;

      let clientType: ClientType = 'corporation';
      if (toStr(c.client_type) === 'person') clientType = 'person';
      let typeCommercial: TypeCommercial | null = null;
      const rawTC = toStr(c.type_commercial);
      if (rawTC === 'client') typeCommercial = 'client';
      else if (rawTC === 'prospect') typeCommercial = 'prospect';

      buffer.push({
        idClientCrm, clientType, nom,
        prenom: toStr(c.prenom), enseigne: toStr(c.enseigne),
        siren: toStr(c.siren), siret: toStr(c.siret),
        tvaIntracom: toStr(c.tva_intracom), codeNaf: toStr(c.code_naf),
        effectif: toInt(c.effectif), chiffreAffaire: toDecimal(c.chiffre_affaire),
        email: toStr(c.email), telephone: toStr(c.telephone), mobile: toStr(c.mobile),
        adresse: toStr(c.adresse), adresse2: toStr(c.adresse_2),
        cp: toStr(c.cp), ville: toStr(c.ville),
        departement: toStr(c.departement) || (toStr(c.cp) ? String(c.cp).slice(0, 2) : null),
        country: toStr(c.country),
        addrLat: toDecimal(c.addr_lat), addrLng: toDecimal(c.addr_lng),
        siteWeb: toStr(c.site_web), note: toStr(c.note),
        codeQuadra: toStr(c.code_quadra), typeCommercial,
        contactRaison: toStr(c.contact_raison),
        connaissanceSelfizee: toStr(c.connaissance_selfizee),
        isQualifie: toBool(c.is_qualifie), isDeleted: toBool(c.deleted),
        paysId: c.pays_id ? (paysMap.get(toInt(c.pays_id)!) || null) : null,
        groupeClientId: c.groupe_client_id ? (groupeMap.get(toInt(c.groupe_client_id)!) || null) : null,
        sourceLeadId: c.source_lead_id ? (sourceMap.get(toInt(c.source_lead_id)!) || null) : null,
        createdAt: toDate(c.created) || new Date(),
      });
      if (buffer.length >= BATCH) {
        await flushClients();
        console.log(`  ${clientCount} clients traités...`);
      }
    });
    await flushClients();
  } else if (!shouldRun('clients') && fs.existsSync(clientFile)) {
    // Pas de migration clients, mais on charge le clientMap depuis la DB en une seule requête
    console.log('  Chargement clientMap depuis la DB (bulk)...');
    const allClients = await prisma.client.findMany({ select: { id: true, idClientCrm: true } });
    for (const c of allClients) {
      if (c.idClientCrm) {
        const crmId = parseInt(c.idClientCrm, 10);
        if (!isNaN(crmId)) clientMap.set(crmId, c.id);
      }
    }
    console.log(`  clientMap chargé: ${clientMap.size} clients trouvés en DB`);
  } else {
    console.warn('  [WARN] clients.sql absent — clientMap vide, les FK client_id ne seront pas résolues.');
  }
  console.log(`  ${clientCreated} créés, ${clientSkipped} ignorés`);

  // ── 7. Secteurs par client (streaming) ───────────────────────
  console.log('\n── 7. Migration des secteurs par client ──');
  let csCreated = 0;
  const csFile = path.join(dir, TABLE_FILE_MAP['clients_has_secteurs_activites']!);
  if (shouldRun('clients_has_secteurs_activites') && fs.existsSync(csFile)) {
    const existingCS = await prisma.clientSector.findMany({ select: { clientId: true, sectorId: true } });
    const existingCSSet = new Set(existingCS.map(r => `${r.clientId}_${r.sectorId}`));

    const BATCH = 100;
    let buffer: any[] = [];
    const flushCS = async () => {
      if (buffer.length === 0) return;
      await prisma.clientSector.createMany({ data: buffer, skipDuplicates: true });
      csCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(csFile, 'clients_has_secteurs_activites', async (cs) => {
      const clientCrmId = toInt(cs.client_id);
      const secteurCrmId = toInt(cs.secteurs_activite_id);
      if (!clientCrmId || !secteurCrmId) return;
      const clientId = clientMap.get(clientCrmId);
      const sectorId = secteurMap.get(secteurCrmId);
      if (!clientId || !sectorId) return;
      if (existingCSSet.has(`${clientId}_${sectorId}`)) return;
      buffer.push({ clientId, sectorId });
      if (buffer.length >= BATCH) await flushCS();
    });
    await flushCS();
  }
  console.log(`  ${csCreated} liens client-secteur traités`);

  // ── 8. Contacts (streaming) ───────────────────────────────────
  console.log('\n── 8. Migration des contacts ──');
  let contactCreated = 0;
  const contactFile = path.join(dir, TABLE_FILE_MAP['client_contacts']!);
  if (shouldRun('client_contacts') && fs.existsSync(contactFile)) {
    const existingContacts = await prisma.clientContact.findMany({ select: { idClientCrm: true } });
    const existingContactsSet = new Set(existingContacts.map(c => c.idClientCrm));

    const BATCH = 100;
    let buffer: any[] = [];
    const flushContacts = async () => {
      if (buffer.length === 0) return;
      await prisma.clientContact.createMany({ data: buffer, skipDuplicates: true });
      contactCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(contactFile, 'client_contacts', async (c) => {
      const crmId = toInt(c.id);
      const clientCrmId = toInt(c.client_id);
      if (!crmId || !clientCrmId) return;
      const clientId = clientMap.get(clientCrmId);
      if (!clientId) return;
      const idClientCrm = `contact-${crmId}`;
      const nom = toStr(c.nom);
      if (!nom) return;
      if (existingContactsSet.has(idClientCrm)) return;

      let contactTypeId: number | null = null;
      const crmTypeId = toInt(c.contact_type_id);
      if (crmTypeId) {
        const crmTypeName = crmContactTypeMap.get(crmTypeId);
        if (crmTypeName) contactTypeId = contactTypeByName.get(crmTypeName.toLowerCase()) || null;
      }

      buffer.push({
        idClientCrm, clientId, civilite: toStr(c.civilite), nom,
        prenom: toStr(c.prenom), position: toStr(c.position),
        email: toStr(c.email), tel: toStr(c.tel),
        telephone2: toStr(c.telephone_2), contactTypeId,
        isPrimary: toBool(c.is_primary),
        createdAt: toDate(c.created) || new Date(),
      });
      if (buffer.length >= BATCH) await flushContacts();
    });
    await flushContacts();
  }
  console.log(`  ${contactCreated} créés`);

  // ── 9. Devis (batch insert) ───────────────────────────────────
  console.log('\n── 9. Migration des devis ──');
  let devisCreated = 0, devisCount = 0;
  const devisFile = path.join(dir, TABLE_FILE_MAP['devis']!);
  if (shouldRun('devis') && fs.existsSync(devisFile)) {
    // Charger les idDevisCrm déjà en DB pour éviter les doublons
    const existingDevis = await prisma.devisRef.findMany({ select: { idDevisCrm: true } });
    const existingDevisSet = new Set(existingDevis.map(d => d.idDevisCrm));
    console.log(`  ${existingDevisSet.size} devis déjà en DB`);

    const BATCH = 100;
    let buffer: any[] = [];

    const flushDevis = async () => {
      if (buffer.length === 0) return;
      await prisma.devisRef.createMany({ data: buffer, skipDuplicates: true });
      devisCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(devisFile, 'devis', async (d) => {
      devisCount++;
      const crmId = toInt(d.id);
      const clientCrmId = toInt(d.client_id);
      if (!crmId || !clientCrmId) return;
      if (toBool(d.is_model)) return;
      const clientId = clientMap.get(clientCrmId);
      if (!clientId) return;
      const idDevisCrm = String(crmId);
      if (existingDevisSet.has(idDevisCrm)) return;

      const commercialCrmId = toInt(d.ref_commercial_id);
      buffer.push({
        idDevisCrm, clientId,
        indent: toStr(d.indent), objet: toStr(d.objet),
        status: mapDevisStatus(toStr(d.status) || 'draft'),
        totalHt: toDecimal(d.total_ht), totalTtc: toDecimal(d.total_ttc),
        totalTva: toDecimal(d.total_tva), dateCreation: toDate(d.date_crea),
        dateValidite: toDate(d.date_validite), dateSignature: toDate(d.date_sign_before),
        commercialId: commercialCrmId,
        commercialNom: commercialCrmId ? (userMap.get(commercialCrmId) || null) : null,
        note: toStr(d.note),
      });
      if (buffer.length >= BATCH) {
        await flushDevis();
        console.log(`  ${devisCount} devis traités...`);
      }
    });
    await flushDevis();
  }
  console.log(`  ${devisCreated} créés (sur ${devisCount} lus)`);

  // ── 10. Factures (batch insert) → construit factureIndentMap ──
  console.log('\n── 10. Migration des factures ──');
  const factureIndentMap = new Map<number, string>();
  let factureCreated = 0;
  const factureFile = path.join(dir, TABLE_FILE_MAP['devis_factures']!);
  if (shouldRun('devis_factures') && fs.existsSync(factureFile)) {
    const existingFactures = await prisma.factureRef.findMany({ select: { idFactureCrm: true } });
    const existingFacturesSet = new Set(existingFactures.map(f => f.idFactureCrm));
    console.log(`  ${existingFacturesSet.size} factures déjà en DB`);

    const BATCH = 100;
    let buffer: any[] = [];

    const flushFactures = async () => {
      if (buffer.length === 0) return;
      await prisma.factureRef.createMany({ data: buffer, skipDuplicates: true });
      factureCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(factureFile, 'devis_factures', async (f) => {
      const crmId = toInt(f.id);
      const clientCrmId = toInt(f.client_id);
      if (!crmId || !clientCrmId) return;
      if (toBool(f.is_model)) return;
      const clientId = clientMap.get(clientCrmId);
      if (!clientId) return;

      const indent = toStr(f.indent);
      if (crmId && indent) factureIndentMap.set(crmId, indent);

      const idFactureCrm = String(crmId);
      if (existingFacturesSet.has(idFactureCrm)) return;

      const commercialCrmId = toInt(f.ref_commercial_id);
      const reglInfo = factureReglements.get(crmId);
      const totalTtc = toDecimal(f.total_ttc) || 0;
      buffer.push({
        idFactureCrm, clientId, indent, objet: toStr(f.objet),
        status: mapFactureStatus(toStr(f.status) || 'draft'),
        totalHt: toDecimal(f.total_ht), totalTtc: toDecimal(f.total_ttc),
        totalTva: toDecimal(f.total_tva), dateCreation: toDate(f.date_crea),
        dateEvenement: toDate(f.date_evenement),
        restantDu: Math.max(0, totalTtc - (reglInfo?.sum || 0)),
        nbrReglement: reglInfo?.count || 0,
        commercialNom: commercialCrmId ? (userMap.get(commercialCrmId) || null) : null,
      });
      if (buffer.length >= BATCH) await flushFactures();
    });
    await flushFactures();
  }
  console.log(`  ${factureCreated} créées`);

  // ── 11. Avoirs (batch insert) ─────────────────────────────────
  console.log('\n── 11. Migration des avoirs ──');
  let avoirCreated = 0;
  const avoirFile = path.join(dir, TABLE_FILE_MAP['avoirs']!);
  if (shouldRun('avoirs') && fs.existsSync(avoirFile)) {
    const existingAvoirs = await prisma.avoirRef.findMany({ select: { idAvoirCrm: true } });
    const existingAvoirsSet = new Set(existingAvoirs.map(a => a.idAvoirCrm));
    console.log(`  ${existingAvoirsSet.size} avoirs déjà en DB`);

    const BATCH = 100;
    let buffer: any[] = [];

    const flushAvoirs = async () => {
      if (buffer.length === 0) return;
      await prisma.avoirRef.createMany({ data: buffer, skipDuplicates: true });
      avoirCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(avoirFile, 'avoirs', async (a) => {
      const crmId = toInt(a.id);
      const clientCrmId = toInt(a.client_id);
      if (!crmId || !clientCrmId) return;
      if (toBool(a.is_model)) return;
      const clientId = clientMap.get(clientCrmId);
      if (!clientId) return;
      const idAvoirCrm = String(crmId);
      if (existingAvoirsSet.has(idAvoirCrm)) return;

      const commercialCrmId = toInt(a.ref_commercial_id);
      const factureId = toInt(a.devis_facture_id);
      const reglInfo = avoirReglements.get(crmId);
      const totalTtc = toDecimal(a.total_ttc) || 0;
      buffer.push({
        idAvoirCrm, clientId,
        indent: toStr(a.indent), objet: toStr(a.objet),
        status: mapAvoirStatus(toStr(a.status) || 'draft'),
        totalHt: toDecimal(a.total_ht), totalTtc: toDecimal(a.total_ttc),
        totalTva: toDecimal(a.total_tva), dateCreation: toDate(a.date_crea),
        restantDu: Math.max(0, totalTtc - (reglInfo?.sum || 0)),
        nbrReglement: reglInfo?.count || 0,
        factureIndent: factureId ? (factureIndentMap.get(factureId) || null) : null,
        commercialNom: commercialCrmId ? (userMap.get(commercialCrmId) || null) : null,
      });
      if (buffer.length >= BATCH) await flushAvoirs();
    });
    await flushAvoirs();
  }
  console.log(`  ${avoirCreated} créés`);

  // ── 12. Règlements (batch insert) ─────────────────────────────
  console.log('\n── 12. Migration des règlements ──');
  let reglCreated = 0;
  const reglFile = path.join(dir, TABLE_FILE_MAP['reglements']!);
  if (shouldRun('reglements') && fs.existsSync(reglFile)) {
    const existingRegls = await prisma.reglementRef.findMany({ select: { idReglementCrm: true } });
    const existingReglsSet = new Set(existingRegls.map(r => r.idReglementCrm));
    console.log(`  ${existingReglsSet.size} règlements déjà en DB`);

    const BATCH = 100;
    let buffer: any[] = [];

    const flushRegls = async () => {
      if (buffer.length === 0) return;
      await prisma.reglementRef.createMany({ data: buffer, skipDuplicates: true });
      reglCreated += buffer.length;
      buffer = [];
    };

    await streamTableRows(reglFile, 'reglements', async (r) => {
      const crmId = toInt(r.id);
      const clientCrmId = toInt(r.client_id);
      if (!crmId || !clientCrmId) return;
      const clientId = clientMap.get(clientCrmId);
      if (!clientId) return;
      const idReglementCrm = String(crmId);
      if (existingReglsSet.has(idReglementCrm)) return;

      const moyenId = toInt(r.moyen_reglement_id);
      const userCrmId = toInt(r.user_id);
      buffer.push({
        idReglementCrm, clientId,
        type: mapReglementType(toStr(r.type) || 'credit'),
        date: toDate(r.date), montant: toDecimal(r.montant),
        moyenReglement: moyenId ? (moyenMap.get(moyenId) || null) : null,
        reference: toStr(r.reference),
        note: toStr(r.note), etat: toStr(r.etat),
        commercialNom: userCrmId ? (userMap.get(userCrmId) || null) : null,
      });
      if (buffer.length >= BATCH) await flushRegls();
    });
    await flushRegls();
  }
  console.log(`  ${reglCreated} créés`);

  // ── Résumé ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  MIGRATION TERMINÉE');
  console.log('══════════════════════════════════════');
  console.log(`  Pays:       ${paysCreated} créés`);
  console.log(`  Groupes:    ${groupeCreated} créés`);
  console.log(`  Sources:    ${sourceCreated} créées`);
  console.log(`  Secteurs:   ${secteurCreated} créés`);
  console.log(`  Clients:    ${clientCreated} créés`);
  console.log(`  Secteurs/C: ${csCreated} liens`);
  console.log(`  Contacts:   ${contactCreated} créés`);
  console.log(`  Devis:      ${devisCreated} créés`);
  console.log(`  Factures:   ${factureCreated} créées`);
  console.log(`  Avoirs:     ${avoirCreated} créés`);
  console.log(`  Règlements: ${reglCreated} créés`);
  console.log('══════════════════════════════════════\n');
}

// ── Migration depuis un fichier unique (mode legacy) ─────────────

async function migrateFromFile(fullPath: string) {
  console.log(`Lecture du dump: ${fullPath}`);
  const sql = fs.readFileSync(fullPath, 'utf-8');
  console.log(`Taille du dump: ${(sql.length / 1024 / 1024).toFixed(1)} Mo`);

  console.log('\n── Parsing du dump SQL ──');
  const paysRows       = parseInserts(sql, 'payss');          console.log(`  payss: ${paysRows.length} lignes`);
  const groupeRows     = parseInserts(sql, 'groupe_clients'); console.log(`  groupe_clients: ${groupeRows.length} lignes`);
  const sourceRows     = parseInserts(sql, 'source_leads');   console.log(`  source_leads: ${sourceRows.length} lignes`);
  const secteurRows    = parseInserts(sql, 'secteurs_activites'); console.log(`  secteurs_activites: ${secteurRows.length} lignes`);
  const contactTypeRows = parseInserts(sql, 'contact_types'); console.log(`  contact_types: ${contactTypeRows.length} lignes`);
  const userRows       = parseInserts(sql, 'users');          console.log(`  users: ${userRows.length} lignes`);
  const moyenReglementRows = parseInserts(sql, 'moyen_reglements'); console.log(`  moyen_reglements: ${moyenReglementRows.length} lignes`);
  const clientRows     = parseInserts(sql, 'clients');        console.log(`  clients: ${clientRows.length} lignes`);
  const clientSectorRows = parseInserts(sql, 'clients_has_secteurs_activites'); console.log(`  clients_has_secteurs_activites: ${clientSectorRows.length} lignes`);
  const contactRows    = parseInserts(sql, 'client_contacts'); console.log(`  client_contacts: ${contactRows.length} lignes`);
  const devisRows      = parseInserts(sql, 'devis');          console.log(`  devis: ${devisRows.length} lignes`);
  const factureRows    = parseInserts(sql, 'devis_factures'); console.log(`  devis_factures: ${factureRows.length} lignes`);
  const avoirRows      = parseInserts(sql, 'avoirs');         console.log(`  avoirs: ${avoirRows.length} lignes`);
  const reglementRows  = parseInserts(sql, 'reglements');     console.log(`  reglements: ${reglementRows.length} lignes`);
  const reglFactureRows = parseInserts(sql, 'reglements_has_devis_factures'); console.log(`  reglements_has_devis_factures: ${reglFactureRows.length} lignes`);
  const reglAvoirRows  = parseInserts(sql, 'reglements_has_avoirs'); console.log(`  reglements_has_avoirs: ${reglAvoirRows.length} lignes`);

  const userMap = new Map<number, string>();
  for (const u of userRows) {
    const id = toInt(u.id);
    if (id) {
      const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.username || `User ${id}`;
      userMap.set(id, nom);
    }
  }
  const moyenMap = new Map<number, string>();
  for (const m of moyenReglementRows) {
    const id = toInt(m.id);
    if (id) moyenMap.set(id, toStr(m.name || m.nom) || `Moyen ${id}`);
  }
  const crmContactTypeMap = new Map<number, string>();
  for (const ct of contactTypeRows) {
    const id = toInt(ct.id);
    if (id) crmContactTypeMap.set(id, toStr(ct.nom) || '');
  }
  const factureIndentMap = new Map<number, string>();
  for (const f of factureRows) {
    const id = toInt(f.id);
    const indent = toStr(f.indent);
    if (id && indent) factureIndentMap.set(id, indent);
  }
  const factureReglements = new Map<number, { count: number; sum: number }>();
  for (const r of reglFactureRows) {
    const factureId = toInt(r.devis_factures_id);
    const reglId = toInt(r.reglements_id);
    if (!factureId) continue;
    const existing = factureReglements.get(factureId) || { count: 0, sum: 0 };
    existing.count++;
    const regl = reglementRows.find((rr) => toInt(rr.id) === reglId);
    if (regl) existing.sum += toDecimal(regl.montant) || 0;
    factureReglements.set(factureId, existing);
  }
  const avoirReglements = new Map<number, { count: number; sum: number }>();
  for (const r of reglAvoirRows) {
    const avoirId = toInt(r.avoir_id);
    const reglId = toInt(r.reglements_id);
    if (!avoirId) continue;
    const existing = avoirReglements.get(avoirId) || { count: 0, sum: 0 };
    existing.count++;
    const regl = reglementRows.find((rr) => toInt(rr.id) === reglId);
    if (regl) existing.sum += toDecimal(regl.montant) || 0;
    avoirReglements.set(avoirId, existing);
  }

  const pgContactTypes = await prisma.contactType.findMany();
  const contactTypeByName = new Map<string, number>();
  for (const ct of pgContactTypes) contactTypeByName.set(ct.nom.toLowerCase(), ct.id);

  // ── 1. Pays ──
  console.log('\n── 1. Migration des pays ──');
  const paysMap = new Map<number, number>();
  let paysCreated = 0;
  for (const p of paysRows) {
    const crmId = toInt(p.id);
    if (!crmId) continue;
    const nom = toStr(p.nom) || toStr(p.name) || `Pays ${crmId}`;
    const code = toStr(p.code);
    const phonecode = toStr(p.phonecode) || toStr(p.indicatif);
    let existing = code ? await prisma.country.findUnique({ where: { code } }) : null;
    if (!existing) existing = await prisma.country.findFirst({ where: { nom } });
    if (existing) { paysMap.set(crmId, existing.id); }
    else { const c = await prisma.country.create({ data: { nom, code, phonecode } }); paysMap.set(crmId, c.id); paysCreated++; }
  }
  console.log(`  ${paysCreated} pays créés, ${paysRows.length - paysCreated} existants`);

  // ── 2. Groupes ──
  console.log('\n── 2. Migration des groupes ──');
  const groupeMap = new Map<number, number>();
  let groupeCreated = 0;
  for (const g of groupeRows) {
    const crmId = toInt(g.id);
    if (!crmId) continue;
    const nom = toStr(g.nom) || `Groupe ${crmId}`;
    let existing = await prisma.groupeClient.findFirst({ where: { nom } });
    if (existing) { groupeMap.set(crmId, existing.id); }
    else { const c = await prisma.groupeClient.create({ data: { nom } }); groupeMap.set(crmId, c.id); groupeCreated++; }
  }
  console.log(`  ${groupeCreated} groupes créés, ${groupeRows.length - groupeCreated} existants`);

  // ── 3. Sources ──
  console.log('\n── 3. Migration des sources ──');
  const sourceMap = new Map<number, number>();
  let sourceCreated = 0;
  for (const s of sourceRows) {
    const crmId = toInt(s.id);
    if (!crmId) continue;
    const nom = toStr(s.nom) || `Source ${crmId}`;
    let existing = await prisma.sourceLead.findFirst({ where: { nom } });
    if (existing) { sourceMap.set(crmId, existing.id); }
    else { const c = await prisma.sourceLead.create({ data: { nom } }); sourceMap.set(crmId, c.id); sourceCreated++; }
  }
  console.log(`  ${sourceCreated} sources créées, ${sourceRows.length - sourceCreated} existantes`);

  // ── 4. Secteurs ──
  console.log('\n── 4. Migration des secteurs ──');
  const secteurMap = new Map<number, number>();
  let secteurCreated = 0;
  for (const s of secteurRows) {
    const crmId = toInt(s.id);
    if (!crmId) continue;
    const nom = toStr(s.nom) || `Secteur ${crmId}`;
    let existing = await prisma.secteurActivite.findFirst({ where: { nom } });
    if (existing) { secteurMap.set(crmId, existing.id); }
    else { const c = await prisma.secteurActivite.create({ data: { nom } }); secteurMap.set(crmId, c.id); secteurCreated++; }
  }
  console.log(`  ${secteurCreated} secteurs créés, ${secteurRows.length - secteurCreated} existants`);

  // ── 6. Clients ──
  console.log('\n── 6. Migration des clients ──');
  const clientMap = new Map<number, number>();
  let clientCreated = 0, clientUpdated = 0, clientSkipped = 0;
  for (let i = 0; i < clientRows.length; i++) {
    const c = clientRows[i];
    const crmId = toInt(c.id);
    if (!crmId) continue;
    const idClientCrm = String(crmId);
    const nom = toStr(c.nom);
    if (!nom) { clientSkipped++; continue; }
    let clientType: ClientType = 'corporation';
    if (toStr(c.client_type) === 'person') clientType = 'person';
    let typeCommercial: TypeCommercial | null = null;
    const rawTC = toStr(c.type_commercial);
    if (rawTC === 'client') typeCommercial = 'client';
    else if (rawTC === 'prospect') typeCommercial = 'prospect';
    const data = {
      clientType, nom, prenom: toStr(c.prenom), enseigne: toStr(c.enseigne),
      siren: toStr(c.siren), siret: toStr(c.siret), tvaIntracom: toStr(c.tva_intracom),
      codeNaf: toStr(c.code_naf), effectif: toInt(c.effectif), chiffreAffaire: toDecimal(c.chiffre_affaire),
      email: toStr(c.email), telephone: toStr(c.telephone), mobile: toStr(c.mobile),
      adresse: toStr(c.adresse), adresse2: toStr(c.adresse_2), cp: toStr(c.cp), ville: toStr(c.ville),
      departement: toStr(c.departement) || (toStr(c.cp) ? String(c.cp).slice(0, 2) : null),
      country: toStr(c.country), addrLat: toDecimal(c.addr_lat), addrLng: toDecimal(c.addr_lng),
      siteWeb: toStr(c.site_web), note: toStr(c.note), codeQuadra: toStr(c.code_quadra),
      typeCommercial, contactRaison: toStr(c.contact_raison),
      connaissanceSelfizee: toStr(c.connaissance_selfizee),
      isQualifie: toBool(c.is_qualifie), isDeleted: toBool(c.deleted),
      paysId: c.pays_id ? (paysMap.get(toInt(c.pays_id)!) || null) : null,
      groupeClientId: c.groupe_client_id ? (groupeMap.get(toInt(c.groupe_client_id)!) || null) : null,
      sourceLeadId: c.source_lead_id ? (sourceMap.get(toInt(c.source_lead_id)!) || null) : null,
      createdAt: toDate(c.created) || new Date(),
    };
    const existing = await prisma.client.findUnique({ where: { idClientCrm } });
    if (existing) { await prisma.client.update({ where: { id: existing.id }, data }); clientMap.set(crmId, existing.id); clientUpdated++; }
    else { const created = await prisma.client.create({ data: { ...data, idClientCrm } }); clientMap.set(crmId, created.id); clientCreated++; }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${clientRows.length} clients traités`);
  }
  console.log(`  ${clientCreated} créés, ${clientSkipped} ignorés`);

  // ── 7. Secteurs par client ──
  console.log('\n── 7. Migration des secteurs par client ──');
  let csCreated = 0;
  for (const cs of clientSectorRows) {
    const clientCrmId = toInt(cs.client_id);
    const secteurCrmId = toInt(cs.secteurs_activite_id);
    if (!clientCrmId || !secteurCrmId) continue;
    const clientId = clientMap.get(clientCrmId);
    const sectorId = secteurMap.get(secteurCrmId);
    if (!clientId || !sectorId) continue;
    await prisma.clientSector.upsert({
      where: { clientId_sectorId: { clientId, sectorId } }, update: {}, create: { clientId, sectorId },
    });
    csCreated++;
  }
  console.log(`  ${csCreated} liens client-secteur traités`);

  // ── 8. Contacts ──
  console.log('\n── 8. Migration des contacts ──');
  let contactCreated = 0, contactUpdated = 0;
  for (const c of contactRows) {
    const crmId = toInt(c.id);
    const clientCrmId = toInt(c.client_id);
    if (!crmId || !clientCrmId) continue;
    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;
    const idClientCrm = `contact-${crmId}`;
    const nom = toStr(c.nom);
    if (!nom) continue;
    let contactTypeId: number | null = null;
    const crmTypeId = toInt(c.contact_type_id);
    if (crmTypeId) {
      const crmTypeName = crmContactTypeMap.get(crmTypeId);
      if (crmTypeName) contactTypeId = contactTypeByName.get(crmTypeName.toLowerCase()) || null;
    }
    const data = {
      clientId, civilite: toStr(c.civilite), nom, prenom: toStr(c.prenom),
      position: toStr(c.position), email: toStr(c.email), tel: toStr(c.tel),
      telephone2: toStr(c.telephone_2), contactTypeId, isPrimary: toBool(c.is_primary),
      createdAt: toDate(c.created) || new Date(),
    };
    const existing = await prisma.clientContact.findUnique({ where: { idClientCrm } });
    if (existing) { await prisma.clientContact.update({ where: { id: existing.id }, data }); contactUpdated++; }
    else { await prisma.clientContact.create({ data: { ...data, idClientCrm } }); contactCreated++; }
  }
  console.log(`  ${contactCreated} créés, ${contactUpdated} mis à jour`);

  // ── 9. Devis ──
  console.log('\n── 9. Migration des devis ──');
  let devisCreated = 0, devisUpdated = 0;
  for (const d of devisRows) {
    const crmId = toInt(d.id);
    const clientCrmId = toInt(d.client_id);
    if (!crmId || !clientCrmId) continue;
    if (toBool(d.is_model)) continue;
    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;
    const idDevisCrm = String(crmId);
    const commercialCrmId = toInt(d.ref_commercial_id);
    const commercialNom = commercialCrmId ? (userMap.get(commercialCrmId) || null) : null;
    const data = {
      clientId, indent: toStr(d.indent), objet: toStr(d.objet),
      status: mapDevisStatus(toStr(d.status) || 'draft'),
      totalHt: toDecimal(d.total_ht), totalTtc: toDecimal(d.total_ttc), totalTva: toDecimal(d.total_tva),
      dateCreation: toDate(d.date_crea), dateValidite: toDate(d.date_validite),
      dateSignature: toDate(d.date_sign_before), commercialId: commercialCrmId, commercialNom,
      note: toStr(d.note),
    };
    const existing = await prisma.devisRef.findUnique({ where: { idDevisCrm } });
    if (existing) { await prisma.devisRef.update({ where: { id: existing.id }, data }); devisUpdated++; }
    else { await prisma.devisRef.create({ data: { ...data, idDevisCrm } }); devisCreated++; }
  }
  console.log(`  ${devisCreated} créés, ${devisUpdated} mis à jour`);

  // ── 10. Factures ──
  console.log('\n── 10. Migration des factures ──');
  let factureCreated = 0, factureUpdated = 0;
  for (const f of factureRows) {
    const crmId = toInt(f.id);
    const clientCrmId = toInt(f.client_id);
    if (!crmId || !clientCrmId) continue;
    if (toBool(f.is_model)) continue;
    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;
    const idFactureCrm = String(crmId);
    const commercialCrmId = toInt(f.ref_commercial_id);
    const commercialNom = commercialCrmId ? (userMap.get(commercialCrmId) || null) : null;
    const reglInfo = factureReglements.get(crmId);
    const totalTtc = toDecimal(f.total_ttc) || 0;
    const nbrReglement = reglInfo?.count || 0;
    const restantDu = totalTtc - (reglInfo?.sum || 0);
    const data = {
      clientId, indent: toStr(f.indent), objet: toStr(f.objet),
      status: mapFactureStatus(toStr(f.status) || 'draft'),
      totalHt: toDecimal(f.total_ht), totalTtc: toDecimal(f.total_ttc), totalTva: toDecimal(f.total_tva),
      dateCreation: toDate(f.date_crea), dateEvenement: toDate(f.date_evenement),
      restantDu: restantDu > 0 ? restantDu : 0, nbrReglement, commercialNom,
    };
    const existing = await prisma.factureRef.findUnique({ where: { idFactureCrm } });
    if (existing) { await prisma.factureRef.update({ where: { id: existing.id }, data }); factureUpdated++; }
    else { await prisma.factureRef.create({ data: { ...data, idFactureCrm } }); factureCreated++; }
  }
  console.log(`  ${factureCreated} créées, ${factureUpdated} mises à jour`);

  // ── 11. Avoirs ──
  console.log('\n── 11. Migration des avoirs ──');
  let avoirCreated = 0, avoirUpdated = 0;
  for (const a of avoirRows) {
    const crmId = toInt(a.id);
    const clientCrmId = toInt(a.client_id);
    if (!crmId || !clientCrmId) continue;
    if (toBool(a.is_model)) continue;
    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;
    const idAvoirCrm = String(crmId);
    const commercialCrmId = toInt(a.ref_commercial_id);
    const commercialNom = commercialCrmId ? (userMap.get(commercialCrmId) || null) : null;
    const factureId = toInt(a.devis_facture_id);
    const factureIndentAvoir = factureId ? (factureIndentMap.get(factureId) || null) : null;
    const reglInfo = avoirReglements.get(crmId);
    const totalTtc = toDecimal(a.total_ttc) || 0;
    const nbrReglement = reglInfo?.count || 0;
    const restantDu = totalTtc - (reglInfo?.sum || 0);
    const data = {
      clientId, indent: toStr(a.indent), objet: toStr(a.objet),
      status: mapAvoirStatus(toStr(a.status) || 'draft'),
      totalHt: toDecimal(a.total_ht), totalTtc: toDecimal(a.total_ttc), totalTva: toDecimal(a.total_tva),
      dateCreation: toDate(a.date_crea), restantDu: restantDu > 0 ? restantDu : 0,
      nbrReglement, factureIndent: factureIndentAvoir, commercialNom,
    };
    const existing = await prisma.avoirRef.findUnique({ where: { idAvoirCrm } });
    if (existing) { await prisma.avoirRef.update({ where: { id: existing.id }, data }); avoirUpdated++; }
    else { await prisma.avoirRef.create({ data: { ...data, idAvoirCrm } }); avoirCreated++; }
  }
  console.log(`  ${avoirCreated} créés, ${avoirUpdated} mis à jour`);

  // ── 12. Règlements ──
  console.log('\n── 12. Migration des règlements ──');
  let reglCreated = 0, reglUpdated = 0;
  for (const r of reglementRows) {
    const crmId = toInt(r.id);
    const clientCrmId = toInt(r.client_id);
    if (!crmId || !clientCrmId) continue;
    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;
    const idReglementCrm = String(crmId);
    const moyenId = toInt(r.moyen_reglement_id);
    const moyenReglement = moyenId ? (moyenMap.get(moyenId) || null) : null;
    const userCrmId = toInt(r.user_id);
    const commercialNom = userCrmId ? (userMap.get(userCrmId) || null) : null;
    const data = {
      clientId, type: mapReglementType(toStr(r.type) || 'credit'),
      date: toDate(r.date), montant: toDecimal(r.montant), moyenReglement,
      reference: toStr(r.reference), note: toStr(r.note), etat: toStr(r.etat), commercialNom,
    };
    const existing = await prisma.reglementRef.findUnique({ where: { idReglementCrm } });
    if (existing) { await prisma.reglementRef.update({ where: { id: existing.id }, data }); reglUpdated++; }
    else { await prisma.reglementRef.create({ data: { ...data, idReglementCrm } }); reglCreated++; }
  }
  console.log(`  ${reglCreated} créés, ${reglUpdated} mis à jour`);

  console.log('\n══════════════════════════════════════');
  console.log('  MIGRATION TERMINÉE');
  console.log('══════════════════════════════════════');
  console.log(`  Pays:       ${paysCreated} créés`);
  console.log(`  Groupes:    ${groupeCreated} créés`);
  console.log(`  Sources:    ${sourceCreated} créées`);
  console.log(`  Secteurs:   ${secteurCreated} créés`);
  console.log(`  Clients:    ${clientCreated} créés`);
  console.log(`  Secteurs/C: ${csCreated} liens`);
  console.log(`  Contacts:   ${contactCreated} créés`);
  console.log(`  Devis:      ${devisCreated} créés`);
  console.log(`  Factures:   ${factureCreated} créées`);
  console.log(`  Avoirs:     ${avoirCreated} créés`);
  console.log(`  Règlements: ${reglCreated} créés`);
  console.log('══════════════════════════════════════\n');
}

// ── Reset ────────────────────────────────────────────────────────

async function resetDatabase() {
  console.log('\n── Reset de la base de données ──');
  // Ordre : enfants avant parents (respecter les FK)
  await prisma.reglementRef.deleteMany();        console.log('  reglements supprimés');
  await prisma.avoirRef.deleteMany();            console.log('  avoirs supprimés');
  await prisma.factureRef.deleteMany();          console.log('  factures supprimées');
  await prisma.devisRef.deleteMany();            console.log('  devis supprimés');
  await prisma.clientSector.deleteMany();        console.log('  secteurs clients supprimés');
  await prisma.commentAttachment.deleteMany();   console.log('  pièces jointes supprimées');
  await prisma.clientComment.deleteMany();       console.log('  commentaires supprimés');
  await prisma.clientContact.deleteMany();       console.log('  contacts supprimés');
  await prisma.clientAddress.deleteMany();       console.log('  adresses supprimées');
  await prisma.client.deleteMany();              console.log('  clients supprimés');
  await prisma.groupeClient.deleteMany();        console.log('  groupes supprimés');
  await prisma.sourceLead.deleteMany();          console.log('  sources supprimées');
  await prisma.secteurActivite.deleteMany();     console.log('  secteurs supprimés');
  await prisma.country.deleteMany();             console.log('  pays supprimés');
  console.log('── Reset terminé ──\n');
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('--'));
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const reset = args.includes('--reset');

  if (!inputPath) {
    console.error('Usage: npx ts-node scripts/migrate-from-crm.ts <dossier-sql/ | dump.sql> [--only=table1,table2] [--reset]');
    process.exit(1);
  }

  if (reset) {
    await resetDatabase();
  }

  const fullPath = path.resolve(inputPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Chemin non trouvé: ${fullPath}`);
    process.exit(1);
  }

  // Parser --only=clients,devis,...
  let only: Set<FilterableTable> | null = null;
  if (onlyArg) {
    const requested = onlyArg.replace('--only=', '').split(',').map((s) => s.trim());
    const invalid = requested.filter((t) => !FILTERABLE_TABLES.includes(t as FilterableTable));
    if (invalid.length > 0) {
      console.error(`Tables inconnues: ${invalid.join(', ')}`);
      console.error(`Tables disponibles: ${FILTERABLE_TABLES.join(', ')}`);
      process.exit(1);
    }
    only = new Set(requested as FilterableTable[]);
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    await migrateFromDirectory(fullPath, only);
  } else {
    await migrateFromFile(fullPath);
  }
}

main()
  .catch((e) => {
    console.error('Migration échouée:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
