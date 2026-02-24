import { DevisStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

class DevisRefService {
  async findByClientId(clientId: number) {
    return prisma.devisRef.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: number) {
    const devis = await prisma.devisRef.findUnique({ where: { id } });
    if (!devis) throw new NotFoundError('DevisRef');
    return devis;
  }

  async create(clientId: number, data: {
    indent?: string;
    objet?: string;
    status?: DevisStatus;
    totalHt?: number;
    totalTtc?: number;
    totalTva?: number;
    dateCreation?: string;
    dateValidite?: string;
    dateSignature?: string;
    commercialId?: number;
    commercialNom?: string;
    note?: string;
    idDevisCrm?: string;
  }) {
    return prisma.devisRef.create({
      data: {
        clientId,
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
        dateValidite: data.dateValidite ? new Date(data.dateValidite) : undefined,
        dateSignature: data.dateSignature ? new Date(data.dateSignature) : undefined,
      },
    });
  }

  async update(id: number, clientId: number, data: {
    indent?: string;
    objet?: string;
    status?: DevisStatus;
    totalHt?: number;
    totalTtc?: number;
    totalTva?: number;
    dateCreation?: string;
    dateValidite?: string;
    dateSignature?: string;
    commercialId?: number;
    commercialNom?: string;
    note?: string;
    idDevisCrm?: string;
  }) {
    const existing = await prisma.devisRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('DevisRef');

    return prisma.devisRef.update({
      where: { id },
      data: {
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
        dateValidite: data.dateValidite ? new Date(data.dateValidite) : undefined,
        dateSignature: data.dateSignature ? new Date(data.dateSignature) : undefined,
      },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.devisRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('DevisRef');
    return prisma.devisRef.delete({ where: { id } });
  }
}

export const devisRefService = new DevisRefService();
