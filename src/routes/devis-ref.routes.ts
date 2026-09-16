import { Router } from 'express';
import { devisRefController } from '../controllers/devis-ref.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/:clientId/devis', devisRefController.getByClientId);
router.post('/:clientId/devis', requireRole(...WRITE_ROLES), devisRefController.create);
router.put('/:clientId/devis/:id', requireRole(...WRITE_ROLES), devisRefController.update);
router.delete('/:clientId/devis/:id', requireRole(...WRITE_ROLES), devisRefController.delete);

export default router;
