'use client';

// Anmelden und Abmelden. Die Anmeldung selbst macht die API (Weiterleitung zum Login-Dienst,
// Sitzungs-Cookie); hier gibt es nur Formular, Anzeige der Person und den Abmelde-Knopf.
import { useEffect, useState, type FormEvent } from 'react';

interface Me {
  id: string;
  email: string;
  displayName: string;
  orgRole: string;
  tenant: { id: string; slug: string; name: string };
}

const LOGIN_ERRORS: Record<string, string> = {
  unknown_tenant: 'Diesen Mandanten gibt es nicht.',
  login_failed: 'Die Anmeldung ist fehlgeschlagen. Bitte noch einmal versuchen.',
  wrong_organization: 'Dieses Konto gehört nicht zu diesem Mandanten.',
  no_account: 'Für dieses Konto gibt es in diesem Mandanten noch keinen Zugang. Bitte eine Einladung nutzen.',
  deactivated: 'Dieses Konto ist deaktiviert.',
  expired: 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal versuchen.',
  unavailable: 'Der Login-Dienst ist gerade nicht erreichbar.',
};

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'signedIn'; me: Me } | { kind: 'error' };

export function Account({ defaultTenant }: { defaultTenant: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tenant, setTenant] = useState(defaultTenant);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('loginError');
    fetch('/api/v1/auth/me')
      .then(async (r) => {
        setLoginError(error);
        if (r.status === 401) return setState({ kind: 'anonymous' });
        if (!r.ok) return setState({ kind: 'error' });
        setState({ kind: 'signedIn', me: (await r.json()) as Me });
      })
      .catch(() => setState({ kind: 'error' }));
  }, []);

  // Kurzname klein schreiben, bevor das Formular zur API geht
  function normalize(e: FormEvent<HTMLFormElement>) {
    setTenant(tenant.trim().toLowerCase());
    const input = e.currentTarget.elements.namedItem('tenant');
    if (input instanceof HTMLInputElement) input.value = input.value.trim().toLowerCase();
  }

  async function logout() {
    const r = await fetch('/api/v1/auth/logout', { method: 'POST' });
    const { logoutUrl } = (await r.json()) as { logoutUrl: string };
    window.location.assign(logoutUrl);
  }

  if (state.kind === 'loading') return <p>Einen Moment …</p>;
  if (state.kind === 'error') return <p role="alert">Die API ist nicht erreichbar.</p>;

  if (state.kind === 'signedIn') {
    const { me } = state;
    return (
      <div>
        <p>
          Angemeldet als <strong>{me.displayName}</strong> ({me.email})
          <br />
          Mandant {me.tenant.name} (<code>{me.tenant.slug}</code>)
          {me.orgRole === 'org_admin' ? ', Organisations-Admin' : ''}
        </p>
        <button type="button" onClick={logout} style={buttonStyle}>
          Abmelden
        </button>
      </div>
    );
  }

  return (
    // Ein normales Formular: Der Browser navigiert zur API, die zum Login-Dienst weiterleitet.
    <form method="get" action="/api/v1/auth/login" onSubmit={normalize}>
      <input type="hidden" name="returnTo" value="/" />
      {loginError && (
        <p role="alert" style={{ color: 'var(--nf-attention)' }}>
          {LOGIN_ERRORS[loginError] ?? 'Die Anmeldung ist fehlgeschlagen.'}
        </p>
      )}
      <label htmlFor="tenant" style={{ display: 'block', marginBottom: 6 }}>
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
        style={{ padding: '8px 10px', fontSize: 15, marginRight: 8 }}
      />
      <button type="submit" style={buttonStyle}>
        Anmelden
      </button>
    </form>
  );
}

const buttonStyle = {
  padding: '8px 16px',
  fontSize: 15,
  border: 0,
  borderRadius: 6,
  background: 'var(--nf-accent)',
  color: '#fff',
  cursor: 'pointer',
} as const;
