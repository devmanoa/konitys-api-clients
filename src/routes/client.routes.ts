import { Router } from 'express';
import { clientController } from '../controllers/client.controller';

const router = Router();

router.get('/', clientController.getAll);
router.get('/search', clientController.search);
router.get('/duplicates', clientController.getDuplicates);
router.post('/bulk-action', clientController.bulkAction);
router.get('/:id', clientController.getById);
router.post('/', clientController.create);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.delete);

export default router;
