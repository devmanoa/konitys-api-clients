import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { commentService } from '../services/comment.service';
import { parsePagination } from '../utils/pagination';

class CommentController {
  async getByClientId(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const { page, limit } = parsePagination(req.query as Record<string, any>);
      const result = await commentService.findByClientId(clientId, page, limit);

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const userName = req.user
        ? `${req.user.given_name || ''} ${req.user.family_name || ''}`.trim()
        : undefined;

      const comment = await commentService.create(clientId, {
        contenu: req.body.contenu,
        userName,
      });

      // Handle file uploads if present
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          await commentService.addAttachment(comment.id, {
            fileName: file.originalname,
            filePath: file.path,
            fileSize: file.size,
            mimeType: file.mimetype,
          });
        }
      }

      // Reload with attachments
      const result = await commentService.findByClientId(clientId, 1, 1);

      res.status(201).json({
        success: true,
        data: result.data[0],
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const clientId = parseInt(req.params.clientId);
      const id = parseInt(req.params.id);
      await commentService.delete(id, clientId);

      res.json({
        success: true,
        data: { message: 'Commentaire supprimé avec succès' },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const commentController = new CommentController();
