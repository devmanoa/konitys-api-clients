const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Seed reference data only (contact types, etc.)
 * Safe to run multiple times: creates missing, removes obsolete.
 */
async function main() {
  const contactTypes = ['Commercial', 'Facturation', 'Projet'];

  for (const nom of contactTypes) {
    const exists = await prisma.contactType.findFirst({ where: { nom } });
    if (!exists) await prisma.contactType.create({ data: { nom } });
  }

  // Remove old contact types no longer needed
  await prisma.contactType.deleteMany({
    where: { nom: { notIn: contactTypes } },
  });

  console.log('Reference data seeded.');
}

main()
  .catch((e) => {
    console.error('Seed ref failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
