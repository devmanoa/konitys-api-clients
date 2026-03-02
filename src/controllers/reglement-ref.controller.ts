import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { reglementRefService } from '../services/reglement-ref.service';

class ReglementRefController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const reglements = await reglementRefService.findByClientId(clientId);
      res.json({ success: true, data: reglements });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const reglement = await reglementRefService.create(clientId, req.body);
      res.status(201).json({ success: true, data: reglement });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      const reglement = await reglementRefService.update(id, clientId, req.body);
      res.json({ success: true, data: reglement });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await reglementRefService.delete(id, clientId);
      res.json({ success: true, data: { message: 'Règlement supprimé avec succès' } });
    } catch (error) {
      next(error);
    }
  }
}

export const reglementRefController = new ReglementRefController();
