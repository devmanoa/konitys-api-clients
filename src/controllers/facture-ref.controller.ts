import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { factureRefService } from '../services/facture-ref.service';

class FactureRefController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const factures = await factureRefService.findByClientId(clientId);
      res.json({ success: true, data: factures });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const facture = await factureRefService.create(clientId, req.body);
      res.status(201).json({ success: true, data: facture });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      const facture = await factureRefService.update(id, clientId, req.body);
      res.json({ success: true, data: facture });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await factureRefService.delete(id, clientId);
      res.json({ success: true, data: { message: 'Facture supprimée avec succès' } });
    } catch (error) {
      next(error);
    }
  }
}

export const factureRefController = new FactureRefController();
