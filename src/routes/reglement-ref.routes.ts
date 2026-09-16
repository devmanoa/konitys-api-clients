import { Router } from 'express';
import { reglementRefController } from '../controllers/reglement-ref.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/:clientId/reglements', reglementRefController.getByClientId);
router.post('/:clientId/reglements', requireRole(...WRITE_ROLES), reglementRefController.create);
router.put('/:clientId/reglements/:id', requireRole(...WRITE_ROLES), reglementRefController.update);
router.delete('/:clientId/reglements/:id', requireRole(...WRITE_ROLES), reglementRefController.delete);

export default router;
