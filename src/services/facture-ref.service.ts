import { FactureStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

class FactureRefService {
  async findByClientId(clientId: number) {
    return prisma.factureRef.findMany({
      where: { clientId },
      orderBy: { dateCreation: 'desc' },
    });
  }

  async findById(id: number) {
    const facture = await prisma.factureRef.findUnique({ where: { id } });
    if (!facture) throw new NotFoundError('FactureRef');
    return facture;
  }

  async create(clientId: number, data: {
    indent?: string;
    objet?: string;
    status?: FactureStatus;
    totalHt?: number;
    totalTtc?: number;
    totalTva?: number;
    dateCreation?: string;
    dateEvenement?: string;
    restantDu?: number;
    nbrReglement?: number;
    commercialNom?: string;
    idFactureCrm?: string;
  }) {
    return prisma.factureRef.create({
      data: {
        clientId,
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
        dateEvenement: data.dateEvenement ? new Date(data.dateEvenement) : undefined,
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
    dateEvenement?: string;
    restantDu?: number;
    nbrReglement?: number;
    commercialNom?: string;
    idFactureCrm?: string;
  }) {
    const existing = await prisma.factureRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('FactureRef');

    return prisma.factureRef.update({
      where: { id },
      data: {
        ...data,
        dateCreation: data.dateCreation ? new Date(data.dateCreation) : undefined,
        dateEvenement: data.dateEvenement ? new Date(data.dateEvenement) : undefined,
      },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.factureRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('FactureRef');
    return prisma.factureRef.delete({ where: { id } });
  }
}

export const factureRefService = new FactureRefService();
