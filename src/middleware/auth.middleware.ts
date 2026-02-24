import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

const keycloakUrl = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const keycloakRealm = process.env.KEYCLOAK_REALM || 'konitys';

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
        console.error('JWT verification error:', err.message);
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
