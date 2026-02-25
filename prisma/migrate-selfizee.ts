/**
 * Migration: Import clients from Selfizee CRM MySQL dump → our PostgreSQL.
 * Only essential fields: id, nom, prenom, email, telephone, mobile, adresse, ville, cp,
 * type (person/corporation), type_commercial, enseigne, code_quadra
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node prisma/migrate-selfizee.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// ── Parse MySQL INSERT values ────────────────────────────────────
function parseMySqlInserts(sql: string): Record<string, any>[] {
  const colMatch = sql.match(/INSERT INTO `clients` \(([^)]+)\) VALUES/);
  if (!colMatch) return [];
  const columns = colMatch[1].split(',').map((c) => c.trim().replace(/`/g, ''));

  const rows: Record<string, any>[] = [];
  const valueRegex = /\((\d+,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+)(?:,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+))*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = valueRegex.exec(sql)) !== null) {
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

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const sqlPath = path.resolve(__dirname, '../../clients.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`SQL file not found: ${sqlPath}`);
    process.exit(1);
  }

  console.log('Reading SQL file...');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('Parsing SQL...');
  const rows = parseMySqlInserts(sql);
  console.log(`Found ${rows.length} clients to import.`);

  if (rows.length === 0) { console.log('No data.'); return; }

  // Get France country ID
  const france = await prisma.country.findFirst({ where: { code: 'FR' } });
  if (!france) { console.error('Country FR not found. Run seed first.'); process.exit(1); }

  const clean = (v: any): string | undefined =>
    v === '' || v === null || v === undefined ? undefined : String(v).trim();

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    // Skip deleted
    if (row.deleted === 1) { skipped++; continue; }

    const clientType = row.client_type === 'corporation' ? 'corporation' as const : 'person' as const;

    let typeCommercial: 'client' | 'prospect' | undefined;
    if (row.type_commercial === 'client') typeCommercial = 'client';
    else if (row.type_commercial === 'prospect' || row.type_commercial === 'futur_client') typeCommercial = 'prospect';

    const cp = clean(row.cp);
    let departement: string | undefined;
    if (cp && cp.length >= 2) {
      departement = cp.startsWith('97') ? cp.substring(0, 3) : cp.substring(0, 2);
    }

    const data = {
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
    };

    try {
      await prisma.client.upsert({
        where: { idClientCrm: String(row.id) },
        create: { idClientCrm: String(row.id), ...data },
        update: data,
      });
      imported++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        skipped++; // duplicate on another unique field (code_quadra)
      } else {
        console.error(`Error client ${row.id} (${row.nom}):`, err.message);
        skipped++;
      }
    }

    if ((imported + skipped) % 100 === 0) {
      console.log(`  ${imported} importés, ${skipped} ignorés (${imported + skipped}/${rows.length})`);
    }
  }

  console.log(`\nMigration terminée !`);
  console.log(`  Importés: ${imported}`);
  console.log(`  Ignorés: ${skipped}`);
}

main()
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
