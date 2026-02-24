import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../utils/prisma';

class ReferenceDataController {
  async getSectors(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sectors = await prisma.secteurActivite.findMany({
        orderBy: { nom: 'asc' },
        include: { children: true },
      });
      res.json({ success: true, data: sectors });
    } catch (error) {
      next(error);
    }
  }

  async getGroups(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const groups = await prisma.groupeClient.findMany({
        orderBy: { nom: 'asc' },
      });
      res.json({ success: true, data: groups });
    } catch (error) {
      next(error);
    }
  }

  async getSources(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sources = await prisma.sourceLead.findMany({
        orderBy: { nom: 'asc' },
      });
      res.json({ success: true, data: sources });
    } catch (error) {
      next(error);
    }
  }

  async getCountries(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const countries = await prisma.country.findMany({
        orderBy: { nom: 'asc' },
      });
      res.json({ success: true, data: countries });
    } catch (error) {
      next(error);
    }
  }

  async getContactTypes(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const types = await prisma.contactType.findMany({
        orderBy: { nom: 'asc' },
      });
      res.json({ success: true, data: types });
    } catch (error) {
      next(error);
    }
  }

  async getOpportunityStatuses(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const statuses = await prisma.opportunityStatus.findMany({
        orderBy: { ordre: 'asc' },
      });
      res.json({ success: true, data: statuses });
    } catch (error) {
      next(error);
    }
  }
}

export const referenceDataController = new ReferenceDataController();
