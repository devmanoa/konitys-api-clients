import { Router } from 'express';
import { reglementRefController } from '../controllers/reglement-ref.controller';

const router = Router();

router.get('/:clientId/reglements', reglementRefController.getByClientId);
router.post('/:clientId/reglements', reglementRefController.create);
router.put('/:clientId/reglements/:id', reglementRefController.update);
router.delete('/:clientId/reglements/:id', reglementRefController.delete);

export default router;
