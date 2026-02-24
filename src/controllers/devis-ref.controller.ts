import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { devisRefService } from '../services/devis-ref.service';

class DevisRefController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const devis = await devisRefService.findByClientId(clientId);
      res.json({ success: true, data: devis });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const devis = await devisRefService.create(clientId, req.body);
      res.status(201).json({ success: true, data: devis });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      const devis = await devisRefService.update(id, clientId, req.body);
      res.json({ success: true, data: devis });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await devisRefService.delete(id, clientId);
      res.json({ success: true, data: { message: 'Devis supprimé avec succès' } });
    } catch (error) {
      next(error);
    }
  }
}

export const devisRefController = new DevisRefController();
