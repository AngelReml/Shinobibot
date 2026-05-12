// src/gateway/auth.ts
//
// Bloque 6 — verificación de token para el gateway externo. Acepta:
//   - Authorization: Bearer <token>
//   - ?token=<token>  (querystring)
//
// Compara con timing-safe (crypto.timingSafeEqual) para evitar timing
// attacks aunque la API surface es pequeña.

import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  try { return timingSafeEqual(ba, bb); } catch { return false; }
}

export function extractToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const q = req.query?.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

/** Express middleware factory. */
export function authMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const got = extractToken(req);
    if (!got || !safeEqual(got, expectedToken)) {
      res.status(401).json({ error: 'unauthorized', hint: 'Provide a valid token via Authorization: Bearer <token> or ?token=<token>.' });
      return;
    }
    next();
  };
}

export function verifyToken(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  return safeEqual(provided, expected);
}
