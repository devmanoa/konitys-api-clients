import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randPhone(prefix: string) {
  return prefix + Array.from({ length: 8 }, () => String(randInt(0, 9))).join('');
}
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function randSiret() {
  return Array.from({ length: 14 }, () => String(randInt(0, 9))).join('');
}
function randSiren() {
  return Array.from({ length: 9 }, () => String(randInt(0, 9))).join('');
}

// ── Data pools ───────────────────────────────────────────────────
const PRENOMS_M = [
  'Jean', 'Pierre', 'Michel', 'Philippe', 'Alain', 'Patrick', 'Nicolas', 'Christophe',
  'François', 'Frédéric', 'Laurent', 'Olivier', 'Thierry', 'Stéphane', 'David', 'Marc',
  'Éric', 'Bruno', 'Julien', 'Antoine', 'Thomas', 'Sébastien', 'Alexandre', 'Romain',
  'Maxime', 'Vincent', 'Yannick', 'Guillaume', 'Fabrice', 'Cédric',
];
const PRENOMS_F = [
  'Marie', 'Nathalie', 'Isabelle', 'Catherine', 'Sylvie', 'Sophie', 'Valérie', 'Christine',
  'Sandrine', 'Céline', 'Véronique', 'Anne', 'Stéphanie', 'Laurence', 'Caroline', 'Émilie',
  'Julie', 'Camille', 'Marine', 'Charlotte', 'Aurélie', 'Delphine', 'Virginie', 'Claire',
  'Hélène', 'Laetitia', 'Amandine', 'Pauline', 'Mélanie', 'Élise',
];
const NOMS = [
  'Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois',
  'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Leroy', 'Roux', 'David',
  'Bertrand', 'Morel', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine',
  'Rousseau', 'Vincent', 'Muller', 'Lefevre', 'Faure', 'Andre', 'Mercier', 'Blanc',
  'Guerin', 'Boyer', 'Garnier', 'Chevalier', 'François', 'Legrand', 'Gauthier', 'Garcia',
  'Perrin', 'Robin', 'Clement', 'Morin', 'Nicolas', 'Henry', 'Roussel', 'Mathieu',
  'Gautier', 'Masson',
];

const ENTREPRISE_PREFIXES = [
  'Groupe', 'Cabinet', 'Agence', 'Studio', 'Atelier', 'Institut', 'Centre', 'Maison',
  'Société', 'Compagnie', 'Entreprise',
];
const ENTREPRISE_SUFFIXES = ['SAS', 'SARL', 'SA', 'SCI', 'EURL', 'SNC', '& Associés', '& Fils', 'Conseil', 'Services'];
const ENTREPRISE_DOMAINS = [
  'Solutions', 'Consulting', 'Digital', 'Tech', 'Innovation', 'Pro', 'Express', 'France',
  'Système', 'Réseau', 'Design', 'Communication', 'Événements', 'Formation', 'Logistique',
  'Immobilier', 'Finance', 'Énergie', 'Habitat', 'Environnement', 'Santé', 'Sport',
  'Médias', 'Industrie', 'Développement',
];

const RUES = [
  'Rue de la Paix', 'Avenue des Champs-Élysées', 'Boulevard Haussmann', 'Rue du Commerce',
  'Avenue de la République', 'Rue Victor Hugo', 'Boulevard Voltaire', 'Rue de Rivoli',
  'Avenue Pasteur', 'Rue Jean Jaurès', 'Place de la Liberté', 'Impasse des Lilas',
  'Allée des Tilleuls', 'Chemin du Moulin', 'Route de Lyon', 'Avenue du Général de Gaulle',
  'Rue Gambetta', 'Boulevard de Strasbourg', 'Rue Nationale', 'Rue du Faubourg Saint-Antoine',
  'Rue de la Gare', 'Avenue de la Marne', 'Rue Émile Zola', 'Place du Marché',
  'Rue Marcel Pagnol', 'Boulevard des Alpes', 'Rue Montaigne', 'Chemin des Vignes',
];

const VILLES: { ville: string; cp: string; dep: string }[] = [
  { ville: 'PARIS', cp: '75001', dep: '75' }, { ville: 'PARIS', cp: '75008', dep: '75' },
  { ville: 'PARIS', cp: '75015', dep: '75' }, { ville: 'PARIS', cp: '75011', dep: '75' },
  { ville: 'MARSEILLE', cp: '13001', dep: '13' }, { ville: 'MARSEILLE', cp: '13008', dep: '13' },
  { ville: 'LYON', cp: '69001', dep: '69' }, { ville: 'LYON', cp: '69003', dep: '69' },
  { ville: 'LYON', cp: '69006', dep: '69' }, { ville: 'TOULOUSE', cp: '31000', dep: '31' },
  { ville: 'NICE', cp: '06000', dep: '06' }, { ville: 'NANTES', cp: '44000', dep: '44' },
  { ville: 'STRASBOURG', cp: '67000', dep: '67' }, { ville: 'MONTPELLIER', cp: '34000', dep: '34' },
  { ville: 'BORDEAUX', cp: '33000', dep: '33' }, { ville: 'LILLE', cp: '59000', dep: '59' },
  { ville: 'RENNES', cp: '35000', dep: '35' }, { ville: 'REIMS', cp: '51100', dep: '51' },
  { ville: 'TOULON', cp: '83000', dep: '83' }, { ville: 'GRENOBLE', cp: '38000', dep: '38' },
  { ville: 'DIJON', cp: '21000', dep: '21' }, { ville: 'ANGERS', cp: '49000', dep: '49' },
  { ville: 'NIMES', cp: '30000', dep: '30' }, { ville: 'AIX-EN-PROVENCE', cp: '13100', dep: '13' },
  { ville: 'CLERMONT-FERRAND', cp: '63000', dep: '63' }, { ville: 'TOURS', cp: '37000', dep: '37' },
  { ville: 'LIMOGES', cp: '87000', dep: '87' }, { ville: 'AMIENS', cp: '80000', dep: '80' },
  { ville: 'METZ', cp: '57000', dep: '57' }, { ville: 'BESANCON', cp: '25000', dep: '25' },
  { ville: 'PERPIGNAN', cp: '66000', dep: '66' }, { ville: 'ORLÉANS', cp: '45000', dep: '45' },
  { ville: 'ROUEN', cp: '76000', dep: '76' }, { ville: 'CAEN', cp: '14000', dep: '14' },
  { ville: 'MULHOUSE', cp: '68100', dep: '68' }, { ville: 'NANCY', cp: '54000', dep: '54' },
  { ville: 'AVIGNON', cp: '84000', dep: '84' }, { ville: 'POITIERS', cp: '86000', dep: '86' },
  { ville: 'CANNES', cp: '06400', dep: '06' }, { ville: 'VERSAILLES', cp: '78000', dep: '78' },
];

const POSITIONS = [
  'Directeur Général', 'Directeur Commercial', 'Responsable Marketing', 'Chef de Projet',
  'Responsable Communication', 'Directeur Technique', 'Responsable RH', 'DAF',
  'Responsable Achats', 'Chargé de clientèle', 'Assistant de direction', 'Gérant',
  'Responsable Qualité', 'Directeur des Opérations', 'Responsable Logistique',
];

// ── Main seed ────────────────────────────────────────────────────
async function main() {
  console.log('Seeding database...');

  // Countries
  const france = await prisma.country.upsert({
    where: { code: 'FR' },
    update: {},
    create: { nom: 'France', code: 'FR', phonecode: '33' },
  });
  await prisma.country.upsert({
    where: { code: 'BE' },
    update: {},
    create: { nom: 'Belgique', code: 'BE', phonecode: '32' },
  });
  await prisma.country.upsert({
    where: { code: 'CH' },
    update: {},
    create: { nom: 'Suisse', code: 'CH', phonecode: '41' },
  });
  await prisma.country.upsert({
    where: { code: 'IT' },
    update: {},
    create: { nom: 'Italie', code: 'IT', phonecode: '39' },
  });

  // Client groups (upsert-like: find or create)
  const groupeNames = ['PME', 'Grande Entreprise', 'TPE', 'Association', 'Collectivité'];
  const groupes: { id: number; nom: string }[] = [];
  for (const nom of groupeNames) {
    let g = await prisma.groupeClient.findFirst({ where: { nom } });
    if (!g) g = await prisma.groupeClient.create({ data: { nom } });
    groupes.push(g);
  }

  // Source leads
  const sourceNames = ['Site web', 'Salon professionnel', 'Recommandation', 'Prospection téléphonique', 'Réseaux sociaux', 'Partenaire', 'Google Ads', 'Autre'];
  const sources: { id: number; nom: string }[] = [];
  for (const nom of sourceNames) {
    let s = await prisma.sourceLead.findFirst({ where: { nom } });
    if (!s) s = await prisma.sourceLead.create({ data: { nom } });
    sources.push(s);
  }

  // Sectors
  const secteurNames = [
    'Agroalimentaire', 'Automobile', 'BTP / Construction', 'Commerce / Distribution',
    'Communication / Marketing', 'Culture / Loisirs', 'Education / Formation',
    'Energie', 'Evénementiel', 'Finance / Assurance', 'Immobilier',
    'Industrie', 'Informatique / Numérique', 'Luxe / Mode', 'Restauration / Hôtellerie',
    'Santé / Médical', 'Services aux entreprises', 'Sport', 'Tourisme', 'Transport / Logistique',
  ];
  const secteurs: { id: number }[] = [];
  for (const nom of secteurNames) {
    let s = await prisma.secteurActivite.findFirst({ where: { nom } });
    if (!s) s = await prisma.secteurActivite.create({ data: { nom } });
    secteurs.push(s);
  }

  // Contact types
  const ctNames = ['Direction', 'Commercial', 'Technique', 'Comptabilité', 'Communication', 'RH'];
  const contactTypes: { id: number }[] = [];
  for (const nom of ctNames) {
    let ct = await prisma.contactType.findFirst({ where: { nom } });
    if (!ct) ct = await prisma.contactType.create({ data: { nom } });
    contactTypes.push(ct);
  }

  // Opportunity statuses
  const statusDefs = [
    { nom: 'Nouveau', type: 'open' as const, couleur: '#3B82F6', ordre: 1 },
    { nom: 'En cours', type: 'open' as const, couleur: '#F59E0B', ordre: 2 },
    { nom: 'Gagné', type: 'won' as const, couleur: '#10B981', ordre: 3 },
    { nom: 'Perdu', type: 'lost' as const, couleur: '#EF4444', ordre: 4 },
    { nom: 'Annulé', type: 'cancelled' as const, couleur: '#6B7280', ordre: 5 },
    { nom: 'Fermé', type: 'closed' as const, couleur: '#374151', ordre: 6 },
  ];
  for (const sd of statusDefs) {
    const exists = await prisma.opportunityStatus.findFirst({ where: { nom: sd.nom } });
    if (!exists) await prisma.opportunityStatus.create({ data: sd });
  }

  // Pipeline with stages
  let pipeline = await prisma.pipeline.findFirst({ where: { nom: 'Pipeline Commercial' } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: {
        nom: 'Pipeline Commercial',
        isActive: true,
        stages: {
          create: [
            { nom: 'Prospect', couleur: '#3B82F6', ordre: 1, probability: 10 },
            { nom: 'Qualification', couleur: '#8B5CF6', ordre: 2, probability: 25 },
            { nom: 'Proposition', couleur: '#F59E0B', ordre: 3, probability: 50 },
            { nom: 'Négociation', couleur: '#F97316', ordre: 4, probability: 75 },
            { nom: 'Closing', couleur: '#10B981', ordre: 5, probability: 90 },
          ],
        },
      },
    });
  }

  // ── Generate 500 clients ─────────────────────────────────────
  console.log('Generating 500 clients...');

  const TOTAL = 500;
  const CORP_RATIO = 0.7; // 70% corporations, 30% persons

  for (let i = 0; i < TOTAL; i++) {
    const isCorp = Math.random() < CORP_RATIO;
    const ville = pick(VILLES);
    const isQualifie = Math.random() < 0.3;
    const isClient = Math.random() < 0.6;
    const groupe = pick(groupes);
    const source = pick(sources);

    if (isCorp) {
      // Generate corporation
      const nom1 = pick(NOMS);
      const domain = pick(ENTREPRISE_DOMAINS);
      const usePrefixed = Math.random() < 0.3;
      const companyName = usePrefixed
        ? `${pick(ENTREPRISE_PREFIXES)} ${nom1} ${domain}`
        : `${nom1} ${domain}`;
      const suffix = pick(ENTREPRISE_SUFFIXES);
      const enseigne = `${companyName} ${suffix}`;
      const emailDomain = slugify(companyName) + '.fr';

      const client = await prisma.client.create({
        data: {
          clientType: 'corporation',
          nom: companyName,
          enseigne,
          email: `contact@${emailDomain}`,
          telephone: randPhone('01'),
          mobile: Math.random() < 0.4 ? randPhone('06') : undefined,
          adresse: `${randInt(1, 200)} ${pick(RUES)}`,
          cp: ville.cp,
          ville: ville.ville,
          departement: ville.dep,
          paysId: france.id,
          groupeClientId: groupe.id,
          sourceLeadId: source.id,
          typeCommercial: isClient ? 'client' : 'prospect',
          isQualifie,
          siren: randSiren(),
          siret: randSiret(),
          siteWeb: Math.random() < 0.5 ? `https://www.${emailDomain}` : undefined,
          effectif: Math.random() < 0.6 ? randInt(1, 500) : undefined,
          chiffreAffaire: Math.random() < 0.4 ? randInt(50000, 5000000) : undefined,
        },
      });

      // Add 1-3 contacts
      const nbContacts = randInt(1, 3);
      for (let j = 0; j < nbContacts; j++) {
        const isFemale = Math.random() < 0.5;
        const contactPrenom = isFemale ? pick(PRENOMS_F) : pick(PRENOMS_M);
        const contactNom = pick(NOMS);
        await prisma.clientContact.create({
          data: {
            clientId: client.id,
            civilite: isFemale ? 'Mme' : 'M',
            nom: contactNom,
            prenom: contactPrenom,
            position: pick(POSITIONS),
            email: `${slugify(contactPrenom)}.${slugify(contactNom)}@${emailDomain}`,
            tel: randPhone('01'),
            telephone2: Math.random() < 0.3 ? randPhone('06') : undefined,
            contactTypeId: pick(contactTypes).id,
            isPrimary: j === 0,
          },
        });
      }

      // Add 1-2 sectors
      const nbSectors = randInt(1, 2);
      const usedSectors = new Set<number>();
      for (let j = 0; j < nbSectors; j++) {
        const sector = pick(secteurs);
        if (!usedSectors.has(sector.id)) {
          usedSectors.add(sector.id);
          await prisma.clientSector.create({
            data: { clientId: client.id, sectorId: sector.id },
          }).catch(() => {}); // skip duplicates
        }
      }
    } else {
      // Generate person
      const isFemale = Math.random() < 0.5;
      const prenom = isFemale ? pick(PRENOMS_F) : pick(PRENOMS_M);
      const nom = pick(NOMS);

      await prisma.client.create({
        data: {
          clientType: 'person',
          nom,
          prenom,
          email: `${slugify(prenom)}.${slugify(nom)}@email.fr`,
          telephone: randPhone('06'),
          mobile: randPhone('07'),
          adresse: `${randInt(1, 200)} ${pick(RUES)}`,
          cp: ville.cp,
          ville: ville.ville,
          departement: ville.dep,
          paysId: france.id,
          groupeClientId: Math.random() < 0.3 ? groupe.id : undefined,
          sourceLeadId: source.id,
          typeCommercial: isClient ? 'client' : 'prospect',
          isQualifie,
        },
      });
    }

    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${TOTAL} clients created`);
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
