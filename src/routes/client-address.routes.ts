import { Router } from 'express';
import { z } from 'zod';
import { clientAddressController } from '../controllers/client-address.controller';
import { requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { WRITE_ROLES } from '../utils/roles';

const nullableText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const addressSchema = z.object({
  // Nom de l'adresse : « Principale », « Bureau », « Livraison »… Texte libre,
  // le front propose des suggestions sans les imposer.
  label: nullableText(100),
  adresse: nullableText(255),
  adresse2: nullableText(255),
  cp: nullableText(20),
  ville: nullableText(120),
  paysId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  isPrimary: z.boolean().optional(),
});

const router = Router();

router.get('/:clientId/addresses', clientAddressController.getByClientId);
router.post(
  '/:clientId/addresses',
  requireRole(...WRITE_ROLES),
  validate(addressSchema),
  clientAddressController.create,
);
router.put(
  '/:clientId/addresses/:id',
  requireRole(...WRITE_ROLES),
  validate(addressSchema),
  clientAddressController.update,
);
router.delete('/:clientId/addresses/:id', requireRole(...WRITE_ROLES), clientAddressController.delete);

export default router;
