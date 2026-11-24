// Eigenes Profil der angemeldeten Person. In M2 nur die Sprache der Oberfläche (E15); Name,
// Profilbild und Zeitzone kommen mit dem Profil (E02). Gelesen wird es über GET /auth/me.
//
//   PATCH /me   { locale: 'de' | 'en' }
//
// Direkt auf users: Die Spaltenrechte erlauben wiki_app nur display_name, locale, time_zone und
// avatar_file_id, die Regel write_update nur die eigene Zeile. WHERE id = Person aus der Sitzung,
// nie eine ID aus der Anfrage.
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { getAuth } from '../auth/session.ts';
import { withContext } from '../db.ts';

/** Sprachen der Oberfläche (apps/web/src/i18n/locales.ts) */
export const LOCALES = ['de', 'en'] as const;

const patchBody = z.strictObject({ locale: z.enum(LOCALES) });

export function meRouter(db: pg.Pool) {
  const router = express.Router();

  router.patch('/me', async (req: Request, res: Response) => {
    const auth = getAuth(res);
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = patchBody.parse(req.body);
    const row = await withContext(db, { tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      await tx.query('UPDATE users SET locale = $1 WHERE id = $2', [body.locale, auth.userId]);
      const { rows } = await tx.query<{ locale: string }>('SELECT locale FROM users WHERE id = $1', [auth.userId]);
      return rows[0];
    });
    if (!row) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ locale: row.locale });
  });

  return router;
}
