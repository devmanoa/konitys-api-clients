/**
 * Migration: Import devis from Selfizee CRM MySQL dump → our PostgreSQL.
 * Only imports devis whose client_id matches a client already in our DB (via idClientCrm).
 * Essential fields: id→idDevisCrm, indent, objet, status, total_ht, total_ttc, total_tva,
 *   date_crea, date_validite, date_sign_before, ref_commercial_id, note
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node prisma/migrate-devis.ts
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
  // Match value tuples — starts after VALUES
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
function mapStatus(selfizeeStatus: string | null): 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'annule' {
  if (!selfizeeStatus) return 'brouillon';

  switch (selfizeeStatus) {
    case 'draft':
    case 'awaiting_validation':
      return 'brouillon';

    case 'sent':
    case 'expedie':
    case 'open':
    case 'relance':
    case 'lu':
    case 'clicked':
      return 'envoye';

    case 'accepted':
    case 'done':
    case 'paid':
    case 'acompte':
    case 'billed':
    case 'partially_billed':
    case 'partially_paid':
    case 'billing':
      return 'accepte';

    case 'refused':
    case 'expired':
      return 'refuse';

    case 'canceled':
    case 'error_sent':
    case 'error':
    case 'spam':
    case 'blocked':
      return 'annule';

    default:
      return 'brouillon';
  }
}

// ── Safe date parser ─────────────────────────────────────────────
function parseDate(val: any): Date | undefined {
  if (!val || val === '0000-00-00' || val === '0000-00-00 00:00:00') return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const sqlPath = path.resolve(__dirname, '../../devis.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`SQL file not found: ${sqlPath}`);
    process.exit(1);
  }

  console.log('Reading SQL file...');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('Parsing SQL...');
  const rows = parseMySqlInserts(sql, 'devis');
  console.log(`Found ${rows.length} devis in SQL dump.`);

  if (rows.length === 0) {
    console.log('No devis data found. Make sure you exported the data (INSERT INTO) and not just the structure.');
    return;
  }

  // Build a map: Selfizee client_id → our internal client.id
  console.log('Loading existing clients from DB...');
  const clients = await prisma.client.findMany({
    where: { idClientCrm: { not: null } },
    select: { id: true, idClientCrm: true },
  });

  const clientMap = new Map<string, number>();
  for (const c of clients) {
    if (c.idClientCrm) clientMap.set(c.idClientCrm, c.id);
  }
  console.log(`${clientMap.size} clients with idClientCrm found in DB.`);

  const clean = (v: any): string | undefined =>
    v === '' || v === null || v === undefined ? undefined : String(v).trim();

  let imported = 0;
  let skippedNoClient = 0;
  let skippedError = 0;

  for (const row of rows) {
    // Only import devis whose client exists in our DB
    const clientIdCrm = String(row.client_id);
    const ourClientId = clientMap.get(clientIdCrm);

    if (!ourClientId) {
      skippedNoClient++;
      continue;
    }

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
      imported++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        skippedError++; // duplicate idDevisCrm
      } else {
        console.error(`Error devis ${row.id} (client_id=${row.client_id}):`, err.message);
        skippedError++;
      }
    }

    if ((imported + skippedNoClient + skippedError) % 100 === 0) {
      console.log(`  ${imported} importés, ${skippedNoClient} ignorés (pas de client), ${skippedError} erreurs (${imported + skippedNoClient + skippedError}/${rows.length})`);
    }
  }

  console.log(`\nMigration devis terminée !`);
  console.log(`  Importés: ${imported}`);
  console.log(`  Ignorés (client absent): ${skippedNoClient}`);
  console.log(`  Erreurs/doublons: ${skippedError}`);
}

main()
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
