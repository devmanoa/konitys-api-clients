import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

class ClientContactService {
  async findByClientId(clientId: number) {
    return prisma.clientContact.findMany({
      where: { clientId },
      include: { contactType: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(clientId: number, data: {
    civilite?: string;
    nom: string;
    prenom?: string;
    position?: string;
    email?: string;
    tel?: string;
    telephone2?: string;
    contactTypeId?: number;
    isPrimary?: boolean;
  }) {
    // If this is primary, unset other primary contacts
    if (data.isPrimary) {
      await prisma.clientContact.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return prisma.clientContact.create({
      data: {
        clientId,
        ...data,
      },
      include: { contactType: true },
    });
  }

  async update(id: number, clientId: number, data: {
    civilite?: string;
    nom?: string;
    prenom?: string;
    position?: string;
    email?: string;
    tel?: string;
    telephone2?: string;
    contactTypeId?: number;
    isPrimary?: boolean;
  }) {
    const existing = await prisma.clientContact.findFirst({
      where: { id, clientId },
    });
    if (!existing) {
      throw new NotFoundError('Contact');
    }

    if (data.isPrimary) {
      await prisma.clientContact.updateMany({
        where: { clientId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
    }

    return prisma.clientContact.update({
      where: { id },
      data,
      include: { contactType: true },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.clientContact.findFirst({
      where: { id, clientId },
    });
    if (!existing) {
      throw new NotFoundError('Contact');
    }

    return prisma.clientContact.delete({ where: { id } });
  }
}

export const clientContactService = new ClientContactService();
