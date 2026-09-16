import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { sectorService } from '../services/sector.service';
import { ValidationError } from '../utils/errors';

/** parseInt('abc') vaut NaN et finirait en erreur Prisma opaque : on tranche ici. */
function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('Identifiant de secteur invalide');
  }
  return id;
}

class SectorController {
  async getAll(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sectors = await sectorService.findAll();
      res.json({ success: true, data: sectors });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sector = await sectorService.findById(parseId(req.params.id));
      res.json({ success: true, data: sector });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sector = await sectorService.create(req.body);
      res.status(201).json({ success: true, data: sector });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sector = await sectorService.update(parseId(req.params.id), req.body);
      res.json({ success: true, data: sector });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await sectorService.delete(parseId(req.params.id));
      res.json({
        success: true,
        data: { message: "Secteur d'activité supprimé avec succès" },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const sectorController = new SectorController();
