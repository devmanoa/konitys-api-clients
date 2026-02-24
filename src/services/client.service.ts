import { Prisma, ClientType, TypeCommercial } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { buildPaginationResult, PaginationResult } from '../utils/pagination';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface ClientFilters {
  key?: string;
  clientType?: ClientType;
  typeCommercial?: TypeCommercial;
  groupeClientId?: number;
  sourceLeadId?: number;
  departement?: string;
  sectorIds?: number[];
  isQualifie?: boolean;
  hasAddress?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface ClientListResult {
  data: any[];
  pagination: PaginationResult;
}

class ClientService {
  async findAll(params: {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    filters: ClientFilters;
  }): Promise<ClientListResult> {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc', filters } = params;
    const where = this.buildWhereClause(filters);

    const [data, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          groupeClient: true,
          pays: true,
          sourceLead: true,
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
          sectors: {
            include: { sector: true },
          },
          _count: {
            select: {
              opportunities: true,
              comments: true,
              contacts: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);

    return {
      data,
      pagination: buildPaginationResult(page, limit, total),
    };
  }

  async findById(id: number) {
    const client = await prisma.client.findFirst({
      where: { id, isDeleted: false },
      include: {
        groupeClient: true,
        pays: true,
        sourceLead: true,
        contacts: {
          include: { contactType: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        addresses: {
          include: { pays: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        sectors: {
          include: { sector: true },
        },
        comments: {
          include: { attachments: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        opportunities: {
          include: {
            pipeline: true,
            stage: true,
            status: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        devisRefs: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            opportunities: true,
            comments: true,
            contacts: true,
            addresses: true,
            devisRefs: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundError('Client');
    }

    return client;
  }

  async create(data: Prisma.ClientCreateInput & { sectorIds?: number[] }) {
    const { sectorIds, ...clientData } = data;

    const client = await prisma.client.create({
      data: {
        ...clientData,
        sectors: sectorIds?.length
          ? {
              create: sectorIds.map((sectorId) => ({
                sectorId,
              })),
            }
          : undefined,
      },
      include: {
        groupeClient: true,
        pays: true,
        sectors: { include: { sector: true } },
      },
    });

    return client;
  }

  async update(id: number, data: Prisma.ClientUpdateInput & { sectorIds?: number[] }) {
    const existing = await prisma.client.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      throw new NotFoundError('Client');
    }

    const { sectorIds, ...clientData } = data;

    // Update sectors if provided
    if (sectorIds !== undefined) {
      await prisma.clientSector.deleteMany({ where: { clientId: id } });
      if (sectorIds.length > 0) {
        await prisma.clientSector.createMany({
          data: sectorIds.map((sectorId) => ({
            clientId: id,
            sectorId,
          })),
        });
      }
    }

    const client = await prisma.client.update({
      where: { id },
      data: clientData,
      include: {
        groupeClient: true,
        pays: true,
        sectors: { include: { sector: true } },
        contacts: true,
      },
    });

    return client;
  }

  async softDelete(id: number) {
    const existing = await prisma.client.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      throw new NotFoundError('Client');
    }

    // Check if client has linked opportunities
    const oppCount = await prisma.opportunity.count({ where: { clientId: id } });
    if (oppCount > 0) {
      throw new ValidationError(
        `Impossible de supprimer ce client : ${oppCount} opportunité(s) liée(s)`,
      );
    }

    return prisma.client.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async search(query: string, limit = 10) {
    if (!query || query.length < 2) return [];

    return prisma.client.findMany({
      where: {
        isDeleted: false,
        OR: [
          { nom: { contains: query, mode: 'insensitive' } },
          { prenom: { contains: query, mode: 'insensitive' } },
          { enseigne: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { codeQuadra: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        enseigne: true,
        clientType: true,
        email: true,
        telephone: true,
        ville: true,
      },
      take: limit,
      orderBy: { nom: 'asc' },
    });
  }

  async findDuplicates(page: number, limit: number) {
    // Find clients with same nom+email or same enseigne
    const duplicates = await prisma.$queryRaw<any[]>`
      SELECT c1.id, c1.nom, c1.prenom, c1.enseigne, c1.email, c1.telephone, c1.ville, c1.client_type,
             c2.id as duplicate_id, c2.nom as duplicate_nom, c2.prenom as duplicate_prenom,
             c2.enseigne as duplicate_enseigne, c2.email as duplicate_email
      FROM clients c1
      JOIN clients c2 ON c1.id < c2.id
        AND c1.is_deleted = false AND c2.is_deleted = false
        AND (
          (LOWER(c1.nom) = LOWER(c2.nom) AND c1.nom != '' AND c1.client_type = 'corporation')
          OR (c1.email = c2.email AND c1.email != '' AND c1.email IS NOT NULL)
        )
      ORDER BY c1.nom ASC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;

    return duplicates;
  }

  async bulkDelete(ids: number[]) {
    return prisma.client.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async bulkAssignSectors(clientIds: number[], sectorIds: number[]) {
    const data = clientIds.flatMap((clientId) =>
      sectorIds.map((sectorId) => ({ clientId, sectorId })),
    );

    // Use skipDuplicates to avoid unique constraint errors
    return prisma.clientSector.createMany({
      data,
      skipDuplicates: true,
    });
  }

  private buildWhereClause(filters: ClientFilters): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { isDeleted: false };

    if (filters.key) {
      where.OR = [
        { nom: { contains: filters.key, mode: 'insensitive' } },
        { prenom: { contains: filters.key, mode: 'insensitive' } },
        { enseigne: { contains: filters.key, mode: 'insensitive' } },
        { email: { contains: filters.key, mode: 'insensitive' } },
        { codeQuadra: { contains: filters.key, mode: 'insensitive' } },
      ];
    }
    if (filters.clientType) where.clientType = filters.clientType;
    if (filters.typeCommercial) where.typeCommercial = filters.typeCommercial;
    if (filters.groupeClientId) where.groupeClientId = filters.groupeClientId;
    if (filters.sourceLeadId) where.sourceLeadId = filters.sourceLeadId;
    if (filters.departement) where.departement = filters.departement;
    if (filters.isQualifie !== undefined) where.isQualifie = filters.isQualifie;

    if (filters.sectorIds?.length) {
      where.sectors = { some: { sectorId: { in: filters.sectorIds } } };
    }

    if (filters.hasAddress === true) {
      where.ville = { not: null };
    } else if (filters.hasAddress === false) {
      where.ville = null;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    return where;
  }
}

export const clientService = new ClientService();
