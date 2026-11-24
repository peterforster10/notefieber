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
import { invitesRouter } from './routes/invites.ts';
import { createCollabClient } from './collab-client.ts';
import { filesRouter } from './routes/files.ts';
import { meRouter } from './routes/me.ts';
import { peopleRouter } from './routes/people.ts';
import { spacesRouter } from './routes/spaces.ts';
import { s3Store, type BlobStore } from './storage.ts';

/** `store`: Speicher für Dateien, ohne Angabe Garage aus den S3-Einstellungen (Tests: memoryStore) */
export function createApp(config: ApiConfig, db: pg.Pool, idp: Oidc, store: BlobStore = s3Store(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.use(sameOriginOnly(config.PUBLIC_URL));
  v1.use(loadSession(db));

  // Ohne Anmeldung erreichbar: nur, ob die Datenbank antwortet, nicht mit welcher Rolle
  // (die prüft die App beim Start selbst; REVIEW.md, R-13)
  v1.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
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
  v1.use(invitesRouter(config, db));
  v1.use(filesRouter(config, db, store));
  v1.use(meRouter(db));
  v1.use(peopleRouter(db));
  v1.use(spacesRouter(db, createCollabClient(config.COLLAB_INTERNAL_URL, config.COLLAB_INTERNAL_SECRET)));

  app.use('/api/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Express 5 leitet Fehler aus async-Handlern hierher weiter.
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Zu großer Body (express.json, express.raw beim Hochladen)
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', message: 'Datei oder Anfrage zu groß' });
      return;
    }
    if (err instanceof PositionError) {
      res.status(400).json({ error: 'invalid_request', code: 'invalid_position', message: err.message });
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
