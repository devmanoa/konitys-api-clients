import { Router } from 'express';
import { devisRefController } from '../controllers/devis-ref.controller';

const router = Router();

router.get('/:clientId/devis', devisRefController.getByClientId);
router.post('/:clientId/devis', devisRefController.create);
router.put('/:clientId/devis/:id', devisRefController.update);
router.delete('/:clientId/devis/:id', devisRefController.delete);

export default router;
