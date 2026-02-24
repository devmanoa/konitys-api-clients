import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { clientService, ClientFilters } from '../services/client.service';
import { parsePagination } from '../utils/pagination';
import { ClientType, TypeCommercial } from '@prisma/client';

class ClientController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query as Record<string, any>);
      const sortByParam = (req.query.sortBy as string) || 'createdAt';
      const sortByMap: Record<string, string> = {
        created_at: 'createdAt',
        updated_at: 'updatedAt',
      };
      const sortBy = sortByMap[sortByParam] || sortByParam;
      const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';

      const filters: ClientFilters = {
        key: req.query.key as string,
        clientType: req.query.clientType as ClientType,
        typeCommercial: req.query.typeCommercial as TypeCommercial,
        groupeClientId: req.query.groupeClientId ? parseInt(req.query.groupeClientId as string) : undefined,
        sourceLeadId: req.query.sourceLeadId ? parseInt(req.query.sourceLeadId as string) : undefined,
        departement: req.query.departement as string,
        sectorIds: req.query.sectorIds ? (req.query.sectorIds as string).split(',').map(Number) : undefined,
        isQualifie: req.query.isQualifie !== undefined ? req.query.isQualifie === 'true' : undefined,
        hasAddress: req.query.hasAddress !== undefined ? req.query.hasAddress === 'true' : undefined,
        dateFrom: req.query.dateFrom as string,
        dateTo: req.query.dateTo as string,
      };

      const result = await clientService.findAll({ page, limit, sortBy, sortOrder, filters });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id);
      const client = await clientService.findById(id);

      res.json({
        success: true,
        data: client,
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { sectorIds, ...clientData } = req.body;

      const client = await clientService.create({
        ...clientData,
        createdBy: req.user?.sub ? parseInt(req.user.sub) : undefined,
        sectorIds,
      });

      res.status(201).json({
        success: true,
        data: client,
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id);
      const { sectorIds, ...clientData } = req.body;

      const client = await clientService.update(id, {
        ...clientData,
        updatedBy: req.user?.sub ? parseInt(req.user.sub) : undefined,
        sectorIds,
      });

      res.json({
        success: true,
        data: client,
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id);
      await clientService.softDelete(id);

      res.json({
        success: true,
        data: { message: 'Client supprimé avec succès' },
      });
    } catch (error) {
      next(error);
    }
  }

  async search(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      const results = await clientService.search(query, limit);

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDuplicates(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query as Record<string, any>);
      const duplicates = await clientService.findDuplicates(page, limit);

      res.json({
        success: true,
        data: duplicates,
      });
    } catch (error) {
      next(error);
    }
  }

  async bulkAction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { action, clientIds, sectorIds } = req.body;

      if (!clientIds?.length) {
        return res.status(400).json({
          success: false,
          error: 'Aucun client sélectionné',
        });
      }

      switch (action) {
        case 'delete':
          await clientService.bulkDelete(clientIds);
          break;
        case 'assign_sectors':
          if (!sectorIds?.length) {
            return res.status(400).json({
              success: false,
              error: 'Aucun secteur sélectionné',
            });
          }
          await clientService.bulkAssignSectors(clientIds, sectorIds);
          break;
        default:
          return res.status(400).json({
            success: false,
            error: `Action inconnue: ${action}`,
          });
      }

      res.json({
        success: true,
        data: { message: 'Action effectuée avec succès' },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const clientController = new ClientController();
