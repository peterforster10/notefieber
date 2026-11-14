// Verbindung zum Login-Dienst (OIDC, Authorization Code Flow mit PKCE und Client-Geheimnis).
// Die Discovery läuft beim ersten Login, nicht beim Start: Die API startet auch dann, wenn
// Zitadel gerade nicht läuft, und versucht es bei der nächsten Anmeldung erneut.
import * as oidc from 'openid-client';
import type { ApiConfig } from '../config.ts';

export interface Oidc {
  configuration(): Promise<oidc.Configuration>;
}

export function createOidc(c: ApiConfig): Oidc {
  let pending: Promise<oidc.Configuration> | undefined;
  return {
    configuration() {
      pending ??= oidc
        .discovery(
          new URL(c.OIDC_ISSUER),
          c.OIDC_CLIENT_ID,
          undefined,
          oidc.ClientSecretBasic(c.OIDC_CLIENT_SECRET),
          c.OIDC_ALLOW_HTTP ? { execute: [oidc.allowInsecureRequests] } : undefined,
        )
        .catch((err: unknown) => {
          pending = undefined; // beim nächsten Mal neu versuchen
          throw err;
        });
      return pending;
    },
  };
}

export function scopesFor(c: ApiConfig, orgId: string): string {
  const org = c.OIDC_ORG_SCOPE ? c.OIDC_ORG_SCOPE.replaceAll('{orgId}', orgId) : '';
  return [c.OIDC_SCOPES, org].filter(Boolean).join(' ');
}

/**
 * Abmelde-Adresse beim Login-Dienst. Mit dem ID-Token aus dem Login als id_token_hint weiß
 * Zitadel, welche Sitzung gemeint ist, und beendet sie ohne Kontenauswahl (REVIEW.md, R-18).
 */
export function endSessionUrl(
  config: oidc.Configuration,
  o: { clientId: string; postLogoutRedirectUri: string; idToken?: string | null | undefined },
): string {
  return oidc.buildEndSessionUrl(config, {
    client_id: o.clientId,
    post_logout_redirect_uri: o.postLogoutRedirectUri,
    ...(o.idToken ? { id_token_hint: o.idToken } : {}),
  }).href;
}

export { oidc };
