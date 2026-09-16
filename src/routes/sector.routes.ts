import { Router } from 'express';
import { z } from 'zod';
import { sectorController } from '../controllers/sector.controller';
import { requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { WRITE_ROLES } from '../utils/roles';

const sectorSchema = z.object({
  nom: z
    .string()
    .trim()
    .min(2, 'Le nom doit faire au moins 2 caractères')
    .max(255, 'Le nom ne peut pas dépasser 255 caractères'),
});

const router = Router();

// Lecture ouverte à tout utilisateur authentifié : le référentiel alimente
// les formulaires clients.
router.get('/', sectorController.getAll);
router.get('/:id', sectorController.getById);

router.post('/', requireRole(...WRITE_ROLES), validate(sectorSchema), sectorController.create);
router.put('/:id', requireRole(...WRITE_ROLES), validate(sectorSchema), sectorController.update);
router.delete('/:id', requireRole(...WRITE_ROLES), sectorController.delete);

export default router;
