import { prisma } from '../utils/prisma';
import { rabbitmq, CRM_EXCHANGE } from '../utils/rabbitmq';
import { logger } from '../utils/logger';
import { FactureStatus } from '@prisma/client';

const QUEUE_NAME = 'clients-api.crm.facture';
const BINDING_PATTERN = 'crm.facture.*';

function mapStatus(crmStatus: string): FactureStatus {
  const statusMap: Record<string, FactureStatus> = {
    brouillon: 'brouillon',
    envoyee: 'emise',
    envoyée: 'emise',
    emise: 'emise',
    payee: 'payee',
    payée: 'payee',
    partiellement_payee: 'partiellement_payee',
    annulee: 'annulee',
    annulée: 'annulee',
    en_recouvrement: 'en_recouvrement',
  };
  return statusMap[crmStatus?.toLowerCase()] || 'brouillon';
}

async function handleFactureEvent(routingKey: string, message: any) {
  const { entity_id, payload } = message;

  if (!entity_id || !payload) {
    logger.warn(`[FactureConsumer] Message invalide, entity_id ou payload manquant`);
    return;
  }

  const idFactureCrm = String(entity_id);
  logger.info(`[FactureConsumer] Received: entity_id=${entity_id}, payload=${JSON.stringify(payload)}`);

  const client = payload.client_id
    ? await prisma.client.findFirst({ where: { idClientCrm: String(payload.client_id) } })
    : null;

  if (!client) {
    logger.warn(`[FactureConsumer] Client CRM ${payload.client_id} non trouvé, facture ${idFactureCrm} ignorée`);
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

  const existing = await prisma.factureRef.findUnique({ where: { idFactureCrm } });

  if (existing) {
    await prisma.factureRef.update({ where: { id: existing.id }, data });
    logger.info(`[FactureConsumer] Facture ${idFactureCrm} mise à jour (${routingKey})`);
  } else {
    await prisma.factureRef.create({ data: { ...data, idFactureCrm } });
    logger.info(`[FactureConsumer] Facture ${idFactureCrm} créée (${routingKey})`);
  }
}

export async function startFactureConsumer(): Promise<void> {
  await rabbitmq.subscribe(CRM_EXCHANGE, BINDING_PATTERN, QUEUE_NAME, handleFactureEvent);
}
