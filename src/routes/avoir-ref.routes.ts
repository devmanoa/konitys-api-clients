import { Router } from 'express';
import { avoirRefController } from '../controllers/avoir-ref.controller';

const router = Router();

router.get('/:clientId/avoirs', avoirRefController.getByClientId);
router.post('/:clientId/avoirs', avoirRefController.create);
router.put('/:clientId/avoirs/:id', avoirRefController.update);
router.delete('/:clientId/avoirs/:id', avoirRefController.delete);

export default router;
