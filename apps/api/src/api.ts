// REST-API (Express 5) unter /api/v1. Grundgerüst: Gesundheit und die Abfrage vor dem
// Login (Mandant zum Kurznamen). Login über OIDC, Spaces und Seiten folgen (ROADMAP M0).
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { slugSchema } from '@notefieber/shared';
import { apiConfig } from './config.ts';
import { connect } from './db.ts';

const config = apiConfig();
const db = await connect(config.API_DATABASE_URL, 'wiki_app', 'notefieber-api');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const v1 = express.Router();

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

app.use('/api/v1', v1);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Express 5 leitet Fehler aus async-Handlern hierher weiter.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', issues: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal' });
};
app.use(onError);

const server = app.listen(config.API_PORT, () => {
  console.log(`API: http://localhost:${config.API_PORT}/api/v1/health`);
});

function shutdown(signal: string) {
  console.log(`API: ${signal}, beende`);
  server.close(() => void db.end().then(() => process.exit(0)));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
