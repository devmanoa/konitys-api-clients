import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.client.count();
  console.log('Total clients:', total);
  const noId = await prisma.client.count({ where: { idClientCrm: null } });
  console.log('Clients sans idClientCrm:', noId);
  const withId = await prisma.client.count({ where: { idClientCrm: { not: null } } });
  console.log('Clients avec idClientCrm:', withId);
}
main().finally(() => prisma.$disconnect());
