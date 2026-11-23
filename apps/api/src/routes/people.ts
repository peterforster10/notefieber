// Personen für Erwähnungen im Editor (E07). Eine Erwähnung speichert nur die Personen-ID
// (packages/editor-schema, mention); Namen holt die Oberfläche hier. Wen die Person sehen darf,
// entscheiden die Leseregeln auf users und workspace_members: Personen aus Workspaces, in denen
// sie selbst Mitglied ist (nicht nur Gast), dazu sie selbst; Organisations-Admins sehen alle.
// Gäste finden und sehen deshalb nur sich selbst.
//
//   GET  /people/search?q=&space=   Personen für das @-Menü (höchstens 10, ohne Deaktivierte)
//   POST /people/lookup             Namen zu Personen-IDs, nur sichtbare
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { idSchema, spaceKeySchema } from '@notefieber/shared';
import { getAuth } from '../auth/session.ts';
import { withContext } from '../db.ts';

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  space: z
    .string()
    .transform((k) => k.toUpperCase())
    .pipe(spaceKeySchema)
    .optional(),
});
const lookupBody = z.object({ ids: z.array(idSchema).min(1).max(100) });

export function peopleRouter(db: pg.Pool) {
  const router = express.Router();

  const run = async <T>(res: Response, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T | undefined> => {
    const auth = getAuth(res);
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return undefined;
    }
    return withContext(db, { tenantId: auth.tenantId, userId: auth.userId }, fn);
  };

  // Mit space: nur Mitglieder des Workspaces, zu dem der Space gehört (Gäste eingeschlossen, sie
  // können Rechte auf einzelne Seiten haben). Ob die erwähnte Person die Seite lesen darf, prüft
  // erst die Benachrichtigung (E16): Die Rechte anderer Personen darf wiki_app nicht abfragen.
  router.get('/people/search', async (req: Request, res: Response) => {
    const query = searchQuery.parse(req.query);
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : '%';
    const rows = await run(res, async (t) => {
      if (query.space) {
        const space = await t.query('SELECT 1 FROM spaces WHERE key = $1', [query.space]);
        if (!space.rows[0]) return null;
      }
      return (
        await t.query<{ id: string; display_name: string }>(
          `SELECT u.id, u.display_name FROM users u
           WHERE u.deactivated_at IS NULL
             AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
             AND ($2::text IS NULL OR EXISTS (
                   SELECT 1 FROM workspace_members wm JOIN spaces s ON s.workspace_id = wm.workspace_id
                   WHERE wm.user_id = u.id AND s.key = $2))
           ORDER BY (u.display_name ILIKE $3) DESC, u.display_name, u.id
           LIMIT 10`,
          [pattern, query.space ?? null, `${(query.q ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
        )
      ).rows;
    });
    if (rows === undefined) return;
    if (rows === null) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(rows.map((r) => ({ id: r.id, displayName: r.display_name })));
  });

  // Nicht sichtbare Personen fehlen einfach, ohne Unterschied zu unbekannten IDs
  router.post('/people/lookup', async (req: Request, res: Response) => {
    const { ids } = lookupBody.parse(req.body);
    const rows = await run(
      res,
      async (t) =>
        (
          await t.query<{ id: string; display_name: string; deactivated_at: Date | null }>(
            'SELECT id, display_name, deactivated_at FROM users WHERE id = ANY($1::uuid[])',
            [ids],
          )
        ).rows,
    );
    if (rows === undefined) return;
    res.json(rows.map((r) => ({ id: r.id, displayName: r.display_name, deactivated: r.deactivated_at !== null })));
  });

  return router;
}
