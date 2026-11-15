// Sitzungs-Cookie für API und Collab-Server (nur auf dem Server: node:crypto, deshalb nicht in
// index.ts). Das Cookie nf_session trägt ein zufälliges Token, in der Datenbank steht nur sein
// SHA-256-Hash (Tabelle sessions, app.create_session / resolve_session / end_session).
// Der Collab-Server liest dasselbe Cookie beim WebSocket-Handshake (CLAUDE.md, Abschnitt 6).
import { createHash } from 'node:crypto';

export const SESSION_COOKIE = 'nf_session';

/** SHA-256 des Tokens, hex: so steht es in sessions.token_hash */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cookie-Header in Name → Wert; kaputt kodierte Werte werden übergangen */
export function parseCookies(header: string | null | undefined): Record<string, string> {
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

/** Token aus dem Cookie-Header, undefined ohne (oder mit leerem) Sitzungs-Cookie */
export function sessionTokenFromCookies(header: string | null | undefined): string | undefined {
  return parseCookies(header)[SESSION_COOKIE] || undefined;
}
