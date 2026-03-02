import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { avoirRefService } from '../services/avoir-ref.service';

class AvoirRefController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const avoirs = await avoirRefService.findByClientId(clientId);
      res.json({ success: true, data: avoirs });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const avoir = await avoirRefService.create(clientId, req.body);
      res.status(201).json({ success: true, data: avoir });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      const avoir = await avoirRefService.update(id, clientId, req.body);
      res.json({ success: true, data: avoir });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await avoirRefService.delete(id, clientId);
      res.json({ success: true, data: { message: 'Avoir supprimé avec succès' } });
    } catch (error) {
      next(error);
    }
  }
}

export const avoirRefController = new AvoirRefController();
