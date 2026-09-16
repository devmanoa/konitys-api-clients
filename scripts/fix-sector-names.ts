/**
 * Répare les noms de secteurs d'activité importés sous la forme `Secteur <id>`.
 *
 * Le script de migration lisait `s.nom` alors que le dump CRM nomme cette
 * colonne `name` (voir sql/secteurs_activites.sql), si bien que tous les
 * secteurs ont été créés avec le nom de repli `Secteur <id CRM>`.
 * migrate-from-crm.ts est corrigé, mais les bases déjà migrées gardent les
 * mauvais noms : ce script les réécrit à partir du dump.
 *
 * Usage :
 *   npx ts-node scripts/fix-sector-names.ts sql/            # dry-run
 *   npx ts-node scripts/fix-sector-names.ts sql/ --apply    # écriture
 *
 * Idempotent : ne touche que les lignes dont le nom correspond exactement à
 * `Secteur <n>`, et saute celles dont le nom cible est déjà pris.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Parse les tuples VALUES d'un INSERT MySQL en gérant les deux conventions
 *  d'échappement présentes dans les dumps : \' et ''. */
function parseSectorDump(sql: string): { id: number; name: string }[] {
  const rows: { id: number; name: string }[] = [];
  const insertRegex = /INSERT INTO `?secteurs_activites`?\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;

  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(sql)) !== null) {
    const columns = match[1].split(',').map((c) => c.trim().replace(/[`']/g, ''));
    const idIdx = columns.indexOf('id');
    // Le dump utilise `name`; on accepte `nom` au cas où le format changerait.
    const nameIdx = columns.indexOf('name') !== -1 ? columns.indexOf('name') : columns.indexOf('nom');
    if (idIdx === -1 || nameIdx === -1) continue;

    const values = match[2];
    let i = 0;
    while (i < values.length) {
      while (i < values.length && values[i] !== '(') i++;
      if (i >= values.length) break;
      i++;

      const tuple: (string | null)[] = [];
      while (i < values.length && values[i] !== ')') {
        while (i < values.length && (values[i] === ' ' || values[i] === ',' || values[i] === '\n' || values[i] === '\r' || values[i] === '\t')) i++;
        if (values[i] === ')') break;

        if (values[i] === "'") {
          let str = '';
          i++;
          while (i < values.length) {
            if (values[i] === '\\' && i + 1 < values.length) {
              str += values[i + 1];
              i += 2;
            } else if (values[i] === "'" && values[i + 1] === "'") {
              str += "'";
              i += 2;
            } else if (values[i] === "'") {
              i++;
              break;
            } else {
              str += values[i];
              i++;
            }
          }
          tuple.push(str);
        } else {
          let raw = '';
          while (i < values.length && values[i] !== ',' && values[i] !== ')') {
            raw += values[i];
            i++;
          }
          const trimmed = raw.trim();
          tuple.push(trimmed.toUpperCase() === 'NULL' ? null : trimmed);
        }
      }
      i++;

      const id = Number(tuple[idIdx]);
      // Certains noms du dump traînent une espace finale ("Beauté, Bien-être ").
      const name = tuple[nameIdx]?.trim();
      if (Number.isInteger(id) && name) rows.push({ id, name });
    }
  }
  return rows;
}

async function main() {
  const dir = process.argv[2];
  const apply = process.argv.includes('--apply');

  if (!dir) {
    console.error('Usage: npx ts-node scripts/fix-sector-names.ts <dossier sql/> [--apply]');
    process.exit(1);
  }

  const filePath = path.join(dir, 'secteurs_activites.sql');
  if (!fs.existsSync(filePath)) {
    console.error(`Fichier introuvable : ${filePath}`);
    process.exit(1);
  }

  const dumpRows = parseSectorDump(fs.readFileSync(filePath, 'utf8'));
  console.log(`Dump : ${dumpRows.length} secteurs lus depuis ${path.basename(filePath)}`);
  if (dumpRows.length === 0) {
    console.error('Aucune ligne exploitable dans le dump — arrêt.');
    process.exit(1);
  }

  const byCrmId = new Map(dumpRows.map((r) => [r.id, r.name]));

  const existing = await prisma.secteurActivite.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, nom: true },
  });
  console.log(`Base : ${existing.length} secteurs\n`);

  const takenNames = new Set(existing.map((s) => s.nom));
  const plan: { id: number; from: string; to: string }[] = [];
  const skipped: { nom: string; raison: string }[] = [];

  for (const sector of existing) {
    const m = /^Secteur (\d+)$/.exec(sector.nom);
    if (!m) continue; // nom déjà correct, on n'y touche pas

    const crmId = Number(m[1]);
    const target = byCrmId.get(crmId);
    if (!target) {
      skipped.push({ nom: sector.nom, raison: `id CRM ${crmId} absent du dump` });
      continue;
    }
    if (takenNames.has(target)) {
      skipped.push({ nom: sector.nom, raison: `le nom "${target}" existe déjà` });
      continue;
    }
    takenNames.add(target);
    plan.push({ id: sector.id, from: sector.nom, to: target });
  }

  if (plan.length === 0) {
    console.log('Rien à corriger : aucun nom de repli `Secteur <n>` trouvé.');
  } else {
    console.log(`${plan.length} secteur(s) à renommer :`);
    for (const p of plan) console.log(`  ${p.from}  ->  ${p.to}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} ignoré(s) :`);
    for (const s of skipped) console.log(`  ${s.nom} : ${s.raison}`);
  }

  if (!apply) {
    console.log('\n[dry-run] Aucune écriture. Relancer avec --apply pour appliquer.');
    return;
  }

  if (plan.length > 0) {
    // Les liaisons clients_has_secteurs_activites référencent l'id, pas le nom :
    // renommer ne casse aucune association.
    await prisma.$transaction(
      plan.map((p) => prisma.secteurActivite.update({ where: { id: p.id }, data: { nom: p.to } })),
    );
    console.log(`\n${plan.length} secteur(s) renommé(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
