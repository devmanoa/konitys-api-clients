import { prisma } from '../utils/prisma';
import { buildPaginationResult } from '../utils/pagination';
import { NotFoundError } from '../utils/errors';

class CommentService {
  async findByClientId(clientId: number, page: number, limit: number) {
    const [data, total] = await Promise.all([
      prisma.clientComment.findMany({
        where: { clientId },
        include: { attachments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.clientComment.count({ where: { clientId } }),
    ]);

    return {
      data,
      pagination: buildPaginationResult(page, limit, total),
    };
  }

  async create(clientId: number, data: {
    contenu: string;
    userId?: number;
    userName?: string;
  }) {
    return prisma.clientComment.create({
      data: {
        clientId,
        ...data,
      },
      include: { attachments: true },
    });
  }

  async addAttachment(commentId: number, attachment: {
    fileName: string;
    filePath: string;
    fileSize?: number;
    mimeType?: string;
  }) {
    return prisma.commentAttachment.create({
      data: {
        commentId,
        ...attachment,
      },
    });
  }

  async delete(id: number, clientId: number) {
    const existing = await prisma.clientComment.findFirst({
      where: { id, clientId },
    });
    if (!existing) {
      throw new NotFoundError('Commentaire');
    }

    return prisma.clientComment.delete({ where: { id } });
  }

  async deleteAttachment(id: number) {
    const existing = await prisma.commentAttachment.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Pièce jointe');
    }
    return prisma.commentAttachment.delete({ where: { id } });
  }
}

export const commentService = new CommentService();
