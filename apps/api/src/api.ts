// Start der REST-API (Express 5) unter /api/v1; Aufbau in app.ts.
import { createApp } from './app.ts';
import { createOidc } from './auth/oidc.ts';
import { apiConfig } from './config.ts';
import { connect } from './db.ts';

const config = apiConfig();
const db = await connect(config.API_DATABASE_URL, 'wiki_app', 'notefieber-api');
const app = createApp(config, db, createOidc(config));

const server = app.listen(config.API_PORT, () => {
  console.log(`API: http://localhost:${config.API_PORT}/api/v1/health (öffentlich: ${config.PUBLIC_URL})`);
});

function shutdown(signal: string) {
  console.log(`API: ${signal}, beende`);
  server.close(() => void db.end().then(() => process.exit(0)));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
