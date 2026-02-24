import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import clientRoutes from './client.routes';
import clientContactRoutes from './client-contact.routes';
import commentRoutes from './comment.routes';
import devisRefRoutes from './devis-ref.routes';
import referenceDataRoutes from './reference-data.routes';

export const router = Router();

router.use(authMiddleware);

// Mount routes
router.use('/clients', clientRoutes);
router.use('/clients', clientContactRoutes);
router.use('/clients', commentRoutes);
router.use('/clients', devisRefRoutes);
router.use('/reference-data', referenceDataRoutes);
