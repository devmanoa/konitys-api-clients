import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

interface AddressInput {
  label?: string | null;
  adresse?: string | null;
  adresse2?: string | null;
  cp?: string | null;
  ville?: string | null;
  paysId?: number | null;
  isPrimary?: boolean;
}

class ClientAddressService {
  async findByClientId(clientId: number) {
    return prisma.clientAddress.findMany({
      where: { clientId },
      include: { pays: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(clientId: number, data: AddressInput) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, isDeleted: false },
      select: { id: true },
    });
    if (!client) throw new NotFoundError('Client');

    // La première adresse d'un client devient la principale d'office : sans ça
    // un client pourrait n'en avoir aucune.
    const existingCount = await prisma.clientAddress.count({ where: { clientId } });
    const isPrimary = data.isPrimary || existingCount === 0;

    if (isPrimary) {
      await prisma.clientAddress.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return prisma.clientAddress.create({
      data: { ...data, clientId, isPrimary },
      include: { pays: true },
    });
  }

  async update(id: number, clientId: number, data: AddressInput) {
    const existing = await prisma.clientAddress.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('Adresse');

    if (data.isPrimary) {
      await prisma.clientAddress.updateMany({
        where: { clientId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
    }

    return prisma.clientAddress.update({
      where: { id },
      data,
      include: { pays: true },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.clientAddress.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('Adresse');

    await prisma.clientAddress.delete({ where: { id } });

    // Supprimer la principale laisserait le client sans adresse par défaut :
    // on promeut la plus ancienne des restantes.
    if (existing.isPrimary) {
      const next = await prisma.clientAddress.findFirst({
        where: { clientId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await prisma.clientAddress.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    return { id };
  }
}

export const clientAddressService = new ClientAddressService();
