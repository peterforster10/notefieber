'use client';

// Anmelden und Abmelden. Die Anmeldung selbst macht die API (Weiterleitung zum Login-Dienst,
// Sitzungs-Cookie); hier gibt es nur Formular, Anzeige der Person und den Abmelde-Knopf.
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from '@/lib/api';
import { clearAllLocalCopies } from '@/lib/local-copies';

const LOGIN_ERRORS: Record<string, string> = {
  unknown_tenant: 'Diesen Mandanten gibt es nicht.',
  login_failed: 'Die Anmeldung ist fehlgeschlagen. Bitte noch einmal versuchen.',
  wrong_organization: 'Dieses Konto gehört nicht zu diesem Mandanten.',
  no_account: 'Für dieses Konto gibt es in diesem Mandanten noch keinen Zugang. Bitte eine Einladung nutzen.',
  deactivated: 'Dieses Konto ist deaktiviert.',
  expired: 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal versuchen.',
  unavailable: 'Der Login-Dienst ist gerade nicht erreichbar.',
  invite_invalid: 'Diese Einladung ist ungültig, abgelaufen oder wurde schon benutzt.',
  invite_email_mismatch:
    'Die Einladung gilt für eine andere E-Mail-Adresse. Bitte mit dem Konto für die eingeladene Adresse anmelden.',
  invite_other_login: 'Zu dieser E-Mail-Adresse gibt es hier schon ein Konto mit einem anderen Login.',
};

const defaultTenant = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? '';

/** Anmeldeformular; schickt den Browser zur API, die zum Login-Dienst weiterleitet. */
export function LoginForm({ returnTo = '/' }: { returnTo?: string }) {
  const [tenant, setTenant] = useState(defaultTenant);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    // Nach dem Rendern lesen (nicht beim Server-Rendern); verzögert, siehe react-hooks/set-state-in-effect
    const error = new URLSearchParams(window.location.search).get('loginError');
    const t = setTimeout(() => setLoginError(error), 0);
    return () => clearTimeout(t);
  }, []);

  // Kurzname klein schreiben, bevor das Formular zur API geht
  function normalize(e: FormEvent<HTMLFormElement>) {
    setTenant(tenant.trim().toLowerCase());
    const input = e.currentTarget.elements.namedItem('tenant');
    if (input instanceof HTMLInputElement) input.value = input.value.trim().toLowerCase();
  }

  return (
    // Ein normales Formular: Der Browser navigiert zur API, die zum Login-Dienst weiterleitet.
    <form method="get" action="/api/v1/auth/login" onSubmit={normalize}>
      <input type="hidden" name="returnTo" value={returnTo} />
      {loginError && (
        <p role="alert" className="nf-alert">
          {LOGIN_ERRORS[loginError] ?? 'Die Anmeldung ist fehlgeschlagen.'}
        </p>
      )}
      <label htmlFor="tenant" className="nf-label">
        Mandant (Kurzname)
      </label>
      <input
        id="tenant"
        name="tenant"
        value={tenant}
        onChange={(e) => setTenant(e.target.value)}
        autoComplete="organization"
        required
        pattern="[a-z0-9][a-z0-9\-]{1,62}"
        className="nf-input"
      />
      <button type="submit" className="nf-button">
        Anmelden
      </button>
    </form>
  );
}

/**
 * Abmelden: Sitzung in der API beenden (offene Editoren in anderen Tabs schließen sich, E04-06),
 * alle lokalen Kopien von Seiten in diesem Browser löschen (lib/local-copies.ts), dann bei Zitadel
 * abmelden. Nicht übertragene Änderungen aus einem Funkloch sind damit verworfen.
 */
export async function logout() {
  const { logoutUrl } = await api<{ logoutUrl: string }>('/auth/logout', { method: 'POST' });
  await clearAllLocalCopies();
  window.location.assign(logoutUrl);
}

/** Angemeldete Person mit Abmelde-Knopf */
export function SignedIn({ me }: { me: Me }) {
  return (
    <p>
      Angemeldet als <strong>{me.displayName}</strong> ({me.email}), Mandant {me.tenant.name}
      {me.orgRole === 'org_admin' ? ', Organisations-Admin' : ''}.{' '}
      <button type="button" onClick={logout} className="nf-link-button">
        Abmelden
      </button>
    </p>
  );
}
