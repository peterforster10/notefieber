// Einstellungen aus Umgebungsvariablen, beim Start geprüft. Lokal aus der Datei .env im
// Wurzelordner (Vorlage: .env.example, siehe docs/LOCAL_SETUP.md).
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

export function apiConfig() {
  return z
    .object({
      API_PORT: port.default(4000),
      API_DATABASE_URL: z.string().min(1, 'API_DATABASE_URL fehlt (Login-Rolle in wiki_app)'),
    })
    .parse(process.env);
}

export function workerConfig() {
  return z
    .object({
      WORKER_DATABASE_URL: z.string().min(1, 'WORKER_DATABASE_URL fehlt (Login-Rolle in wiki_worker)'),
      WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
    })
    .parse(process.env);
}
