import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { clientAddressService } from '../services/client-address.service';
import { ValidationError } from '../utils/errors';

function parseId(raw: string, label: string): number {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`${label} invalide`);
  }
  return id;
}

class ClientAddressController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseId(req.params.clientId, 'Identifiant client');
      const addresses = await clientAddressService.findByClientId(clientId);
      res.json({ success: true, data: addresses });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseId(req.params.clientId, 'Identifiant client');
      const address = await clientAddressService.create(clientId, req.body);
      res.status(201).json({ success: true, data: address });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseId(req.params.clientId, 'Identifiant client');
      const id = parseId(req.params.id, 'Identifiant adresse');
      const address = await clientAddressService.update(id, clientId, req.body);
      res.json({ success: true, data: address });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseId(req.params.clientId, 'Identifiant client');
      const id = parseId(req.params.id, 'Identifiant adresse');
      await clientAddressService.delete(id, clientId);
      res.json({
        success: true,
        data: { message: 'Adresse supprimée avec succès' },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const clientAddressController = new ClientAddressController();
