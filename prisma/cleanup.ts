import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Delete random seed clients (id > 3), keeping the original 3
  const deleted = await prisma.client.deleteMany({
    where: { id: { gt: 3 } },
  });
  console.log('Deleted:', deleted.count, 'clients');
  const remaining = await prisma.client.count();
  console.log('Remaining:', remaining, 'clients');
}
main().finally(() => prisma.$disconnect());
