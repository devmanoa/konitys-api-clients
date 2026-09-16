import { Router } from 'express';
import { clientController } from '../controllers/client.controller';
import { requireRole } from '../middleware/auth.middleware';
import { WRITE_ROLES } from '../utils/roles';

const router = Router();

router.get('/', clientController.getAll);
router.get('/search', clientController.search);
router.get('/duplicates', clientController.getDuplicates);
router.post('/bulk-action', requireRole(...WRITE_ROLES), clientController.bulkAction);
router.get('/:id', clientController.getById);
router.post('/', requireRole(...WRITE_ROLES), clientController.create);
router.put('/:id', requireRole(...WRITE_ROLES), clientController.update);
router.delete('/:id', requireRole(...WRITE_ROLES), clientController.delete);

export default router;
