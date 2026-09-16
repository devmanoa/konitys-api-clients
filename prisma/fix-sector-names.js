const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Répare les noms de secteurs d'activité importés sous la forme `Secteur <id>`.
 *
 * Le script de migration lisait `s.nom` alors que le dump CRM nomme cette
 * colonne `name`, si bien que tous les secteurs ont été créés avec leur nom
 * de repli. La table ci-dessous reprend les libellés du dump d'origine,
 * indexés par l'id CRM encodé dans le nom de repli (les ids Prisma sont
 * réattribués à l'insertion, on ne peut donc pas s'y fier).
 *
 * Usage (dry-run par défaut) :
 *   node prisma/fix-sector-names.js
 *   node prisma/fix-sector-names.js --apply
 *
 * Idempotent : ne renomme que les lignes encore nommées `Secteur <n>`, et
 * saute celles dont le nom cible est déjà pris. Renommer ne casse aucune
 * association : clients_has_secteurs_activites référence l'id, pas le nom.
 */
const SECTOR_NAMES = {
  1: "Agence événementielle & communication",
  2: "Centre commercial, galerie marchande",
  3: "Administration, fonction publique (armée, mairie...)",
  4: "Banque, assurance, mutuelles, caisses de retraites, finances",
  5: "Commerce de détail",
  6: "Grande et moyenne surface",
  7: "Tourisme",
  8: "Lieu de réception, restaurant, traiteur",
  10: "Hôtel, hébergement",
  11: "Santé (hôpitaux, EHPAD...), action sociale, laboratoire",
  12: "Services aux particuliers",
  13: "Association professionnelle",
  14: "Entreprise du secteur privé",
  15: "Entreprise du secteur public (EDF, GDF, Veolia...)",
  16: "Enseignement, formation",
  17: "Bar, cabaret, discothèque",
  18: "Concession automobile, garage, moto et camping car",
  19: "Autres secteurs d'activité",
  20: "Casino (jeux)",
  21: "Association bénévole (amicale des pompiers, club...)",
  22: "Domaine viticole, maison de champagne, vigneron, brasserie",
  24: "Congrès, salon, foire",
  25: "Comité social et économique (CSE)",
  26: "Photographe",
  27: "Prestataire événementiel (location de matériel, dj, sonorisation, éclairage,...)",
  28: "Loisirs",
  29: "Association event sportif",
  30: "Clubs sportifs professionnels, fédérations sportives",
  31: "Beauté, Bien-être",
  32: "Transport aérien, routier, férroviaire",
  34: "Agroalimentaire",
  35: "Médias et régies publicitaires",
  36: "Culture (musées, festivals...)",
  37: "Liste BDE et assos étudiantes",
  38: "Immobilier (agences et promoteurs)",
  39: "Mode (vêtements & accessoires)",
  40: "Leasing (Grenke & Locam)",
  41: "Industrie",
  42: "conseils aux entreprises, consulting, webmarketing, informatique",
  43: "Bâtiments Travaux publics",
  44: "Web agency - agence marketing",
  45: "Ingénierie, management de projets",
  46: "Emploi, interim",
  47: "Energie",
  48: "Artisans",
  49: "profession libérale (avocat, comptable ...)",
  50: "syndicats et partis politiques",
  51: "Télécom",
  52: "Services aux pros",
  53: "Fabricant",
  54: "Informatique - IT",
  55: "Edition - imprimerie",
  56: "associations culturelles",
};

async function main() {
  const apply = process.argv.includes('--apply');

  const existing = await prisma.secteurActivite.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, nom: true },
  });
  console.log(`Base : ${existing.length} secteurs`);

  const taken = new Set(existing.map((s) => s.nom));
  const plan = [];
  const skipped = [];

  for (const sector of existing) {
    const m = /^Secteur (\d+)$/.exec(sector.nom);
    if (!m) continue; // nom déjà correct

    const target = SECTOR_NAMES[Number(m[1])];
    if (!target) {
      skipped.push(`${sector.nom} : id CRM inconnu`);
      continue;
    }
    if (taken.has(target)) {
      skipped.push(`${sector.nom} : le nom "${target}" existe déjà`);
      continue;
    }
    taken.add(target);
    plan.push({ id: sector.id, from: sector.nom, to: target });
  }

  if (plan.length === 0) {
    console.log('Rien à corriger : aucun nom de repli `Secteur <n>` trouvé.');
  } else {
    console.log(`\n${plan.length} secteur(s) à renommer :`);
    for (const p of plan) console.log(`  ${p.from}  ->  ${p.to}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} ignoré(s) :`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (!apply) {
    console.log('\n[dry-run] Aucune écriture. Relancer avec --apply pour appliquer.');
    return;
  }

  if (plan.length > 0) {
    await prisma.$transaction(
      plan.map((p) => prisma.secteurActivite.update({ where: { id: p.id }, data: { nom: p.to } })),
    );
    console.log(`\n${plan.length} secteur(s) renommé(s).`);
  }
}

main()
  .catch((e) => {
    console.error('Fix sector names failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
