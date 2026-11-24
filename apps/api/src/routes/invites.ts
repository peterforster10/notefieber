// Einladungen in einen Workspace (ROADMAP M0, Epic E02). Anlegen, auflisten und zurücknehmen
// dürfen nur Owner und Admins des Workspaces sowie Organisations-Admins; das prüft die
// Datenbank selbst (RLS auf invites). Ein Einladungslink enthält ein zufälliges Token, in
// der Datenbank steht nur sein Hash. E-Mails verschickt die App (noch) nicht: Die API gibt
// den Link einmal zurück, die einladende Person gibt ihn weiter.
//
//   GET    /workspaces/:id/invites     Einladungen des Workspaces (nur Admins)
//   POST   /workspaces/:id/invites     einladen: email, role (member, admin, guest), days
//   DELETE /invites/:id                zurücknehmen (solange nicht angenommen)
//   GET    /invites/:token             Angaben zum Link, vor dem Login (app.find_invite)
//
// Angenommen wird beim Login: /api/v1/auth/login?invite=<token> (auth/accounts.ts).
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { idSchema } from '@notefieber/shared';
import { getAuth, hashToken, newSessionToken } from '../auth/session.ts';
import type { ApiConfig } from '../config.ts';
import { withContext } from '../db.ts';

const createBody = z.object({
  email: z.email().max(320),
  role: z.enum(['member', 'admin', 'guest']).default('member'),
  days: z.number().int().min(1).max(30).default(7),
});

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export function invitesRouter(c: ApiConfig, db: pg.Pool) {
  const router = express.Router();
  const signedIn = (res: Response) => {
    const auth = getAuth(res);
    if (!auth) res.status(401).json({ error: 'unauthenticated' });
    return auth;
  };

  router.get('/workspaces/:id/invites', async (req: Request, res: Response) => {
    const auth = signedIn(res);
    if (!auth) return;
    const workspaceId = idSchema.parse(req.params.id);
    const rows = await withContext(db, auth, async (tx) => {
      // Die Regel auf invites zeigt anderen einfach nichts; hier lieber deutlich ablehnen
      const admin = await tx.query<{ ok: boolean }>('SELECT app.is_workspace_admin($1, $2) AS ok', [
        workspaceId,
        auth.userId,
      ]);
      if (!admin.rows[0]?.ok) return undefined;
      const r = await tx.query<{
        id: string;
        email: string;
        role: string;
        created_at: Date;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
        invited_by_name: string | null;
      }>(
        `SELECT i.id, i.email, i.role, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
                u.display_name AS invited_by_name
         FROM invites i LEFT JOIN users u ON u.id = i.invited_by
         WHERE i.workspace_id = $1 ORDER BY i.created_at DESC, i.id LIMIT 100`,
        [workspaceId],
      );
      return r.rows;
    });
    if (!rows) {
      res.status(403).json({
        error: 'forbidden',
        code: 'invites_admin_only',
        message: 'Nur Admins des Workspaces sehen die Einladungen',
      });
      return;
    }
    res.json(
      rows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        status: i.accepted_at ? 'accepted' : i.revoked_at ? 'revoked' : i.expires_at < new Date() ? 'expired' : 'open',
        invitedBy: i.invited_by_name,
      })),
    );
  });

  router.post('/workspaces/:id/invites', async (req: Request, res: Response) => {
    const auth = signedIn(res);
    if (!auth) return;
    const workspaceId = idSchema.parse(req.params.id);
    const body = createBody.parse(req.body);
    const token = newSessionToken();
    const result = await withContext(db, auth, async (tx) => {
      // Schon Mitglied? Dann ist keine Einladung nötig
      const member = await tx.query(
        `SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND lower(u.email) = lower($2)`,
        [workspaceId, body.email],
      );
      if (member.rowCount) return { error: 'already_member' as const };
      const id = (await tx.query<{ id: string }>('SELECT uuidv7() AS id')).rows[0]!.id;
      // Direkt in invites: Die Regel lässt nur Admins des Workspaces zu, im eigenen Namen
      await tx.query(
        `INSERT INTO invites (id, tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8))`,
        [id, auth.tenantId, workspaceId, body.email, body.role, hashToken(token), auth.userId, body.days],
      );
      await tx.query(`SELECT app.audit_event($1, 'invite.created', 'workspace', $2, $3)`, [
        auth.userId,
        workspaceId,
        JSON.stringify({ invite_id: id, email: body.email, role: body.role }),
      ]);
      const { rows } = await tx.query<{ expires_at: Date }>('SELECT expires_at FROM invites WHERE id = $1', [id]);
      return { id, expiresAt: rows[0]!.expires_at };
    });
    if ('error' in result) {
      res.status(409).json({ error: result.error, message: 'Diese Person ist schon Mitglied des Workspaces' });
      return;
    }
    // Das Token gibt es nur jetzt; in der Datenbank steht nur sein Hash
    res.status(201).json({ ...result, link: new URL(`/invite/${token}`, c.PUBLIC_URL).href });
  });

  router.delete('/invites/:id', async (req: Request, res: Response) => {
    const auth = signedIn(res);
    if (!auth) return;
    const id = idSchema.parse(req.params.id);
    const revoked = await withContext(db, auth, async (tx) => {
      const r = await tx.query<{ workspace_id: string }>(
        `UPDATE invites SET revoked_at = now()
         WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING workspace_id`,
        [id],
      );
      const ws = r.rows[0]?.workspace_id;
      if (ws) {
        await tx.query(`SELECT app.audit_event($1, 'invite.revoked', 'workspace', $2, $3)`, [
          auth.userId,
          ws,
          JSON.stringify({ invite_id: id }),
        ]);
      }
      return Boolean(ws);
    });
    if (!revoked) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  });

  // Vor dem Login: Was steht in der Einladung? Nur mit dem Token aus dem Link.
  router.get('/invites/:token', async (req: Request, res: Response) => {
    const token = tokenParam.safeParse(req.params.token);
    const { rows } = token.success
      ? await db.query<{
          tenant_name: string;
          workspace_name: string;
          email: string;
          role: string;
          invited_by_name: string | null;
        }>('SELECT tenant_name, workspace_name, email, role, invited_by_name FROM app.find_invite($1)', [
          hashToken(token.data),
        ])
      : { rows: [] };
    const i = rows[0];
    if (!i) {
      res.status(404).json({
        error: 'not_found',
        code: 'invite_invalid',
        message: 'Einladung ungültig, abgelaufen oder schon benutzt',
      });
      return;
    }
    res.json({
      tenantName: i.tenant_name,
      workspaceName: i.workspace_name,
      email: i.email,
      role: i.role,
      invitedBy: i.invited_by_name,
    });
  });

  return router;
}
