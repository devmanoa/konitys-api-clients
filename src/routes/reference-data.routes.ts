import { Router } from 'express';
import { referenceDataController } from '../controllers/reference-data.controller';

const router = Router();

router.get('/sectors', referenceDataController.getSectors);
router.get('/groups', referenceDataController.getGroups);
router.get('/sources', referenceDataController.getSources);
router.get('/countries', referenceDataController.getCountries);
router.get('/contact-types', referenceDataController.getContactTypes);
router.get('/opportunity-statuses', referenceDataController.getOpportunityStatuses);

export default router;
