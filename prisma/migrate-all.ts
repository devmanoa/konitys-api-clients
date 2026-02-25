/**
 * Migration complète :
 * 1. Supprime tous les clients existants (et devis par cascade)
 * 2. Importe UNIQUEMENT les clients référencés par les devis
 * 3. Importe les devis
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node prisma/migrate-all.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// ── Parse MySQL INSERT values ────────────────────────────────────
function parseMySqlInserts(sql: string, tableName: string): Record<string, any>[] {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colRegex = new RegExp(`INSERT INTO \`${escaped}\` \\(([^)]+)\\) VALUES`);
  const colMatch = sql.match(colRegex);
  if (!colMatch) return [];
  const columns = colMatch[1].split(',').map((c) => c.trim().replace(/`/g, ''));

  const rows: Record<string, any>[] = [];
  const valuesStart = sql.indexOf('VALUES', colMatch.index!);
  const sqlAfterValues = sql.substring(valuesStart);

  const valueRegex = /\((\d+,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+)(?:,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+))*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = valueRegex.exec(sqlAfterValues)) !== null) {
    const raw = match[1];
    const values: any[] = [];
    let i = 0;

    while (i < raw.length) {
      while (i < raw.length && (raw[i] === ' ' || raw[i] === ',' || raw[i] === '\t' || raw[i] === '\n')) i++;
      if (i >= raw.length) break;

      if (raw[i] === "'") {
        i++;
        let str = '';
        while (i < raw.length) {
          if (raw[i] === '\\' && i + 1 < raw.length) { str += raw[i + 1]; i += 2; }
          else if (raw[i] === "'") { i++; break; }
          else { str += raw[i]; i++; }
        }
        values.push(str);
      } else if (raw.substring(i, i + 4) === 'NULL') {
        values.push(null);
        i += 4;
      } else {
        let num = '';
        while (i < raw.length && raw[i] !== ',' && raw[i] !== ')') { num += raw[i]; i++; }
        const trimmed = num.trim();
        values.push(trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10));
      }
    }

    if (values.length === columns.length) {
      const row: Record<string, any> = {};
      columns.forEach((col, idx) => { row[col] = values[idx]; });
      rows.push(row);
    }
  }

  return rows;
}

// ── Map Selfizee status → our DevisStatus ────────────────────────
function mapStatus(s: string | null): 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'annule' {
  if (!s) return 'brouillon';
  switch (s) {
    case 'draft': case 'awaiting_validation': return 'brouillon';
    case 'sent': case 'expedie': case 'open': case 'relance': case 'lu': case 'clicked': return 'envoye';
    case 'accepted': case 'done': case 'paid': case 'acompte': case 'billed':
    case 'partially_billed': case 'partially_paid': case 'billing': return 'accepte';
    case 'refused': case 'expired': return 'refuse';
    case 'canceled': case 'error_sent': case 'error': case 'spam': case 'blocked': return 'annule';
    default: return 'brouillon';
  }
}

function parseDate(val: any): Date | undefined {
  if (!val || val === '0000-00-00' || val === '0000-00-00 00:00:00') return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

const clean = (v: any): string | undefined =>
  v === '' || v === null || v === undefined ? undefined : String(v).trim();

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const clientsSqlPath = path.resolve(__dirname, '../../clients.sql');
  const devisSqlPath = path.resolve(__dirname, '../../devis.sql');

  if (!fs.existsSync(clientsSqlPath)) { console.error(`Not found: ${clientsSqlPath}`); process.exit(1); }
  if (!fs.existsSync(devisSqlPath)) { console.error(`Not found: ${devisSqlPath}`); process.exit(1); }

  // ─── Parse both SQL files ───────────────────────────────────
  console.log('Parsing clients.sql...');
  const clientRows = parseMySqlInserts(fs.readFileSync(clientsSqlPath, 'utf-8'), 'clients');
  console.log(`  ${clientRows.length} clients dans le dump.`);

  console.log('Parsing devis.sql...');
  const devisRows = parseMySqlInserts(fs.readFileSync(devisSqlPath, 'utf-8'), 'devis');
  console.log(`  ${devisRows.length} devis dans le dump.`);

  // ─── Find which clients are referenced by devis ─────────────
  const devisClientIds = new Set(devisRows.map(r => String(r.client_id)));
  console.log(`\n${devisClientIds.size} clients uniques référencés par les devis.`);

  const clientsToImport = clientRows.filter(r => devisClientIds.has(String(r.id)) && r.deleted !== 1);
  console.log(`${clientsToImport.length} de ces clients trouvés dans clients.sql.`);

  if (clientsToImport.length === 0) {
    console.log('\nAucun client en commun entre clients.sql et devis.sql.');
    console.log('Les devis référencent des client_id qui ne sont pas dans ton export clients.');
    console.log('Devis client_ids (sample):', [...devisClientIds].slice(0, 10));
    const clientIdsSample = clientRows.slice(0, 10).map(r => r.id);
    console.log('Client IDs (sample):', clientIdsSample);
    process.exit(1);
  }

  // ─── Step 1: Delete all existing data ────────────────────────
  console.log('\n── Étape 1: Suppression des données existantes ──');
  const deletedDevis = await prisma.devisRef.deleteMany({});
  console.log(`  ${deletedDevis.count} devis supprimés.`);
  // Opportunités et sous-tables
  const deletedOppTags = await prisma.opportunityTagLink.deleteMany({});
  const deletedOppComments = await prisma.opportunityComment.deleteMany({});
  const deletedOppTimeline = await prisma.opportunityTimeline.deleteMany({});
  const deletedPipelineOrders = await prisma.pipelineOrder.deleteMany({});
  const deletedOpps = await prisma.opportunity.deleteMany({});
  console.log(`  ${deletedOpps.count} opportunités supprimées.`);
  const deletedContacts = await prisma.clientContact.deleteMany({});
  console.log(`  ${deletedContacts.count} contacts supprimés.`);
  const deletedAttachments = await prisma.commentAttachment.deleteMany({});
  const deletedComments = await prisma.clientComment.deleteMany({});
  console.log(`  ${deletedComments.count} commentaires supprimés.`);
  const deletedSectors = await prisma.clientSector.deleteMany({});
  console.log(`  ${deletedSectors.count} secteurs clients supprimés.`);
  const deletedAddresses = await prisma.clientAddress.deleteMany({});
  console.log(`  ${deletedAddresses.count} adresses supprimées.`);
  const deletedClients = await prisma.client.deleteMany({});
  console.log(`  ${deletedClients.count} clients supprimés.`);

  // ─── Step 2: Import only clients referenced by devis ────────
  console.log('\n── Étape 2: Import des clients avec devis ──');
  const france = await prisma.country.findFirst({ where: { code: 'FR' } });
  if (!france) { console.error('Country FR not found. Run seed first.'); process.exit(1); }

  let clientsImported = 0;
  let clientsSkipped = 0;

  for (const row of clientsToImport) {
    const clientType = row.client_type === 'corporation' ? 'corporation' as const : 'person' as const;
    let typeCommercial: 'client' | 'prospect' | undefined;
    if (row.type_commercial === 'client') typeCommercial = 'client';
    else if (row.type_commercial === 'prospect' || row.type_commercial === 'futur_client') typeCommercial = 'prospect';

    const cp = clean(row.cp);
    let departement: string | undefined;
    if (cp && cp.length >= 2) {
      departement = cp.startsWith('97') ? cp.substring(0, 3) : cp.substring(0, 2);
    }

    try {
      await prisma.client.create({
        data: {
          idClientCrm: String(row.id),
          clientType,
          nom: row.nom || 'Sans nom',
          prenom: clean(row.prenom),
          enseigne: clean(row.enseigne),
          email: clean(row.email),
          telephone: clean(row.telephone),
          mobile: clean(row.mobile),
          adresse: clean(row.adresse),
          cp,
          ville: clean(row.ville),
          departement,
          paysId: france.id,
          typeCommercial,
          codeQuadra: clean(row.code_quadra),
          createdAt: row.created ? new Date(row.created) : undefined,
        },
      });
      clientsImported++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        clientsSkipped++;
      } else {
        console.error(`  Erreur client ${row.id} (${row.nom}):`, err.message);
        clientsSkipped++;
      }
    }
  }
  console.log(`  ${clientsImported} clients importés, ${clientsSkipped} ignorés.`);

  // ─── Step 3: Import devis ──────────────────────────────────
  console.log('\n── Étape 3: Import des devis ──');

  // Build map: Selfizee client_id → our client.id
  const dbClients = await prisma.client.findMany({
    where: { idClientCrm: { not: null } },
    select: { id: true, idClientCrm: true },
  });
  const clientMap = new Map<string, number>();
  for (const c of dbClients) {
    if (c.idClientCrm) clientMap.set(c.idClientCrm, c.id);
  }

  let devisImported = 0;
  let devisSkippedNoClient = 0;
  let devisSkippedError = 0;

  for (const row of devisRows) {
    const ourClientId = clientMap.get(String(row.client_id));
    if (!ourClientId) { devisSkippedNoClient++; continue; }

    try {
      await prisma.devisRef.create({
        data: {
          idDevisCrm: String(row.id),
          clientId: ourClientId,
          indent: clean(row.indent),
          objet: clean(row.objet),
          status: mapStatus(row.status),
          totalHt: row.total_ht != null ? row.total_ht : undefined,
          totalTtc: row.total_ttc != null ? row.total_ttc : undefined,
          totalTva: row.total_tva != null ? row.total_tva : undefined,
          dateCreation: parseDate(row.date_crea),
          dateValidite: parseDate(row.date_validite),
          dateSignature: parseDate(row.date_sign_before),
          commercialNom: clean(row.ref_commercial_id),
          note: clean(row.note),
        },
      });
      devisImported++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        devisSkippedError++;
      } else {
        console.error(`  Erreur devis ${row.id}:`, err.message);
        devisSkippedError++;
      }
    }

    if ((devisImported + devisSkippedNoClient + devisSkippedError) % 100 === 0) {
      console.log(`  ${devisImported} importés, ${devisSkippedNoClient} ignorés, ${devisSkippedError} erreurs`);
    }
  }

  console.log(`\n══════════════════════════════════`);
  console.log(`  Clients importés: ${clientsImported}`);
  console.log(`  Devis importés: ${devisImported}`);
  console.log(`  Devis ignorés (client absent): ${devisSkippedNoClient}`);
  console.log(`══════════════════════════════════`);
}

main()
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
