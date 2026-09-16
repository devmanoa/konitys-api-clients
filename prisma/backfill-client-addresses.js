const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Reprend l'adresse historique portée par la table `clients` (adresse,
 * adresse_2, cp, ville, pays_id) sous forme d'adresse principale dans
 * `clients_adresses`.
 *
 * Les clients migrés depuis l'ancien CRM n'ont que ces colonnes : la table
 * clients_adresses n'a jamais été alimentée. Sans cette reprise, leur adresse
 * n'apparaît pas dans l'onglet Adresses ni dans la liste du formulaire.
 *
 * Usage (dry-run par défaut) :
 *   node prisma/backfill-client-addresses.js
 *   node prisma/backfill-client-addresses.js --apply
 *
 * Idempotent et non destructif :
 *   - ne touche qu'aux clients n'ayant AUCUNE adresse dans clients_adresses ;
 *   - ne supprime ni ne modifie les colonnes d'origine, qui restent la source
 *     du filtre par département et de l'affichage condensé ;
 *   - relancer après coup ne crée pas de doublon.
 */
const BATCH = 500;

async function main() {
  const apply = process.argv.includes('--apply');
  const includeDeleted = process.argv.includes('--include-deleted');

  const where = {
    ...(includeDeleted ? {} : { isDeleted: false }),
    // Au moins une donnée d'adresse exploitable.
    OR: [
      { adresse: { not: null } },
      { cp: { not: null } },
      { ville: { not: null } },
    ],
    // Aucune adresse déjà enregistrée : on ne retouche jamais un client géré.
    addresses: { none: {} },
  };

  const total = await prisma.client.count({ where });
  console.log(`${total} client(s) avec une adresse historique et aucune adresse enregistrée.`);

  if (total === 0) {
    console.log('Rien à reprendre.');
    return;
  }

  let processed = 0;
  let created = 0;
  let skipped = 0;
  const samples = [];

  // Pagination par curseur sur l'id, valable dans les deux modes : en --apply
  // les lignes traitées sortent du filtre, en dry-run rien ne bouge en base.
  let cursor = undefined;

  for (;;) {
    const batch = await prisma.client.findMany({
      where,
      select: {
        id: true, nom: true, adresse: true, adresse2: true,
        cp: true, ville: true, paysId: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (batch.length === 0) break;

    for (const client of batch) {
      processed++;

      const adresse = (client.adresse || '').trim() || null;
      const adresse2 = (client.adresse2 || '').trim() || null;
      const cp = (client.cp || '').trim() || null;
      const ville = (client.ville || '').trim() || null;

      // Des colonnes ne contenant que des espaces ne valent pas une adresse.
      if (!adresse && !cp && !ville) {
        skipped++;
        continue;
      }

      if (samples.length < 5) {
        samples.push(
          `#${client.id} ${client.nom} — ${[adresse, [cp, ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`,
        );
      }

      if (apply) {
        await prisma.clientAddress.create({
          data: {
            clientId: client.id,
            label: 'Principale',
            adresse,
            adresse2,
            cp,
            ville,
            paysId: client.paysId ?? null,
            isPrimary: true,
          },
        });
      }
      created++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
    console.log(`  ${processed} traités…`);
  }

  console.log('');
  if (samples.length > 0) {
    console.log('Exemples :');
    samples.forEach((s) => console.log('  ' + s));
    console.log('');
  }
  console.log(`${created} adresse(s) principale(s) ${apply ? 'créée(s)' : 'à créer'}.`);
  if (skipped > 0) console.log(`${skipped} client(s) ignoré(s) : colonnes vides ou blanches.`);

  if (!apply) {
    console.log('\n[dry-run] Aucune écriture. Relancer avec --apply pour appliquer.');
  }
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
