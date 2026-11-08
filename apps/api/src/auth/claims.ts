// Die einzige Stelle, die Claims des Login-Dienstes liest (CLAUDE.md, Abschnitt 3). Welche
// Claims gemeint sind, steht in der Konfiguration (OIDC_CLAIM_*); für einen anderen
// Login-Dienst als Zitadel ändern sich nur diese Werte.
import { z } from 'zod';

export interface ClaimNames {
  subject: string;
  org: string;
  email: string;
  emailVerified: string;
  name: string;
}

export interface Identity {
  /** Person im Login-Dienst = users.idp_subject */
  subject: string;
  /** Organisation im Login-Dienst = tenants.idp_org_id */
  orgId: string;
  email: string | undefined;
  emailVerified: boolean;
  displayName: string | undefined;
}

const nonEmpty = z.string().trim().min(1);

export class ClaimError extends Error {}

export function identityFromClaims(claims: Record<string, unknown>, names: ClaimNames): Identity {
  const subject = nonEmpty.safeParse(claims[names.subject]);
  const orgId = nonEmpty.safeParse(claims[names.org]);
  if (!subject.success) throw new ClaimError(`Claim ${names.subject} fehlt im Token`);
  if (!orgId.success) throw new ClaimError(`Claim ${names.org} fehlt im Token (Scope für die Organisation angefragt?)`);
  const email = nonEmpty.safeParse(claims[names.email]);
  const name = nonEmpty.safeParse(claims[names.name]);
  return {
    subject: subject.data,
    orgId: orgId.data,
    email: email.success ? email.data : undefined,
    emailVerified: claims[names.emailVerified] === true,
    displayName: name.success ? name.data : undefined,
  };
}
