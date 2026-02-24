import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { clientContactService } from '../services/client-contact.service';

class ClientContactController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const contacts = await clientContactService.findByClientId(clientId);

      res.json({
        success: true,
        data: contacts,
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const contact = await clientContactService.create(clientId, req.body);

      res.status(201).json({
        success: true,
        data: contact,
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      const contact = await clientContactService.update(id, clientId, req.body);

      res.json({
        success: true,
        data: contact,
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await clientContactService.delete(id, clientId);

      res.json({
        success: true,
        data: { message: 'Contact supprimé avec succès' },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const clientContactController = new ClientContactController();
