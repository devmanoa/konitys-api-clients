import { prisma } from '../utils/prisma';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface MergePreview {
  primary: { id: number; nom: string; label: string };
  duplicate: { id: number; nom: string; label: string };
  /** Ce qui sera déplacé du doublon vers le client principal. */
  moves: Record<string, number>;
  total: number;
}

function clientLabel(c: { nom: string; prenom: string | null; enseigne: string | null }): string {
  return c.enseigne ? `${c.nom} — ${c.enseigne}` : [c.nom, c.prenom].filter(Boolean).join(' ');
}

const SELECT = {
  id: true,
  nom: true,
  prenom: true,
  enseigne: true,
  isDeleted: true,
} as const;

class ClientMergeService {
  private async loadPair(primaryId: number, duplicateId: number) {
    if (primaryId === duplicateId) {
      throw new ValidationError('Impossible de fusionner un client avec lui-même');
    }

    const [primary, duplicate] = await Promise.all([
      prisma.client.findFirst({ where: { id: primaryId, isDeleted: false }, select: SELECT }),
      prisma.client.findFirst({ where: { id: duplicateId, isDeleted: false }, select: SELECT }),
    ]);

    if (!primary) throw new NotFoundError('Client principal');
    if (!duplicate) throw new NotFoundError('Client à fusionner');

    return { primary, duplicate };
  }

  /** Décompte de ce qui serait déplacé, pour confirmation avant fusion. */
  async preview(primaryId: number, duplicateId: number): Promise<MergePreview> {
    const { primary, duplicate } = await this.loadPair(primaryId, duplicateId);
    const where = { clientId: duplicateId };

    const [contacts, addresses, comments, sectors, devis, factures, avoirs, reglements, opportunities] =
      await Promise.all([
        prisma.clientContact.count({ where }),
        prisma.clientAddress.count({ where }),
        prisma.clientComment.count({ where }),
        prisma.clientSector.count({ where }),
        prisma.devisRef.count({ where }),
        prisma.factureRef.count({ where }),
        prisma.avoirRef.count({ where }),
        prisma.reglementRef.count({ where }),
        prisma.opportunity.count({ where }),
      ]);

    const moves = {
      contacts,
      addresses,
      comments,
      sectors,
      devis,
      factures,
      avoirs,
      reglements,
      opportunities,
    };

    return {
      primary: { id: primary.id, nom: primary.nom, label: clientLabel(primary) },
      duplicate: { id: duplicate.id, nom: duplicate.nom, label: clientLabel(duplicate) },
      moves,
      total: Object.values(moves).reduce((a, b) => a + b, 0),
    };
  }

  /**
   * Réaffecte toutes les données du doublon vers le client principal, puis
   * marque le doublon supprimé. Les entités sont déplacées (UPDATE du
   * client_id), jamais copiées : aucun identifiant ne change, les documents
   * restent les mêmes.
   *
   * Le tout dans une transaction : une fusion à moitié appliquée laisserait
   * des données orphelines entre deux fiches.
   */
  async merge(primaryId: number, duplicateId: number, userId?: number) {
    const { primary, duplicate } = await this.loadPair(primaryId, duplicateId);

    const moved = await prisma.$transaction(async (tx) => {
      const where = { clientId: duplicateId };
      const data = { clientId: primaryId };

      // Les secteurs portent @@unique([clientId, sectorId]) : déplacer un
      // secteur que le principal a déjà violerait la contrainte. On ne déplace
      // que les manquants et on supprime le reste.
      const primarySectors = await tx.clientSector.findMany({
        where: { clientId: primaryId },
        select: { sectorId: true },
      });
      const alreadyThere = primarySectors.map((s) => s.sectorId);

      const sectors = await tx.clientSector.updateMany({
        where: { clientId: duplicateId, sectorId: { notIn: alreadyThere } },
        data,
      });
      await tx.clientSector.deleteMany({ where: { clientId: duplicateId } });

      // Une seule adresse principale par client : celles du doublon arrivent
      // en secondaires, le principal garde la sienne.
      await tx.clientAddress.updateMany({
        where: { clientId: duplicateId },
        data: { isPrimary: false },
      });
      // Idem pour le contact principal.
      await tx.clientContact.updateMany({
        where: { clientId: duplicateId },
        data: { isPrimary: false },
      });

      const [contacts, addresses, comments, devis, factures, avoirs, reglements, opportunities] =
        await Promise.all([
          tx.clientContact.updateMany({ where, data }),
          tx.clientAddress.updateMany({ where, data }),
          tx.clientComment.updateMany({ where, data }),
          tx.devisRef.updateMany({ where, data }),
          tx.factureRef.updateMany({ where, data }),
          tx.avoirRef.updateMany({ where, data }),
          tx.reglementRef.updateMany({ where, data }),
          tx.opportunity.updateMany({ where, data }),
        ]);

      // Si le principal n'a aucune adresse principale (il n'en avait pas et le
      // doublon en apportait), on promeut la plus ancienne.
      const hasPrimaryAddress = await tx.clientAddress.count({
        where: { clientId: primaryId, isPrimary: true },
      });
      if (hasPrimaryAddress === 0) {
        const oldest = await tx.clientAddress.findFirst({
          where: { clientId: primaryId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (oldest) {
          await tx.clientAddress.update({ where: { id: oldest.id }, data: { isPrimary: true } });
        }
      }

      await tx.client.update({
        where: { id: duplicateId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          ...(userId ? { updatedBy: userId } : {}),
        },
      });

      return {
        contacts: contacts.count,
        addresses: addresses.count,
        comments: comments.count,
        sectors: sectors.count,
        devis: devis.count,
        factures: factures.count,
        avoirs: avoirs.count,
        reglements: reglements.count,
        opportunities: opportunities.count,
      };
    });

    return {
      primary: { id: primary.id, label: clientLabel(primary) },
      duplicate: { id: duplicate.id, label: clientLabel(duplicate) },
      moved,
      total: Object.values(moved).reduce((a, b) => a + b, 0),
    };
  }
}

export const clientMergeService = new ClientMergeService();
