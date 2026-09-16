import { Router } from 'express';
import { avoirRefController } from '../controllers/avoir-ref.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/:clientId/avoirs', avoirRefController.getByClientId);
router.post('/:clientId/avoirs', requireRole(...WRITE_ROLES), avoirRefController.create);
router.put('/:clientId/avoirs/:id', requireRole(...WRITE_ROLES), avoirRefController.update);
router.delete('/:clientId/avoirs/:id', requireRole(...WRITE_ROLES), avoirRefController.delete);

export default router;
