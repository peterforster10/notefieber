// Cookies lesen und schreiben, dazu signierte Werte (HMAC-SHA256) für kurzlebige Daten,
// die der Browser nur zurückgibt, aber nicht verändern darf.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // kaputt kodierte Cookies ignorieren
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  secure: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict';
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`, `Max-Age=${o.maxAgeSeconds}`];
  parts.push(`SameSite=${o.sameSite ?? 'Lax'}`);
  if (o.httpOnly ?? true) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, path: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, path, secure });
}

function mac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Wert als JSON signieren: <daten>.<signatur>, beides base64url. */
export function sign(secret: string, value: unknown): string {
  const data = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${data}.${mac(secret, data)}`;
}

/** Gegenstück zu sign(); undefined bei falscher Signatur oder kaputtem Inhalt. */
export function verify(secret: string, signed: string | undefined): unknown {
  if (!signed) return undefined;
  const i = signed.lastIndexOf('.');
  if (i < 1) return undefined;
  const data = signed.slice(0, i);
  const expected = Buffer.from(mac(secret, data));
  const given = Buffer.from(signed.slice(i + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}
