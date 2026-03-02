/**
 * Script de migration CRM Selfizee (MySQL dump) → PostgreSQL (Prisma)
 *
 * Usage:
 *   npx ts-node scripts/migrate-from-crm.ts <chemin-du-dump.sql>
 *
 * Le dump doit contenir les INSERT INTO des tables :
 *   clients, client_contacts, devis, devis_factures, avoirs, reglements,
 *   groupe_clients, source_leads, secteurs_activites, payss, contact_types,
 *   moyen_reglements, users, clients_has_secteurs_activites,
 *   reglements_has_devis_factures, reglements_has_avoirs
 */

import { PrismaClient, ClientType, TypeCommercial, DevisStatus, FactureStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ── SQL Parser ──────────────────────────────────────────────────

/**
 * Parse all INSERT INTO statements for a given table from SQL dump.
 * Handles multi-row inserts: INSERT INTO `table` (...) VALUES (...), (...);
 * Returns array of objects keyed by column names.
 */
function parseInserts(sql: string, tableName: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];

  // Match INSERT INTO `tableName` (columns) VALUES ...;
  // Use regex to find all INSERT statements for this table
  const insertRegex = new RegExp(
    `INSERT\\s+INTO\\s+\`?${tableName}\`?\\s*\\(([^)]+)\\)\\s*VALUES\\s*(.+?)(?:;|$)`,
    'gis'
  );

  let match;
  while ((match = insertRegex.exec(sql)) !== null) {
    const columnsStr = match[1];
    const valuesStr = match[2];

    // Parse column names
    const columns = columnsStr
      .split(',')
      .map((c) => c.trim().replace(/`/g, '').replace(/'/g, ''));

    // Parse each row of values
    const rows = parseValueRows(valuesStr);

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
 * Handles strings with escaped quotes, NULL, numbers.
 */
function parseValueRows(valuesStr: string): any[][] {
  const rows: any[][] = [];
  let i = 0;
  const len = valuesStr.length;

  while (i < len) {
    // Skip whitespace and commas between rows
    while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\n' || valuesStr[i] === '\r' || valuesStr[i] === '\t' || valuesStr[i] === ',')) {
      i++;
    }

    if (i >= len || valuesStr[i] !== '(') break;

    // Parse one row: (v1, v2, ...)
    i++; // skip '('
    const values: any[] = [];
    let depth = 0;

    while (i < len) {
      // Skip whitespace
      while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\t')) i++;

      if (i >= len || (valuesStr[i] === ')' && depth === 0)) {
        i++; // skip ')'
        break;
      }

      // Parse a single value
      if (valuesStr[i] === "'") {
        // String value
        let str = '';
        i++; // skip opening quote
        while (i < len) {
          if (valuesStr[i] === '\\' && i + 1 < len) {
            // Escaped character
            const next = valuesStr[i + 1];
            if (next === "'") { str += "'"; i += 2; }
            else if (next === '\\') { str += '\\'; i += 2; }
            else if (next === 'n') { str += '\n'; i += 2; }
            else if (next === 'r') { str += '\r'; i += 2; }
            else if (next === 't') { str += '\t'; i += 2; }
            else if (next === '0') { str += '\0'; i += 2; }
            else { str += next; i += 2; }
          } else if (valuesStr[i] === "'" && i + 1 < len && valuesStr[i + 1] === "'") {
            // Double quote escape
            str += "'";
            i += 2;
          } else if (valuesStr[i] === "'") {
            i++; // skip closing quote
            break;
          } else {
            str += valuesStr[i];
            i++;
          }
        }
        values.push(str);
      } else if (valuesStr.slice(i, i + 4).toUpperCase() === 'NULL') {
        values.push(null);
        i += 4;
      } else {
        // Number or other literal
        let num = '';
        while (i < len && valuesStr[i] !== ',' && valuesStr[i] !== ')' && valuesStr[i] !== ' ') {
          num += valuesStr[i];
          i++;
        }
        const parsed = parseFloat(num);
        values.push(isNaN(parsed) ? num : parsed);
      }

      // Skip whitespace and comma
      while (i < len && (valuesStr[i] === ' ' || valuesStr[i] === '\t')) i++;
      if (i < len && valuesStr[i] === ',') i++;
    }

    rows.push(values);
  }

  return rows;
}

// ── Helpers ─────────────────────────────────────────────────────

function toStr(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim() || null;
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
    'draft': 'brouillon',
    'brouillon': 'brouillon',
    'sent': 'envoye',
    'envoye': 'envoye',
    'expedie': 'envoye',
    'lu': 'envoye',
    'open': 'envoye',
    'clicked': 'envoye',
    'relance': 'envoye',
    'accepted': 'accepte',
    'accepte': 'accepte',
    'acompte': 'accepte',
    'billing': 'accepte',
    'billed': 'accepte',
    'partially_billed': 'accepte',
    'paid': 'accepte',
    'partially_paid': 'accepte',
    'awaiting_validation': 'brouillon',
    'refused': 'refuse',
    'refuse': 'refuse',
    'canceled': 'annule',
    'annule': 'annule',
    'expired': 'annule',
    'error': 'annule',
    'blocked': 'annule',
    'spam': 'annule',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapFactureStatus(status: string): FactureStatus {
  const map: Record<string, FactureStatus> = {
    'draft': 'brouillon',
    'brouillon': 'brouillon',
    'fix': 'emise',
    'emise': 'emise',
    'paid': 'payee',
    'payee': 'payee',
    'partial-payment': 'partiellement_payee',
    'partiellement_payee': 'partiellement_payee',
    'canceled': 'annulee',
    'annulee': 'annulee',
    'delay': 'en_recouvrement',
    'delay_litigation': 'en_recouvrement',
    'en_recouvrement': 'en_recouvrement',
    'relance': 'en_recouvrement',
    'report': 'emise',
    'irrecouvrable': 'en_recouvrement',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapAvoirStatus(status: string): FactureStatus {
  const map: Record<string, FactureStatus> = {
    'draft': 'brouillon',
    'fix': 'emise',
    'paid': 'payee',
    'partial-payment': 'partiellement_payee',
    'canceled': 'annulee',
    'relance': 'en_recouvrement',
  };
  return map[status?.toLowerCase()] || 'brouillon';
}

function mapReglementType(type: string): string {
  if (type === 'credit' || type === 'C') return 'C';
  if (type === 'debit' || type === 'D') return 'D';
  return 'C';
}

// ── Main Migration ──────────────────────────────────────────────

async function main() {
  const dumpPath = process.argv[2];
  if (!dumpPath) {
    console.error('Usage: npx ts-node scripts/migrate-from-crm.ts <chemin-du-dump.sql>');
    process.exit(1);
  }

  const fullPath = path.resolve(dumpPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Fichier non trouvé: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Lecture du dump: ${fullPath}`);
  const sql = fs.readFileSync(fullPath, 'utf-8');
  console.log(`Taille du dump: ${(sql.length / 1024 / 1024).toFixed(1)} Mo`);

  // ── Parse all tables ──────────────────────────────────────
  console.log('\n── Parsing du dump SQL ──');

  const paysRows = parseInserts(sql, 'payss');
  console.log(`  payss: ${paysRows.length} lignes`);

  const groupeRows = parseInserts(sql, 'groupe_clients');
  console.log(`  groupe_clients: ${groupeRows.length} lignes`);

  const sourceRows = parseInserts(sql, 'source_leads');
  console.log(`  source_leads: ${sourceRows.length} lignes`);

  const secteurRows = parseInserts(sql, 'secteurs_activites');
  console.log(`  secteurs_activites: ${secteurRows.length} lignes`);

  const contactTypeRows = parseInserts(sql, 'contact_types');
  console.log(`  contact_types: ${contactTypeRows.length} lignes`);

  const userRows = parseInserts(sql, 'users');
  console.log(`  users: ${userRows.length} lignes`);

  const moyenReglementRows = parseInserts(sql, 'moyen_reglements');
  console.log(`  moyen_reglements: ${moyenReglementRows.length} lignes`);

  const clientRows = parseInserts(sql, 'clients');
  console.log(`  clients: ${clientRows.length} lignes`);

  const clientSectorRows = parseInserts(sql, 'clients_has_secteurs_activites');
  console.log(`  clients_has_secteurs_activites: ${clientSectorRows.length} lignes`);

  const contactRows = parseInserts(sql, 'client_contacts');
  console.log(`  client_contacts: ${contactRows.length} lignes`);

  const devisRows = parseInserts(sql, 'devis');
  console.log(`  devis: ${devisRows.length} lignes`);

  const factureRows = parseInserts(sql, 'devis_factures');
  console.log(`  devis_factures: ${factureRows.length} lignes`);

  const avoirRows = parseInserts(sql, 'avoirs');
  console.log(`  avoirs: ${avoirRows.length} lignes`);

  const reglementRows = parseInserts(sql, 'reglements');
  console.log(`  reglements: ${reglementRows.length} lignes`);

  const reglFactureRows = parseInserts(sql, 'reglements_has_devis_factures');
  console.log(`  reglements_has_devis_factures: ${reglFactureRows.length} lignes`);

  const reglAvoirRows = parseInserts(sql, 'reglements_has_avoirs');
  console.log(`  reglements_has_avoirs: ${reglAvoirRows.length} lignes`);

  // ── Build lookup maps from CRM data ───────────────────────

  // Users: id → full name (for commercial)
  const userMap = new Map<number, string>();
  for (const u of userRows) {
    const id = toInt(u.id);
    if (id) {
      const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.username || `User ${id}`;
      userMap.set(id, nom);
    }
  }

  // Moyen reglement: id → name
  const moyenMap = new Map<number, string>();
  for (const m of moyenReglementRows) {
    const id = toInt(m.id);
    if (id) moyenMap.set(id, toStr(m.name || m.nom) || `Moyen ${id}`);
  }

  // Contact types from CRM: id → nom (for mapping)
  const crmContactTypeMap = new Map<number, string>();
  for (const ct of contactTypeRows) {
    const id = toInt(ct.id);
    if (id) crmContactTypeMap.set(id, toStr(ct.nom) || '');
  }

  // Facture indent lookup: devis_factures id → indent (for avoirs linking)
  const factureIndentMap = new Map<number, string>();
  for (const f of factureRows) {
    const id = toInt(f.id);
    const indent = toStr(f.indent);
    if (id && indent) factureIndentMap.set(id, indent);
  }

  // Reglements per facture: devis_factures_id → count + sum
  const factureReglements = new Map<number, { count: number; sum: number }>();
  for (const r of reglFactureRows) {
    const factureId = toInt(r.devis_factures_id);
    const reglId = toInt(r.reglements_id);
    if (!factureId) continue;

    const existing = factureReglements.get(factureId) || { count: 0, sum: 0 };
    existing.count++;
    // Find the reglement to get its montant
    const regl = reglementRows.find((rr) => toInt(rr.id) === reglId);
    if (regl) existing.sum += toDecimal(regl.montant) || 0;
    factureReglements.set(factureId, existing);
  }

  // Reglements per avoir: avoir_id → count + sum
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

  // ── 1. Pays ───────────────────────────────────────────────
  console.log('\n── 1. Migration des pays ──');
  const paysMap = new Map<number, number>(); // crm id → pg id
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
      const created = await prisma.country.create({
        data: { nom, code, phonecode },
      });
      paysMap.set(crmId, created.id);
      paysCreated++;
    }
  }
  console.log(`  ${paysCreated} pays créés, ${paysRows.length - paysCreated} existants`);

  // ── 2. Groupes ────────────────────────────────────────────
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

  // ── 3. Sources ────────────────────────────────────────────
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

  // ── 4. Secteurs ───────────────────────────────────────────
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

  // ── 5. Contact Types ──────────────────────────────────────
  // Already seeded (Commercial, Facturation, Projet) — just build a lookup
  const pgContactTypes = await prisma.contactType.findMany();
  const contactTypeByName = new Map<string, number>();
  for (const ct of pgContactTypes) {
    contactTypeByName.set(ct.nom.toLowerCase(), ct.id);
  }

  // ── 6. Clients ────────────────────────────────────────────
  console.log('\n── 6. Migration des clients ──');
  const clientMap = new Map<number, number>(); // crm id → pg id
  let clientCreated = 0;
  let clientUpdated = 0;
  let clientSkipped = 0;

  for (let i = 0; i < clientRows.length; i++) {
    const c = clientRows[i];
    const crmId = toInt(c.id);
    if (!crmId) continue;

    const idClientCrm = String(crmId);
    const nom = toStr(c.nom);
    if (!nom) { clientSkipped++; continue; }

    // Determine client type
    let clientType: ClientType = 'corporation';
    const rawType = toStr(c.client_type);
    if (rawType === 'person') clientType = 'person';

    // Determine type commercial
    let typeCommercial: TypeCommercial | null = null;
    const rawTC = toStr(c.type_commercial);
    if (rawTC === 'client') typeCommercial = 'client';
    else if (rawTC === 'prospect') typeCommercial = 'prospect';

    const data = {
      clientType,
      nom,
      prenom: toStr(c.prenom),
      enseigne: toStr(c.enseigne),
      siren: toStr(c.siren),
      siret: toStr(c.siret),
      tvaIntracom: toStr(c.tva_intracom),
      codeNaf: toStr(c.code_naf),
      effectif: toInt(c.effectif),
      chiffreAffaire: toDecimal(c.chiffre_affaire),
      email: toStr(c.email),
      telephone: toStr(c.telephone),
      mobile: toStr(c.mobile),
      adresse: toStr(c.adresse),
      adresse2: toStr(c.adresse_2),
      cp: toStr(c.cp),
      ville: toStr(c.ville),
      departement: toStr(c.departement) || (toStr(c.cp) ? String(c.cp).slice(0, 2) : null),
      country: toStr(c.country),
      addrLat: toDecimal(c.addr_lat),
      addrLng: toDecimal(c.addr_lng),
      siteWeb: toStr(c.site_web),
      note: toStr(c.note),
      codeQuadra: toStr(c.code_quadra),
      typeCommercial,
      contactRaison: toStr(c.contact_raison),
      connaissanceSelfizee: toStr(c.connaissance_selfizee),
      isQualifie: toBool(c.is_qualifie),
      isDeleted: toBool(c.deleted),
      paysId: c.pays_id ? (paysMap.get(toInt(c.pays_id)!) || null) : null,
      groupeClientId: c.groupe_client_id ? (groupeMap.get(toInt(c.groupe_client_id)!) || null) : null,
      sourceLeadId: c.source_lead_id ? (sourceMap.get(toInt(c.source_lead_id)!) || null) : null,
      createdAt: toDate(c.created) || new Date(),
    };

    // Upsert by idClientCrm
    const existing = await prisma.client.findUnique({ where: { idClientCrm } });
    if (existing) {
      await prisma.client.update({ where: { id: existing.id }, data });
      clientMap.set(crmId, existing.id);
      clientUpdated++;
    } else {
      const created = await prisma.client.create({
        data: { ...data, idClientCrm },
      });
      clientMap.set(crmId, created.id);
      clientCreated++;
    }

    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${clientRows.length} clients traités`);
  }
  console.log(`  ${clientCreated} créés, ${clientUpdated} mis à jour, ${clientSkipped} ignorés`);

  // ── 7. Secteurs par client ────────────────────────────────
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
      where: { clientId_sectorId: { clientId, sectorId } },
      update: {},
      create: { clientId, sectorId },
    });
    csCreated++;
  }
  console.log(`  ${csCreated} liens client-secteur traités`);

  // ── 8. Contacts ───────────────────────────────────────────
  console.log('\n── 8. Migration des contacts ──');
  let contactCreated = 0;
  let contactUpdated = 0;
  for (const c of contactRows) {
    const crmId = toInt(c.id);
    const clientCrmId = toInt(c.client_id);
    if (!crmId || !clientCrmId) continue;

    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;

    const idClientCrm = `contact-${crmId}`;
    const nom = toStr(c.nom);
    if (!nom) continue;

    // Map contact_type from CRM
    let contactTypeId: number | null = null;
    const crmTypeId = toInt(c.contact_type_id);
    if (crmTypeId) {
      const crmTypeName = crmContactTypeMap.get(crmTypeId);
      if (crmTypeName) {
        contactTypeId = contactTypeByName.get(crmTypeName.toLowerCase()) || null;
      }
    }

    const data = {
      clientId,
      civilite: toStr(c.civilite),
      nom,
      prenom: toStr(c.prenom),
      position: toStr(c.position),
      email: toStr(c.email),
      tel: toStr(c.tel),
      telephone2: toStr(c.telephone_2),
      contactTypeId,
      isPrimary: toBool(c.is_primary),
      createdAt: toDate(c.created) || new Date(),
    };

    const existing = await prisma.clientContact.findUnique({ where: { idClientCrm } });
    if (existing) {
      await prisma.clientContact.update({ where: { id: existing.id }, data });
      contactUpdated++;
    } else {
      await prisma.clientContact.create({ data: { ...data, idClientCrm } });
      contactCreated++;
    }
  }
  console.log(`  ${contactCreated} créés, ${contactUpdated} mis à jour`);

  // ── 9. Devis ──────────────────────────────────────────────
  console.log('\n── 9. Migration des devis ──');
  let devisCreated = 0;
  let devisUpdated = 0;
  for (const d of devisRows) {
    const crmId = toInt(d.id);
    const clientCrmId = toInt(d.client_id);
    if (!crmId || !clientCrmId) continue;

    // Skip models/templates
    if (toBool(d.is_model)) continue;

    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;

    const idDevisCrm = String(crmId);

    // Resolve commercial name
    const commercialCrmId = toInt(d.ref_commercial_id);
    const commercialNom = commercialCrmId ? (userMap.get(commercialCrmId) || null) : null;

    const data = {
      clientId,
      indent: toStr(d.indent),
      objet: toStr(d.objet),
      status: mapDevisStatus(toStr(d.status) || 'draft'),
      totalHt: toDecimal(d.total_ht),
      totalTtc: toDecimal(d.total_ttc),
      totalTva: toDecimal(d.total_tva),
      dateCreation: toDate(d.date_crea),
      dateValidite: toDate(d.date_validite),
      dateSignature: toDate(d.date_sign_before),
      commercialId: commercialCrmId,
      commercialNom,
      note: toStr(d.note),
    };

    const existing = await prisma.devisRef.findUnique({ where: { idDevisCrm } });
    if (existing) {
      await prisma.devisRef.update({ where: { id: existing.id }, data });
      devisUpdated++;
    } else {
      await prisma.devisRef.create({ data: { ...data, idDevisCrm } });
      devisCreated++;
    }
  }
  console.log(`  ${devisCreated} créés, ${devisUpdated} mis à jour`);

  // ── 10. Factures ──────────────────────────────────────────
  console.log('\n── 10. Migration des factures ──');
  let factureCreated = 0;
  let factureUpdated = 0;
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

    // Calculate restantDu and nbrReglement
    const reglInfo = factureReglements.get(crmId);
    const totalTtc = toDecimal(f.total_ttc) || 0;
    const nbrReglement = reglInfo?.count || 0;
    const restantDu = totalTtc - (reglInfo?.sum || 0);

    const data = {
      clientId,
      indent: toStr(f.indent),
      objet: toStr(f.objet),
      status: mapFactureStatus(toStr(f.status) || 'draft'),
      totalHt: toDecimal(f.total_ht),
      totalTtc: toDecimal(f.total_ttc),
      totalTva: toDecimal(f.total_tva),
      dateCreation: toDate(f.date_crea),
      dateEvenement: toDate(f.date_evenement),
      restantDu: restantDu > 0 ? restantDu : 0,
      nbrReglement,
      commercialNom,
    };

    const existing = await prisma.factureRef.findUnique({ where: { idFactureCrm } });
    if (existing) {
      await prisma.factureRef.update({ where: { id: existing.id }, data });
      factureUpdated++;
    } else {
      await prisma.factureRef.create({ data: { ...data, idFactureCrm } });
      factureCreated++;
    }
  }
  console.log(`  ${factureCreated} créées, ${factureUpdated} mises à jour`);

  // ── 11. Avoirs ────────────────────────────────────────────
  console.log('\n── 11. Migration des avoirs ──');
  let avoirCreated = 0;
  let avoirUpdated = 0;
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

    // Linked facture indent
    const factureId = toInt(a.devis_facture_id);
    const factureIndent = factureId ? (factureIndentMap.get(factureId) || null) : null;

    // Calculate restantDu and nbrReglement
    const reglInfo = avoirReglements.get(crmId);
    const totalTtc = toDecimal(a.total_ttc) || 0;
    const nbrReglement = reglInfo?.count || 0;
    const restantDu = totalTtc - (reglInfo?.sum || 0);

    const data = {
      clientId,
      indent: toStr(a.indent),
      objet: toStr(a.objet),
      status: mapAvoirStatus(toStr(a.status) || 'draft'),
      totalHt: toDecimal(a.total_ht),
      totalTtc: toDecimal(a.total_ttc),
      totalTva: toDecimal(a.total_tva),
      dateCreation: toDate(a.date_crea),
      restantDu: restantDu > 0 ? restantDu : 0,
      nbrReglement,
      factureIndent,
      commercialNom,
    };

    const existing = await prisma.avoirRef.findUnique({ where: { idAvoirCrm } });
    if (existing) {
      await prisma.avoirRef.update({ where: { id: existing.id }, data });
      avoirUpdated++;
    } else {
      await prisma.avoirRef.create({ data: { ...data, idAvoirCrm } });
      avoirCreated++;
    }
  }
  console.log(`  ${avoirCreated} créés, ${avoirUpdated} mis à jour`);

  // ── 12. Règlements ────────────────────────────────────────
  console.log('\n── 12. Migration des règlements ──');
  let reglCreated = 0;
  let reglUpdated = 0;
  for (const r of reglementRows) {
    const crmId = toInt(r.id);
    const clientCrmId = toInt(r.client_id);
    if (!crmId || !clientCrmId) continue;

    const clientId = clientMap.get(clientCrmId);
    if (!clientId) continue;

    const idReglementCrm = String(crmId);

    // Resolve moyen reglement name
    const moyenId = toInt(r.moyen_reglement_id);
    const moyenReglement = moyenId ? (moyenMap.get(moyenId) || null) : null;

    // Resolve commercial
    const userCrmId = toInt(r.user_id);
    const commercialNom = userCrmId ? (userMap.get(userCrmId) || null) : null;

    const data = {
      clientId,
      type: mapReglementType(toStr(r.type) || 'credit'),
      date: toDate(r.date),
      montant: toDecimal(r.montant),
      moyenReglement,
      reference: toStr(r.reference),
      note: toStr(r.note),
      etat: toStr(r.etat),
      commercialNom,
    };

    const existing = await prisma.reglementRef.findUnique({ where: { idReglementCrm } });
    if (existing) {
      await prisma.reglementRef.update({ where: { id: existing.id }, data });
      reglUpdated++;
    } else {
      await prisma.reglementRef.create({ data: { ...data, idReglementCrm } });
      reglCreated++;
    }
  }
  console.log(`  ${reglCreated} créés, ${reglUpdated} mis à jour`);

  // ── Résumé ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  MIGRATION TERMINÉE');
  console.log('══════════════════════════════════════');
  console.log(`  Pays:       ${paysCreated} créés`);
  console.log(`  Groupes:    ${groupeCreated} créés`);
  console.log(`  Sources:    ${sourceCreated} créées`);
  console.log(`  Secteurs:   ${secteurCreated} créés`);
  console.log(`  Clients:    ${clientCreated} créés, ${clientUpdated} mis à jour`);
  console.log(`  Secteurs/C: ${csCreated} liens`);
  console.log(`  Contacts:   ${contactCreated} créés, ${contactUpdated} mis à jour`);
  console.log(`  Devis:      ${devisCreated} créés, ${devisUpdated} mis à jour`);
  console.log(`  Factures:   ${factureCreated} créées, ${factureUpdated} mises à jour`);
  console.log(`  Avoirs:     ${avoirCreated} créés, ${avoirUpdated} mis à jour`);
  console.log(`  Règlements: ${reglCreated} créés, ${reglUpdated} mis à jour`);
  console.log('══════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('Migration échouée:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
