// Aufbau der Express-App, getrennt vom Start (api.ts), damit Tests sie gegen eine echte
// Datenbank starten können (*.dbtest.ts).
import express, { type ErrorRequestHandler } from 'express';
import type pg from 'pg';
import { slugSchema } from '@notefieber/shared';
import { authRouter } from './auth/routes.ts';
import type { Oidc } from './auth/oidc.ts';
import { loadSession } from './auth/session.ts';
import type { ApiConfig } from './config.ts';
import { toHttpError } from './http/errors.ts';
import { sameOriginOnly } from './http/origin.ts';
import { PositionError } from './positions.ts';
import { spacesRouter } from './routes/spaces.ts';

export function createApp(config: ApiConfig, db: pg.Pool, idp: Oidc) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.use(sameOriginOnly(config.PUBLIC_URL));
  v1.use(loadSession(db));

  v1.get('/health', async (_req, res) => {
    const { rows } = await db.query<{ login: string }>('SELECT current_user AS login');
    res.json({ status: 'ok', database: { login: rows[0]?.login } });
  });

  // Vor dem Login: Mandant und Zitadel-Organisation zum Kurznamen aus der Adresse
  // (app.resolve_tenant gibt nur das Nötigste preis).
  v1.get('/tenants/:slug', async (req, res) => {
    const slug = slugSchema.parse(req.params.slug);
    const { rows } = await db.query<{ tenant_id: string; name: string; idp_org_id: string | null }>(
      'SELECT tenant_id, name, idp_org_id FROM app.resolve_tenant($1)',
      [slug],
    );
    const t = rows[0];
    if (!t) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ tenantId: t.tenant_id, name: t.name, idpOrgId: t.idp_org_id });
  });

  v1.use('/auth', authRouter(config, db, idp));
  v1.use(spacesRouter(db));

  app.use('/api/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Express 5 leitet Fehler aus async-Handlern hierher weiter.
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof PositionError) {
      res.status(400).json({ error: 'invalid_request', message: err.message });
      return;
    }
    const http = toHttpError(err);
    if (http) {
      res.status(http.status).json(http.body);
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal' });
  };
  app.use(onError);
  return app;
}
