import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Données invalides',
      details: result.error.flatten(),
    });
  }
  req.body = result.data;
  next();
};

export const validateQuery = (schema: ZodSchema) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Paramètres invalides',
      details: result.error.flatten(),
    });
  }
  req.query = result.data;
  next();
};
