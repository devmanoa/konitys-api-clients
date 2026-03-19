import { prisma } from '../utils/prisma';
import { rabbitmq, CRM_EXCHANGE } from '../utils/rabbitmq';
import { logger } from '../utils/logger';

const QUEUE_NAME = 'clients-api.crm.reglement';
const BINDING_PATTERN = 'crm.reglement.*';

async function handleReglementEvent(routingKey: string, message: any) {
  const { entity_id, payload } = message;

  if (!entity_id || !payload) {
    logger.warn(`[ReglementConsumer] Message invalide, entity_id ou payload manquant`);
    return;
  }

  const idReglementCrm = String(entity_id);
  logger.info(`[ReglementConsumer] Received: entity_id=${entity_id}, payload=${JSON.stringify(payload)}`);

  const client = payload.client_id
    ? await prisma.client.findFirst({ where: { idClientCrm: String(payload.client_id) } })
    : null;

  if (!client) {
    logger.warn(`[ReglementConsumer] Client CRM ${payload.client_id} non trouvé, règlement ${idReglementCrm} ignoré`);
    return;
  }

  const data = {
    clientId: client.id,
    type: payload.type || 'C',
    date: payload.date ? new Date(payload.date) : null,
    montant: payload.montant != null ? String(payload.montant) : null,
    montantRestant: payload.montant_restant != null ? String(payload.montant_restant) : null,
    reference: payload.reference || null,
    etat: payload.etat || null,
  };

  const existing = await prisma.reglementRef.findUnique({ where: { idReglementCrm } });

  if (existing) {
    await prisma.reglementRef.update({ where: { id: existing.id }, data });
    logger.info(`[ReglementConsumer] Règlement ${idReglementCrm} mis à jour (${routingKey})`);
  } else {
    await prisma.reglementRef.create({ data: { ...data, idReglementCrm } });
    logger.info(`[ReglementConsumer] Règlement ${idReglementCrm} créé (${routingKey})`);
  }
}

export async function startReglementConsumer(): Promise<void> {
  await rabbitmq.subscribe(CRM_EXCHANGE, BINDING_PATTERN, QUEUE_NAME, handleReglementEvent);
}
