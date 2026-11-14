// Wer meldet sich an? Nach dem Rücksprung vom Login-Dienst steht fest, wer die Person dort ist
// (Identity) und bei welchem Mandanten der Login begann. Hier entscheidet sich, zu welcher
// Person im Wiki das gehört (docs/CONCEPTS.md, Abschnitt 5):
//   - bekannt über (Mandant, idp_subject): diese Person; mit Einladung zusätzlich Mitglied
//   - unbekannt, aber mit gültiger Einladung an dieselbe, bestätigte E-Mail: app.accept_invite
//     legt sie an (oder verknüpft eine Person ohne Login) und macht sie zum Mitglied
//   - sonst: kein Zugang
// Das Konto im Login-Dienst legt die App nie an; es muss in der Organisation des Mandanten
// schon geben (vom Admin angelegt oder über SSO, z. B. Entra ID).
import type pg from 'pg';
import { withContext } from '../db.ts';
import type { Identity } from './claims.ts';
import { hashToken } from './session.ts';

export type AccountError =
  'no_account' | 'deactivated' | 'invite_invalid' | 'invite_email_mismatch' | 'invite_other_login';

export type AccountResult = { userId: string; acceptedInvite: boolean } | { error: AccountError };

interface InviteRow {
  tenant_id: string;
  email: string;
}

/** Einladung zum Token (vor dem Login, ohne Kontext); undefined, wenn ungültig oder abgelaufen */
export async function findInvite(db: pg.Pool, token: string): Promise<InviteRow | undefined> {
  const { rows } = await db.query<InviteRow>('SELECT tenant_id, email FROM app.find_invite($1)', [hashToken(token)]);
  return rows[0];
}

export async function resolveAccount(
  db: pg.Pool,
  input: { tenantId: string; identity: Identity; inviteToken?: string | undefined },
): Promise<AccountResult> {
  const { tenantId, identity, inviteToken } = input;
  // Vor der Anmeldung sieht wiki_app keine Personen (Leseregel auf users); app.resolve_login
  // findet die Person zum Login im Mandanten aus dem Kontext
  const existing = await withContext(db, { tenantId }, async (tx) => {
    const { rows } = await tx.query<{ id: string; deactivated_at: Date | null }>(
      'SELECT user_id AS id, deactivated_at FROM app.resolve_login($1)',
      [identity.subject],
    );
    return rows[0];
  });
  if (existing?.deactivated_at) return { error: 'deactivated' };

  if (inviteToken) {
    const invite = await findInvite(db, inviteToken);
    if (!invite || invite.tenant_id !== tenantId) return { error: 'invite_invalid' };
    // Nur wer die eingeladene Adresse nachweislich besitzt, darf die Einladung einlösen
    if (!identity.emailVerified || identity.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return { error: 'invite_email_mismatch' };
    }
    try {
      const userId = await withContext(db, { tenantId }, async (tx) => {
        const { rows } = await tx.query<{ id: string }>('SELECT app.accept_invite($1, $2, $3) AS id', [
          hashToken(inviteToken),
          identity.displayName ?? invite.email,
          identity.subject,
        ]);
        return rows[0]!.id;
      });
      return { userId, acceptedInvite: true };
    } catch (err) {
      const code = (err as { code?: string }).code;
      // 42501: E-Mail gehört zu einem anderen Login; 23505: Login oder E-Mail inzwischen
      // vergeben (gleichzeitige Anmeldung). Beides heißt: nicht mit diesem Konto.
      if (code === '42501' || code === '23505') return { error: 'invite_other_login' };
      if (code === 'P0001') return { error: 'invite_invalid' }; // inzwischen benutzt, abgelaufen, deaktiviert
      throw err;
    }
  }

  return existing ? { userId: existing.id, acceptedInvite: false } : { error: 'no_account' };
}
