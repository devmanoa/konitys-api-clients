import { prisma } from '../utils/prisma';
import { rabbitmq, CRM_EXCHANGE } from '../utils/rabbitmq';
import { logger } from '../utils/logger';
import { ClientType } from '@prisma/client';

const QUEUE_NAME = 'clients-api.crm.client';
const BINDING_PATTERN = 'crm.client.*';

async function handleClientEvent(routingKey: string, message: any) {
  const { entity_id, payload } = message;

  if (!entity_id || !payload) {
    logger.warn(`[ClientConsumer] Message invalide, entity_id ou payload manquant`);
    return;
  }

  const idClientCrm = String(entity_id);
  logger.info(`[ClientConsumer] Received: entity_id=${entity_id}, event=${message.event}`);

  // --- 1. Upsert client ---
  const groupeClientId = payload.groupe_client_id
    ? (await prisma.groupeClient.findFirst({ where: { id: payload.groupe_client_id } }))?.id ?? null
    : null;

  const clientData = {
    nom: payload.nom || '',
    prenom: payload.prenom || null,
    enseigne: payload.enseigne || null,
    email: payload.email || null,
    telephone: payload.telephone || null,
    mobile: payload.mobile || null,
    adresse: payload.adresse || null,
    adresse2: payload.adresse_2 || null,
    cp: payload.cp || null,
    ville: payload.ville || null,
    country: payload.country || null,
    siren: payload.siren || null,
    siret: payload.siret || null,
    groupeClientId,
    clientType: payload.enseigne ? ClientType.corporation : ClientType.person,
  };

  let client = await prisma.client.findUnique({ where: { idClientCrm } });

  if (client) {
    client = await prisma.client.update({ where: { id: client.id }, data: clientData });
    logger.info(`[ClientConsumer] Client ${idClientCrm} mis à jour`);
  } else {
    client = await prisma.client.create({ data: { ...clientData, idClientCrm } });
    logger.info(`[ClientConsumer] Client ${idClientCrm} créé`);
  }

  // --- 2. Sync contacts ---
  if (Array.isArray(payload.contacts)) {
    // Delete existing contacts then recreate
    await prisma.clientContact.deleteMany({ where: { clientId: client.id } });

    const contactsData = payload.contacts
      .filter((c: any) => c.nom)
      .map((c: any) => ({
        clientId: client!.id,
        idClientCrm: c.id ? String(c.id) : null,
        nom: c.nom,
        prenom: c.prenom || null,
        email: c.email || null,
        tel: c.tel || null,
        position: c.position || null,
      }));

    if (contactsData.length > 0) {
      await prisma.clientContact.createMany({ data: contactsData });
      logger.info(`[ClientConsumer] ${contactsData.length} contacts synchronisés pour client ${idClientCrm}`);
    }
  }

  // --- 3. Sync secteurs d'activité ---
  if (Array.isArray(payload.secteurs_activites)) {
    await prisma.clientSector.deleteMany({ where: { clientId: client.id } });

    const sectorIds = payload.secteurs_activites
      .map((s: any) => s.id)
      .filter((id: any) => id != null);

    if (sectorIds.length > 0) {
      // Verify sectors exist in our DB
      const existingSectors = await prisma.secteurActivite.findMany({
        where: { id: { in: sectorIds } },
        select: { id: true },
      });

      const validIds = existingSectors.map((s) => s.id);

      if (validIds.length > 0) {
        await prisma.clientSector.createMany({
          data: validIds.map((sectorId) => ({
            clientId: client!.id,
            sectorId,
          })),
        });
        logger.info(`[ClientConsumer] ${validIds.length} secteurs synchronisés pour client ${idClientCrm}`);
      }
    }
  }
}

export async function startClientConsumer(): Promise<void> {
  await rabbitmq.subscribe(CRM_EXCHANGE, BINDING_PATTERN, QUEUE_NAME, handleClientEvent);
}
