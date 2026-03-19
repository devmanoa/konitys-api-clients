import { prisma } from '../utils/prisma';
import { rabbitmq, CRM_EXCHANGE } from '../utils/rabbitmq';
import { logger } from '../utils/logger';
import { DevisStatus } from '@prisma/client';

const QUEUE_NAME = 'clients-api.crm.devis';
const BINDING_PATTERN = 'crm.devis.*';

// Map CRM status strings to our DevisStatus enum
function mapStatus(crmStatus: string): DevisStatus {
  const statusMap: Record<string, DevisStatus> = {
    brouillon: 'brouillon',
    envoye: 'envoye',
    envoyé: 'envoye',
    accepte: 'accepte',
    accepté: 'accepte',
    refuse: 'refuse',
    refusé: 'refuse',
    annule: 'annule',
    annulé: 'annule',
  };
  return statusMap[crmStatus?.toLowerCase()] || 'brouillon';
}

async function handleDevisEvent(routingKey: string, message: any) {
  const { entity_id, payload } = message;

  if (!entity_id || !payload) {
    logger.warn(`[DevisConsumer] Message invalide, entity_id ou payload manquant`);
    return;
  }

  const idDevisCrm = String(entity_id);
  logger.info(`[DevisConsumer] Received: entity_id=${entity_id}, payload=${JSON.stringify(payload)}`);

  // Find the client by their CRM id
  const client = payload.client_id
    ? await prisma.client.findFirst({ where: { idClientCrm: String(payload.client_id) } })
    : null;

  if (!client) {
    logger.warn(`[DevisConsumer] Client CRM ${payload.client_id} non trouvé, devis ${idDevisCrm} ignoré`);
    return;
  }

  const data = {
    clientId: client.id,
    indent: payload.indent || null,
    objet: payload.objet || null,
    status: mapStatus(payload.status),
    totalHt: payload.montant_ht != null ? String(payload.montant_ht) : null,
    totalTtc: payload.montant_ttc != null ? String(payload.montant_ttc) : null,
    dateCreation: payload.date_crea ? new Date(payload.date_crea) : null,
  };

  const existing = await prisma.devisRef.findUnique({ where: { idDevisCrm } });

  if (existing) {
    await prisma.devisRef.update({ where: { id: existing.id }, data });
    logger.info(`[DevisConsumer] Devis ${idDevisCrm} mis à jour (${routingKey})`);
  } else {
    await prisma.devisRef.create({ data: { ...data, idDevisCrm } });
    logger.info(`[DevisConsumer] Devis ${idDevisCrm} créé (${routingKey})`);
  }
}

export async function startDevisConsumer(): Promise<void> {
  await rabbitmq.subscribe(CRM_EXCHANGE, BINDING_PATTERN, QUEUE_NAME, handleDevisEvent);
}
