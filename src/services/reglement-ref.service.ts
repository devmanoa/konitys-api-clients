import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';

class ReglementRefService {
  async findByClientId(clientId: number) {
    return prisma.reglementRef.findMany({
      where: { clientId },
      orderBy: { date: 'desc' },
    });
  }

  async findById(id: number) {
    const reglement = await prisma.reglementRef.findUnique({ where: { id } });
    if (!reglement) throw new NotFoundError('ReglementRef');
    return reglement;
  }

  async create(clientId: number, data: {
    type: string;
    date?: string;
    montant?: number;
    montantRestant?: number;
    moyenReglement?: string;
    reference?: string;
    note?: string;
    etat?: string;
    commercialNom?: string;
    idReglementCrm?: string;
  }) {
    return prisma.reglementRef.create({
      data: {
        clientId,
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });
  }

  async update(id: number, clientId: number, data: {
    type?: string;
    date?: string;
    montant?: number;
    montantRestant?: number;
    moyenReglement?: string;
    reference?: string;
    note?: string;
    etat?: string;
    commercialNom?: string;
    idReglementCrm?: string;
  }) {
    const existing = await prisma.reglementRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('ReglementRef');

    return prisma.reglementRef.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.reglementRef.findFirst({ where: { id, clientId } });
    if (!existing) throw new NotFoundError('ReglementRef');
    return prisma.reglementRef.delete({ where: { id } });
  }
}

export const reglementRefService = new ReglementRefService();
