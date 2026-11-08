// Einstellungen aus Umgebungsvariablen, beim Start geprüft. Lokal aus .local/zitadel.env
// (OIDC-Werte, von zitadel-init erzeugt) und der Datei .env im Wurzelordner (Vorlage:
// .env.example, siehe docs/LOCAL_SETUP.md, Abschnitt 7).
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export function apiConfig() {
  const c = z
    .object({
      API_PORT: port.default(4000),
      API_DATABASE_URL: z.string().min(1, 'API_DATABASE_URL fehlt (Login-Rolle in wiki_app)'),
      /** Adresse, unter der Frontend und API für den Browser erreichbar sind (/ und /api). */
      PUBLIC_URL: z.url().default('http://localhost:3000'),

      // Login über OIDC. Alles, was vom Login-Dienst abhängt, steht hier und in auth/claims.ts.
      OIDC_ISSUER: z.url({ message: 'OIDC_ISSUER fehlt (aus .local/zitadel.env)' }),
      OIDC_CLIENT_ID: z.string().min(1, 'OIDC_CLIENT_ID fehlt (aus .local/zitadel.env)'),
      OIDC_CLIENT_SECRET: z.string().min(1, 'OIDC_CLIENT_SECRET fehlt (aus .local/zitadel.env)'),
      OIDC_REDIRECT_URI: z.url().optional(),
      OIDC_SCOPES: z.string().default('openid profile email urn:zitadel:iam:user:resourceowner'),
      /** Beschränkt den Login auf die Organisation des Mandanten; {orgId} wird ersetzt. Leer = aus. */
      OIDC_ORG_SCOPE: z.string().default('urn:zitadel:iam:org:id:{orgId}'),
      OIDC_CLAIM_SUBJECT: z.string().default('sub'),
      OIDC_CLAIM_ORG: z.string().default('urn:zitadel:iam:user:resourceowner:id'),
      OIDC_CLAIM_EMAIL: z.string().default('email'),
      OIDC_CLAIM_EMAIL_VERIFIED: z.string().default('email_verified'),
      OIDC_CLAIM_NAME: z.string().default('name'),
      /** Nur lokal: Login-Dienst über http (Zitadel unter http://localhost:8080). */
      OIDC_ALLOW_HTTP: bool.default(false),

      /** Signiert das kurzlebige Cookie zwischen Login-Start und Rücksprung. */
      AUTH_COOKIE_SECRET: z.string().min(32, 'AUTH_COOKIE_SECRET fehlt oder ist kürzer als 32 Zeichen'),
      SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(12),
      /** Cookies nur über HTTPS. Lokal (http://localhost) false. */
      COOKIE_SECURE: bool.default(true),
    })
    .parse(process.env);
  return { ...c, OIDC_REDIRECT_URI: c.OIDC_REDIRECT_URI ?? new URL('/api/v1/auth/callback', c.PUBLIC_URL).href };
}
export type ApiConfig = ReturnType<typeof apiConfig>;

export function workerConfig() {
  return z
    .object({
      WORKER_DATABASE_URL: z.string().min(1, 'WORKER_DATABASE_URL fehlt (Login-Rolle in wiki_worker)'),
      WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
    })
    .parse(process.env);
}
