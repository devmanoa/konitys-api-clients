import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

  // Client groups
  const groupPME = await prisma.groupeClient.create({
    data: { nom: 'PME' },
  });
  const groupGE = await prisma.groupeClient.create({
    data: { nom: 'Grande Entreprise' },
  });
  await prisma.groupeClient.create({ data: { nom: 'TPE' } });
  await prisma.groupeClient.create({ data: { nom: 'Association' } });
  await prisma.groupeClient.create({ data: { nom: 'Collectivité' } });

  // Source leads
  const sourceWeb = await prisma.sourceLead.create({
    data: { nom: 'Site web' },
  });
  await prisma.sourceLead.create({ data: { nom: 'Salon professionnel' } });
  await prisma.sourceLead.create({ data: { nom: 'Recommandation' } });
  await prisma.sourceLead.create({ data: { nom: 'Prospection téléphonique' } });
  await prisma.sourceLead.create({ data: { nom: 'Réseaux sociaux' } });
  await prisma.sourceLead.create({ data: { nom: 'Partenaire' } });
  await prisma.sourceLead.create({ data: { nom: 'Google Ads' } });
  await prisma.sourceLead.create({ data: { nom: 'Autre' } });

  // Sectors
  const secteurs = [
    'Agroalimentaire', 'Automobile', 'BTP / Construction', 'Commerce / Distribution',
    'Communication / Marketing', 'Culture / Loisirs', 'Education / Formation',
    'Energie', 'Evénementiel', 'Finance / Assurance', 'Immobilier',
    'Industrie', 'Informatique / Numérique', 'Luxe / Mode', 'Restauration / Hôtellerie',
    'Santé / Médical', 'Services aux entreprises', 'Sport', 'Tourisme', 'Transport / Logistique',
  ];
  for (const nom of secteurs) {
    await prisma.secteurActivite.create({ data: { nom } });
  }

  // Contact types
  await prisma.contactType.create({ data: { nom: 'Direction' } });
  await prisma.contactType.create({ data: { nom: 'Commercial' } });
  await prisma.contactType.create({ data: { nom: 'Technique' } });
  await prisma.contactType.create({ data: { nom: 'Comptabilité' } });
  await prisma.contactType.create({ data: { nom: 'Communication' } });
  await prisma.contactType.create({ data: { nom: 'RH' } });

  // Opportunity statuses
  await prisma.opportunityStatus.create({
    data: { nom: 'Nouveau', type: 'open', couleur: '#3B82F6', ordre: 1 },
  });
  await prisma.opportunityStatus.create({
    data: { nom: 'En cours', type: 'open', couleur: '#F59E0B', ordre: 2 },
  });
  await prisma.opportunityStatus.create({
    data: { nom: 'Gagné', type: 'won', couleur: '#10B981', ordre: 3 },
  });
  await prisma.opportunityStatus.create({
    data: { nom: 'Perdu', type: 'lost', couleur: '#EF4444', ordre: 4 },
  });
  await prisma.opportunityStatus.create({
    data: { nom: 'Annulé', type: 'cancelled', couleur: '#6B7280', ordre: 5 },
  });
  await prisma.opportunityStatus.create({
    data: { nom: 'Fermé', type: 'closed', couleur: '#374151', ordre: 6 },
  });

  // Pipeline with stages
  const pipeline = await prisma.pipeline.create({
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

  // Sample clients
  const client1 = await prisma.client.create({
    data: {
      clientType: 'corporation',
      nom: 'ACME Solutions',
      enseigne: 'ACME',
      email: 'contact@acme-solutions.fr',
      telephone: '0145678901',
      adresse: '15 Rue de la Paix',
      cp: '75002',
      ville: 'PARIS',
      departement: '75',
      paysId: france.id,
      groupeClientId: groupGE.id,
      sourceLeadId: sourceWeb.id,
      typeCommercial: 'client',
      isQualifie: true,
      siret: '12345678901234',
    },
  });

  const client2 = await prisma.client.create({
    data: {
      clientType: 'corporation',
      nom: 'Tech Innov',
      enseigne: 'Tech Innov SAS',
      email: 'info@techinnov.fr',
      telephone: '0467891234',
      adresse: '28 Avenue de la Liberté',
      cp: '69003',
      ville: 'LYON',
      departement: '69',
      paysId: france.id,
      groupeClientId: groupPME.id,
      sourceLeadId: sourceWeb.id,
      typeCommercial: 'prospect',
    },
  });

  const client3 = await prisma.client.create({
    data: {
      clientType: 'person',
      nom: 'Dupont',
      prenom: 'Marie',
      email: 'marie.dupont@email.fr',
      telephone: '0612345678',
      adresse: '5 Rue du Commerce',
      cp: '33000',
      ville: 'BORDEAUX',
      departement: '33',
      paysId: france.id,
      typeCommercial: 'client',
    },
  });

  // Contacts for client 1
  await prisma.clientContact.create({
    data: {
      clientId: client1.id,
      civilite: 'M',
      nom: 'Martin',
      prenom: 'Jean',
      position: 'Directeur Commercial',
      email: 'j.martin@acme-solutions.fr',
      tel: '0145678902',
      isPrimary: true,
    },
  });
  await prisma.clientContact.create({
    data: {
      clientId: client1.id,
      civilite: 'Mme',
      nom: 'Bernard',
      prenom: 'Sophie',
      position: 'Responsable Communication',
      email: 's.bernard@acme-solutions.fr',
      tel: '0145678903',
    },
  });

  // Comments
  await prisma.clientComment.create({
    data: {
      clientId: client1.id,
      userName: 'Admin',
      contenu: '<p>Premier contact avec le client. Intéressé par nos solutions événementielles.</p>',
    },
  });

  // Opportunities
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: pipeline.id },
    orderBy: { ordre: 'asc' },
  });

  const statuses = await prisma.opportunityStatus.findMany();
  const statusNouveau = statuses.find((s) => s.nom === 'Nouveau')!;
  const statusEnCours = statuses.find((s) => s.nom === 'En cours')!;

  await prisma.opportunity.create({
    data: {
      nom: 'Événement annuel ACME 2026',
      clientId: client1.id,
      pipelineId: pipeline.id,
      stageId: stages[2].id, // Proposition
      statusId: statusEnCours.id,
      montant: 15000,
      probability: 60,
      isHot: true,
    },
  });

  await prisma.opportunity.create({
    data: {
      nom: 'Location bornes Tech Innov',
      clientId: client2.id,
      pipelineId: pipeline.id,
      stageId: stages[0].id, // Prospect
      statusId: statusNouveau.id,
      montant: 5000,
      probability: 20,
    },
  });

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
