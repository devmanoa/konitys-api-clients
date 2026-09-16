import { Router } from 'express';
import { clientContactController } from '../controllers/client-contact.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/:clientId/contacts', clientContactController.getByClientId);
router.post('/:clientId/contacts', requireRole(...WRITE_ROLES), clientContactController.create);
router.put('/:clientId/contacts/:id', requireRole(...WRITE_ROLES), clientContactController.update);
router.delete('/:clientId/contacts/:id', requireRole(...WRITE_ROLES), clientContactController.delete);

export default router;
