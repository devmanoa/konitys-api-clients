import { prisma } from '../utils/prisma';
import { NotFoundError, ValidationError } from '../utils/errors';

class SectorService {
  /**
   * Liste les secteurs avec le nombre de clients rattachés, pour que l'admin
   * voie ce qu'il s'apprête à renommer ou supprimer.
   */
  async findAll() {
    const sectors = await prisma.secteurActivite.findMany({
      orderBy: { nom: 'asc' },
      include: { _count: { select: { clientSectors: true } } },
    });

    return sectors.map(({ _count, ...sector }) => ({
      ...sector,
      clientCount: _count.clientSectors,
    }));
  }

  async findById(id: number) {
    const sector = await prisma.secteurActivite.findUnique({
      where: { id },
      include: { _count: { select: { clientSectors: true } } },
    });
    if (!sector) throw new NotFoundError("Secteur d'activité");

    const { _count, ...rest } = sector;
    return { ...rest, clientCount: _count.clientSectors };
  }

  /**
   * `nom` ne porte pas de contrainte unique en base : on vérifie ici, sans
   * tenir compte de la casse, pour éviter les doublons du type
   * "Tourisme" / "tourisme".
   */
  private async assertNameAvailable(nom: string, excludeId?: number) {
    const clash = await prisma.secteurActivite.findFirst({
      where: {
        nom: { equals: nom, mode: 'insensitive' },
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, nom: true },
    });
    if (clash) {
      throw new ValidationError(`Un secteur nommé « ${clash.nom} » existe déjà`);
    }
  }

  async create(data: { nom: string }) {
    const nom = data.nom.trim();
    await this.assertNameAvailable(nom);

    const sector = await prisma.secteurActivite.create({ data: { nom } });
    return { ...sector, clientCount: 0 };
  }

  async update(id: number, data: { nom: string }) {
    const existing = await prisma.secteurActivite.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Secteur d'activité");

    const nom = data.nom.trim();
    await this.assertNameAvailable(nom, id);

    const sector = await prisma.secteurActivite.update({
      where: { id },
      data: { nom },
      include: { _count: { select: { clientSectors: true } } },
    });

    const { _count, ...rest } = sector;
    return { ...rest, clientCount: _count.clientSectors };
  }

  /**
   * Refuse la suppression d'un secteur encore rattaché à des clients : la
   * table de jonction n'a pas de cascade côté secteur, et supprimer
   * silencieusement ferait perdre l'information sans trace.
   */
  async delete(id: number) {
    const existing = await prisma.secteurActivite.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Secteur d'activité");

    const clientCount = await prisma.clientSector.count({ where: { sectorId: id } });
    if (clientCount > 0) {
      throw new ValidationError(
        `Impossible de supprimer ce secteur : ${clientCount} client(s) y sont rattaché(s)`,
      );
    }

    // Un secteur parent laisserait des enfants orphelins (FK non nullable côté
    // relation). Le référentiel est plat aujourd'hui, mais la garde évite une
    // erreur Prisma brute si la hiérarchie est un jour utilisée.
    const childCount = await prisma.secteurActivite.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new ValidationError(
        `Impossible de supprimer ce secteur : ${childCount} sous-secteur(s) en dépendent`,
      );
    }

    await prisma.secteurActivite.delete({ where: { id } });
    return { id };
  }
}

export const sectorService = new SectorService();
