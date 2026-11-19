// Ereignisse aus der Datenbank per LISTEN (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-08):
//   nf_events    Trigger outbox_notify: {tenant, space, type} zu jedem Ereignis in der Outbox
//   nf_sessions  app.end_session: {tenant, session} beim Abmelden
// Eigene Verbindung (nicht aus dem Pool), weil LISTEN an der Sitzung hängt. Reißt sie ab, baut der
// Listener sie mit wachsendem Abstand neu auf und meldet onReconnect: Was dazwischen geschah, kam
// nicht an, also alle offenen Verbindungen neu prüfen. Später ersetzt NATS nur den Transport.
import pg from 'pg';
import { z } from 'zod';

const eventSchema = z.object({ tenant: z.string(), space: z.string(), type: z.string() });
const sessionSchema = z.object({ tenant: z.string(), session: z.string() });

export interface EventHandlers {
  onEvent(e: z.infer<typeof eventSchema>): void;
  onSessionEnded(e: z.infer<typeof sessionSchema>): void;
  /** Nach einem Abriss wieder verbunden: verpasste Meldungen nachholen (alles neu prüfen) */
  onReconnect(): void;
}

export interface Listener {
  /** Resolves, sobald LISTEN zum ersten Mal steht */
  ready: Promise<void>;
  stop(): Promise<void>;
}

export function listen(connectionString: string, handlers: EventHandlers): Listener {
  let client: pg.Client | undefined;
  let stopped = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));

  const parse = <T>(schema: z.ZodType<T>, payload: string | undefined): T | undefined => {
    try {
      const r = schema.safeParse(JSON.parse(payload ?? ''));
      return r.success ? r.data : undefined;
    } catch {
      return undefined;
    }
  };

  const scheduleReconnect = () => {
    if (stopped || timer) return;
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    timer = setTimeout(() => {
      timer = undefined;
      void connect(true);
    }, delay);
  };

  async function connect(isReconnect: boolean) {
    const c = new pg.Client({ connectionString, application_name: 'notefieber-collab-listen' });
    c.on('error', (err) => {
      console.error(`Collab-Server: LISTEN-Verbindung abgerissen: ${err.message}`);
      if (client === c) client = undefined;
      void c.end().catch(() => undefined);
      scheduleReconnect();
    });
    c.on('end', () => {
      if (client === c) {
        client = undefined;
        scheduleReconnect();
      }
    });
    c.on('notification', (msg) => {
      if (msg.channel === 'nf_events') {
        const e = parse(eventSchema, msg.payload);
        if (e) handlers.onEvent(e);
      } else if (msg.channel === 'nf_sessions') {
        const e = parse(sessionSchema, msg.payload);
        if (e) handlers.onSessionEnded(e);
      }
    });
    try {
      await c.connect();
      await c.query('LISTEN nf_events');
      await c.query('LISTEN nf_sessions');
      if (stopped) return void (await c.end());
      client = c;
      attempt = 0;
      resolveReady();
      if (isReconnect) {
        console.log('Collab-Server: LISTEN wieder verbunden, prüfe alle offenen Verbindungen');
        handlers.onReconnect();
      }
    } catch (err) {
      console.error(`Collab-Server: LISTEN nicht möglich: ${err instanceof Error ? err.message : String(err)}`);
      await c.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect(false);
  return {
    ready,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      const c = client;
      client = undefined;
      await c?.end().catch(() => undefined);
    },
  };
}
