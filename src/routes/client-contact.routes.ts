import { Router } from 'express';
import { clientContactController } from '../controllers/client-contact.controller';

const router = Router();

router.get('/:clientId/contacts', clientContactController.getByClientId);
router.post('/:clientId/contacts', clientContactController.create);
router.put('/:clientId/contacts/:id', clientContactController.update);
router.delete('/:clientId/contacts/:id', clientContactController.delete);

export default router;
