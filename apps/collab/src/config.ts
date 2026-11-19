// Einstellungen des Collab-Servers aus der Umgebung (.env, Vorlage .env.example).
import { z } from 'zod';

const schema = z.object({
  COLLAB_PORT: z.coerce.number().int().min(0).max(65535).default(1234),
  // Adresse, an der er lauscht (REVIEW.md, R-15): lokal nur 127.0.0.1, im Container 0.0.0.0
  COLLAB_HOST: z.string().min(1).default('127.0.0.1'),
  COLLAB_DATABASE_URL: z.string().min(1, 'COLLAB_DATABASE_URL fehlt (Login-Rolle in wiki_worker)'),
  // Adresse des Frontends: Nur Verbindungen mit diesem Origin kommen herein, sonst könnte eine
  // fremde Seite mit dem Cookie der Person eine Verbindung öffnen (Cross-Site WebSocket Hijacking)
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  // Speichern entprellt (CLAUDE.md, Abschnitt 6): etwa alle 2 s, spätestens nach 10 s
  COLLAB_DEBOUNCE_MS: z.coerce.number().int().min(0).default(2000),
  COLLAB_MAX_DEBOUNCE_MS: z.coerce.number().int().min(0).default(10000),
  // Offene Verbindungen regelmäßig neu prüfen: abgelaufene Sitzungen, verpasste Meldungen (E04-06: 5 Minuten)
  COLLAB_RECHECK_SECONDS: z.coerce.number().min(1).default(300),
});

export type CollabConfig = z.infer<typeof schema>;

export function collabConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  return schema.parse(env);
}
