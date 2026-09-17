import { prisma } from '../utils/prisma';

/**
 * Agrégats du tableau de bord clients.
 *
 * Tout est calculé en base (groupBy / aggregate) plutôt qu'en chargeant les
 * lignes : le volume de devis et factures rend un calcul en mémoire coûteux.
 *
 * Les montants métier viennent de `dateCreation` (date du document dans le CRM
 * d'origine) et non de `createdAt` (date d'insertion en base), sinon toute la
 * reprise de données tomberait sur le jour de la migration.
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** Début du mois, N mois en arrière (0 = mois courant). */
function monthStart(monthsAgo: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, 1));
}

export interface DashboardStats {
  clients: {
    total: number;
    corporations: number;
    persons: number;
    qualified: number;
    newThisMonth: number;
    newPrevMonth: number;
    withoutEmail: number;
  };
  devis: {
    total: number;
    byStatus: Record<string, { count: number; totalHt: number }>;
    /** Part des devis acceptés parmi ceux qui ont été tranchés. */
    conversionRate: number | null;
    pendingAmount: number;
  };
  factures: {
    total: number;
    byStatus: Record<string, { count: number; totalTtc: number }>;
    revenue: number;
    outstanding: number;
    overdueCount: number;
  };
  /**
   * 12 mois se terminant au dernier mois porteur de données, pas au mois
   * courant : l'historique repris s'arrête à la date d'export du CRM.
   */
  monthly: { month: string; devisHt: number; factureTtc: number }[];
  topClients: { id: number; label: string; totalTtc: number; factureCount: number }[];
  bySector: { id: number; nom: string; clientCount: number }[];
}

class DashboardService {
  async getStats(): Promise<DashboardStats> {
    const activeClient = { client: { isDeleted: false } };
    const startThisMonth = monthStart(0);
    const startPrevMonth = monthStart(1);

    const [
      total,
      corporations,
      qualified,
      newThisMonth,
      newPrevMonth,
      withoutEmail,
      devisGroups,
      factureGroups,
      outstanding,
      overdueCount,
    ] = await Promise.all([
      prisma.client.count({ where: { isDeleted: false } }),
      prisma.client.count({ where: { isDeleted: false, clientType: 'corporation' } }),
      prisma.client.count({ where: { isDeleted: false, isQualifie: true } }),
      prisma.client.count({ where: { isDeleted: false, createdAt: { gte: startThisMonth } } }),
      prisma.client.count({
        where: { isDeleted: false, createdAt: { gte: startPrevMonth, lt: startThisMonth } },
      }),
      prisma.client.count({
        where: { isDeleted: false, OR: [{ email: null }, { email: '' }] },
      }),
      prisma.devisRef.groupBy({
        by: ['status'],
        where: activeClient,
        _count: { _all: true },
        _sum: { totalHt: true },
      }),
      prisma.factureRef.groupBy({
        by: ['status'],
        where: activeClient,
        _count: { _all: true },
        _sum: { totalTtc: true },
      }),
      prisma.factureRef.aggregate({
        where: { ...activeClient, status: { in: ['emise', 'partiellement_payee', 'en_recouvrement'] } },
        _sum: { restantDu: true },
      }),
      prisma.factureRef.count({ where: { ...activeClient, status: 'en_recouvrement' } }),
    ]);

    const devisByStatus: DashboardStats['devis']['byStatus'] = {};
    let devisTotal = 0;
    for (const g of devisGroups) {
      devisByStatus[g.status] = { count: g._count._all, totalHt: num(g._sum.totalHt) };
      devisTotal += g._count._all;
    }

    const factureByStatus: DashboardStats['factures']['byStatus'] = {};
    let factureTotal = 0;
    for (const g of factureGroups) {
      factureByStatus[g.status] = { count: g._count._all, totalTtc: num(g._sum.totalTtc) };
      factureTotal += g._count._all;
    }

    // Taux de conversion sur les devis tranchés uniquement : inclure les
    // brouillons et les devis encore en attente écraserait le ratio.
    const accepted = devisByStatus.accepte?.count ?? 0;
    const settled = accepted + (devisByStatus.refuse?.count ?? 0) + (devisByStatus.annule?.count ?? 0);
    const conversionRate = settled > 0 ? Math.round((accepted / settled) * 1000) / 10 : null;

    // Le CA retenu est celui effectivement encaissable : factures payées et
    // partiellement payées, hors brouillons et annulées.
    const revenue =
      (factureByStatus.payee?.totalTtc ?? 0) + (factureByStatus.partiellement_payee?.totalTtc ?? 0);

    const [monthly, topClients, bySector] = await Promise.all([
      this.monthlySeries(),
      this.topClients(),
      this.bySector(),
    ]);

    return {
      clients: {
        total,
        corporations,
        persons: total - corporations,
        qualified,
        newThisMonth,
        newPrevMonth,
        withoutEmail,
      },
      devis: {
        total: devisTotal,
        byStatus: devisByStatus,
        conversionRate,
        pendingAmount: devisByStatus.envoye?.totalHt ?? 0,
      },
      factures: {
        total: factureTotal,
        byStatus: factureByStatus,
        revenue,
        outstanding: num(outstanding._sum.restantDu),
        overdueCount,
      },
      monthly,
      topClients,
      bySector,
    };
  }

  /**
   * Devis et factures, mois par mois sur 12 mois.
   *
   * La fenêtre se cale sur le dernier mois qui porte réellement des données,
   * pas sur le mois courant : l'historique repris du CRM s'arrête à sa date
   * d'export, et une fenêtre glissante afficherait douze mois vides.
   */
  private async monthlySeries() {
    const [bounds] = await prisma.$queryRaw<[{ last_month: Date | null }]>`
      SELECT date_trunc('month', MAX(d)) AS last_month
      FROM (
        SELECT COALESCE(dr.date_creation, dr.created_at) AS d
        FROM devis_ref dr
        JOIN clients c ON c.id = dr.client_id AND c.is_deleted = false
        UNION ALL
        SELECT COALESCE(fr.date_creation, fr.created_at)
        FROM facture_ref fr
        JOIN clients c ON c.id = fr.client_id AND c.is_deleted = false
        WHERE fr.status::text NOT IN ('brouillon', 'annulee')
      ) AS all_dates
    `;

    const now = new Date();
    const lastMonth = bounds?.last_month ? new Date(bounds.last_month) : null;
    // Jamais de fenêtre dans le futur : des dates aberrantes existent en base
    // (le dump contient des documents datés 2027).
    const anchor = lastMonth && lastMonth < now ? lastMonth : now;
    const since = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 11, 1));
    const until = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));

    const rows = await prisma.$queryRaw<{ month: Date; devis_ht: unknown; facture_ttc: unknown }[]>`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', ${since}::timestamp),
          date_trunc('month', ${until}::timestamp),
          interval '1 month'
        ) AS month
      ),
      d AS (
        SELECT date_trunc('month', COALESCE(dr.date_creation, dr.created_at)) AS month,
               SUM(dr.total_ht) AS devis_ht
        FROM devis_ref dr
        JOIN clients c ON c.id = dr.client_id AND c.is_deleted = false
        WHERE COALESCE(dr.date_creation, dr.created_at) >= ${since}
        GROUP BY 1
      ),
      f AS (
        SELECT date_trunc('month', COALESCE(fr.date_creation, fr.created_at)) AS month,
               SUM(fr.total_ttc) AS facture_ttc
        FROM facture_ref fr
        JOIN clients c ON c.id = fr.client_id AND c.is_deleted = false
        WHERE COALESCE(fr.date_creation, fr.created_at) >= ${since}
          AND fr.status::text NOT IN ('brouillon', 'annulee')
        GROUP BY 1
      )
      SELECT m.month,
             COALESCE(d.devis_ht, 0)    AS devis_ht,
             COALESCE(f.facture_ttc, 0) AS facture_ttc
      FROM months m
      LEFT JOIN d ON d.month = m.month
      LEFT JOIN f ON f.month = m.month
      ORDER BY m.month ASC
    `;

    return rows.map((r) => ({
      month: new Date(r.month).toISOString().slice(0, 7),
      devisHt: num(r.devis_ht),
      factureTtc: num(r.facture_ttc),
    }));
  }

  /** Dix meilleurs clients par chiffre d'affaires facturé. */
  private async topClients() {
    const rows = await prisma.$queryRaw<
      { id: number; nom: string; prenom: string | null; enseigne: string | null; total_ttc: unknown; facture_count: bigint }[]
    >`
      SELECT c.id, c.nom, c.prenom, c.enseigne,
             SUM(fr.total_ttc) AS total_ttc,
             COUNT(fr.id)      AS facture_count
      FROM clients c
      JOIN facture_ref fr ON fr.client_id = c.id
      WHERE c.is_deleted = false
        AND fr.status::text NOT IN ('brouillon', 'annulee')
      GROUP BY c.id, c.nom, c.prenom, c.enseigne
      HAVING SUM(fr.total_ttc) > 0
      ORDER BY SUM(fr.total_ttc) DESC
      LIMIT 10
    `;

    return rows.map((r) => ({
      id: r.id,
      label: r.enseigne ? `${r.nom} — ${r.enseigne}` : [r.nom, r.prenom].filter(Boolean).join(' '),
      totalTtc: num(r.total_ttc),
      factureCount: Number(r.facture_count),
    }));
  }

  /** Huit secteurs les plus représentés. */
  private async bySector() {
    const groups = await prisma.clientSector.groupBy({
      by: ['sectorId'],
      where: { client: { isDeleted: false } },
      _count: { _all: true },
      orderBy: { _count: { sectorId: 'desc' } },
      take: 8,
    });

    if (groups.length === 0) return [];

    const sectors = await prisma.secteurActivite.findMany({
      where: { id: { in: groups.map((g) => g.sectorId) } },
      select: { id: true, nom: true },
    });
    const names = new Map(sectors.map((s) => [s.id, s.nom]));

    return groups.map((g) => ({
      id: g.sectorId,
      nom: names.get(g.sectorId) ?? `Secteur ${g.sectorId}`,
      clientCount: g._count._all,
    }));
  }
}

export const dashboardService = new DashboardService();
