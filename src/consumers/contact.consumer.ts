import { prisma } from '../utils/prisma';
import { rabbitmq, CRM_EXCHANGE } from '../utils/rabbitmq';
import { logger } from '../utils/logger';

const QUEUE_NAME = 'clients-api.crm.contact';
const BINDING_PATTERN = 'crm.contact.*';

async function handleContactEvent(routingKey: string, message: any) {
  const { entity_id, payload } = message;

  if (!entity_id || !payload) {
    logger.warn(`[ContactConsumer] Message invalide, entity_id ou payload manquant`);
    return;
  }

  const idClientCrm = String(entity_id);
  logger.info(`[ContactConsumer] Received: entity_id=${entity_id}, payload=${JSON.stringify(payload)}`);

  const client = payload.client_id
    ? await prisma.client.findFirst({ where: { idClientCrm: String(payload.client_id) } })
    : null;

  if (!client) {
    logger.warn(`[ContactConsumer] Client CRM ${payload.client_id} non trouvé, contact ${idClientCrm} ignoré`);
    return;
  }

  const data = {
    clientId: client.id,
    nom: payload.nom || '',
    prenom: payload.prenom || null,
    email: payload.email || null,
    tel: payload.tel || null,
    position: payload.position || null,
  };

  const existing = await prisma.clientContact.findUnique({ where: { idClientCrm } });

  if (existing) {
    await prisma.clientContact.update({ where: { id: existing.id }, data });
    logger.info(`[ContactConsumer] Contact ${idClientCrm} mis à jour (${routingKey})`);
  } else {
    await prisma.clientContact.create({ data: { ...data, idClientCrm } });
    logger.info(`[ContactConsumer] Contact ${idClientCrm} créé (${routingKey})`);
  }
}

export async function startContactConsumer(): Promise<void> {
  await rabbitmq.subscribe(CRM_EXCHANGE, BINDING_PATTERN, QUEUE_NAME, handleContactEvent);
}
