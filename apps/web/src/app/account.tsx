'use client';

// Anmelden und Abmelden. Die Anmeldung selbst macht die API (Weiterleitung zum Login-Dienst,
// Sitzungs-Cookie); hier gibt es nur Formular, Anzeige der Person und den Abmelde-Knopf.
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, type Me } from '@/lib/api';
import { clearAllLocalCopies } from '@/lib/local-copies';
import { clearSidebarState } from '@/lib/sidebar-state';

/** Fehler beim Login, die die API als ?loginError=<code> zurückgibt (auth/routes.ts) */
const LOGIN_ERRORS = [
  'unknown_tenant',
  'login_failed',
  'wrong_organization',
  'no_account',
  'deactivated',
  'expired',
  'unavailable',
  'invite_invalid',
  'invite_email_mismatch',
  'invite_other_login',
] as const;
type LoginError = (typeof LOGIN_ERRORS)[number];
const isLoginError = (code: string): code is LoginError => (LOGIN_ERRORS as readonly string[]).includes(code);

const defaultTenant = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? '';

/** Anmeldeformular; schickt den Browser zur API, die zum Login-Dienst weiterleitet. */
export function LoginForm({ returnTo = '/' }: { returnTo?: string }) {
  const t = useTranslations('account');
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
          {t(`loginErrors.${isLoginError(loginError) ? loginError : 'default'}` as const)}
        </p>
      )}
      <label htmlFor="tenant" className="nf-label">
        {t('tenantLabel')}
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
        {t('signIn')}
      </button>
    </form>
  );
}

/**
 * Abmelden: Sitzung in der API beenden (offene Editoren in anderen Tabs schließen sich, E04-06),
 * alle lokalen Kopien von Seiten in diesem Browser löschen (lib/local-copies.ts) und den Zustand der
 * Seitenleiste in diesem Tab vergessen (lib/sidebar-state.ts), dann bei Zitadel
 * abmelden. Nicht übertragene Änderungen aus einem Funkloch sind damit verworfen.
 */
export async function logout() {
  const { logoutUrl } = await api<{ logoutUrl: string }>('/auth/logout', { method: 'POST' });
  await clearAllLocalCopies();
  clearSidebarState();
  window.location.assign(logoutUrl);
}

/** Angemeldete Person mit Abmelde-Knopf */
export function SignedIn({ me }: { me: Me }) {
  const t = useTranslations('account');
  return (
    <p>
      {t.rich('signedIn', {
        strong: (chunks) => <strong>{chunks}</strong>,
        name: me.displayName,
        email: me.email,
        tenant: me.tenant.name,
        orgAdmin: me.orgRole === 'org_admin' ? t('orgAdminSuffix') : '',
      })}{' '}
      <button type="button" onClick={logout} className="nf-link-button">
        {t('signOut')}
      </button>
    </p>
  );
}
