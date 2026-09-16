import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { logger } from '../utils/logger';

const keycloakUrl = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const keycloakRealm = process.env.KEYCLOAK_REALM || 'konitys';

// Auth bypass is only ever allowed outside production. If DISABLE_AUTH is set
// in production we fail fast at boot rather than silently serving every request
// as an admin dev-user.
const authDisabled = process.env.DISABLE_AUTH === 'true';
if (authDisabled && process.env.NODE_ENV === 'production') {
  throw new Error(
    'DISABLE_AUTH=true is forbidden when NODE_ENV=production — refusing to start with authentication disabled.',
  );
}

const jwksClient = jwksRsa({
  jwksUri: `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
  cache: true,
  cacheMaxAge: 600000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email?: string;
    preferred_username?: string;
    given_name?: string;
    family_name?: string;
    realm_access?: {
      roles: string[];
    };
  };
}

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  // Skip auth if disabled via env (non-production only — enforced at boot above)
  if (authDisabled) {
    req.user = { sub: 'dev-user', email: 'dev@local', preferred_username: 'dev' };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: "Token d'authentification manquant",
    });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      issuer: `${keycloakUrl}/realms/${keycloakRealm}`,
    },
    (err, decoded) => {
      if (err) {
        // Don't leak the specific JWT failure reason to logs in production.
        if (process.env.NODE_ENV !== 'production') {
          logger.warn(`[Auth] JWT verification failed: ${err.message}`);
        } else {
          logger.warn('[Auth] JWT verification failed');
        }
        return res.status(401).json({
          success: false,
          error: 'Token invalide ou expiré',
        });
      }

      req.user = decoded as AuthenticatedRequest['user'];
      next();
    },
  );
};

/**
 * Authorization middleware: requires the authenticated user to hold at least one
 * of the given Keycloak realm roles. Must run after `authMiddleware`.
 * When auth is disabled (dev), the injected dev-user passes through.
 */
export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (authDisabled) return next();

    const userRoles = req.user?.realm_access?.roles ?? [];
    const allowed = roles.some((role) => userRoles.includes(role));

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: 'Accès interdit : rôle insuffisant',
      });
    }

    next();
  };
};
