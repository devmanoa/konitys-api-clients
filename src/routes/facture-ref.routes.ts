import { Router } from 'express';
import { factureRefController } from '../controllers/facture-ref.controller';

const router = Router();

router.get('/:clientId/factures', factureRefController.getByClientId);
router.post('/:clientId/factures', factureRefController.create);
router.put('/:clientId/factures/:id', factureRefController.update);
router.delete('/:clientId/factures/:id', factureRefController.delete);

export default router;
