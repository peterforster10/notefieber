// Schutz gegen Cross-Site Request Forgery: Die Sitzung steckt in einem Cookie, das der
// Browser bei jeder Anfrage mitschickt. Ändernde Anfragen (alles außer GET, HEAD, OPTIONS)
// gelten deshalb nur, wenn sie von der eigenen Adresse kommen (Origin, sonst Referer).
// Zusammen mit SameSite=Lax am Cookie.
import type { NextFunction, Request, Response } from 'express';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOriginOnly(publicUrl: string) {
  const allowed = new URL(publicUrl).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin') ?? originOf(req.get('referer'));
    if (origin !== allowed) {
      res.status(403).json({ error: 'cross_origin', message: 'Anfrage von fremder Adresse abgelehnt' });
      return;
    }
    next();
  };
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Ziel nach dem Login: nur ein Pfad auf der eigenen Adresse, nie eine fremde Seite. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
