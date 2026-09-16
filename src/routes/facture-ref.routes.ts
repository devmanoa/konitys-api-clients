import { Router } from 'express';
import { factureRefController } from '../controllers/facture-ref.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/:clientId/factures', factureRefController.getByClientId);
router.post('/:clientId/factures', requireRole(...WRITE_ROLES), factureRefController.create);
router.put('/:clientId/factures/:id', requireRole(...WRITE_ROLES), factureRefController.update);
router.delete('/:clientId/factures/:id', requireRole(...WRITE_ROLES), factureRefController.delete);

export default router;
