import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

// Lecture seule, ouverte à tout utilisateur authentifié.
router.get('/stats', dashboardController.getStats);

export default router;
