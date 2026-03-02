import { FactureStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

class AvoirRefService {
  async findByClientId(clientId: number) {
    return prisma.avoirRef.findMany({
      where: { clientId },
      orderBy: { dateCreation: 'desc' },
    });
  }

  async findById(id: number) {
    const avoir = await prisma.avoirRef.findUnique({ where: { id } });
    if (!avoir) throw new NotFoundError('AvoirRef');
    return avoir;
  }

  async create(clientId: number, data: {
    indent?: string;
    objet?: string;
    status?: FactureStatus;
    totalHt?: number;
    totalTtc?: number;
    totalTva?: number;
    dateCreation?: string;
    restantDu?: number;
    nbrReglement?: number;
    factureIndent?: string;
    commercialNom?: string;
    idAvoirCrm?: string;
  }) {
    return prisma.avoirRef.create({
      data: {
        clientId,
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
      },
    });
  }

  async update(id: number, clientId: number, data: {
    indent?: string;
    objet?: string;
    status?: FactureStatus;
    totalHt?: number;
    totalTtc?: number;
    totalTva?: number;
    dateCreation?: string;
    restantDu?: number;
    nbrReglement?: number;
    factureIndent?: string;
    commercialNom?: string;
    idAvoirCrm?: string;
  }) {
    const existing = await prisma.avoirRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('AvoirRef');

    return prisma.avoirRef.update({
      where: { id },
      data: {
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
      },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.avoirRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('AvoirRef');
    return prisma.avoirRef.delete({ where: { id } });
  }
}

export const avoirRefService = new AvoirRefService();
