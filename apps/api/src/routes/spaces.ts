// Workspaces, Spaces und Seitenbaum (ROADMAP M0, Epics E05 und E06). Nur für angemeldete
// Personen. Jede Anfrage läuft in einer Transaktion mit Mandant und Person aus der Sitzung;
// was die Person sehen und tun darf, entscheiden Row Level Security und die Funktionen in
// app (app.create_space, update_space, archive_space, tree_level, create_page, move_page,
// trash_page, restore_page).
//
//   GET    /workspaces                    Workspaces der Person
//   GET    /spaces                        sichtbare Spaces mit eigener Rolle
//   POST   /spaces                        Space anlegen (mit Startseite)
//   GET    /spaces/:key                   ein Space
//   PATCH  /spaces/:key                   Name und Beschreibung ändern (Space-Admins)
//   POST   /spaces/:key/archive           archivieren oder zurückholen (Space- und Organisations-Admins)
//   GET    /spaces/:key/pages?parent=     eine Ebene des Seitenbaums (ohne parent: oberste Ebene)
//   GET    /spaces/:key/trash             Papierkorb (die gemeinsam gelöschten Wurzeln)
//   POST   /spaces/:key/pages             Seite anlegen
//   GET    /pages/search?q=&space=        Seiten nach Titel (Seitenlinks, höchstens 10)
//   POST   /pages/lookup                  Titel zu Seiten-IDs (Seitenlinks), nur lesbare
//   GET    /pages/:id                     Seite mit Brotkrume
//   POST   /pages/:id/move                verschieben (Elternseite, Nachbar davor/dahinter)
//   DELETE /pages/:id                     in den Papierkorb
//   POST   /pages/:id/restore             aus dem Papierkorb zurück
//   POST   /pages/:id/title               umbenennen (über den Collab-Server, E04-08)
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { idSchema, pageTitleSchema, roleRank, spaceKeySchema, type SpaceRole } from '@notefieber/shared';
import { getAuth } from '../auth/session.ts';
import { CollabUnavailable, type CollabClient } from '../collab-client.ts';
import { withContext } from '../db.ts';
import { positionFor, type Sibling } from '../positions.ts';

type Tx = pg.PoolClient;

// Schlüssel wie ENTW; in Adressen klein geschrieben (/spaces/entw), deshalb beide Schreibweisen
const spaceKey = z
  .string()
  .transform((k) => k.toUpperCase())
  .pipe(spaceKeySchema);

interface SpaceRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  workspace_id: string;
  home_page_id: string | null;
  archived_at: Date | null;
  role: SpaceRole | null;
  can_manage: boolean;
}

// can_manage: archivieren und zurückholen; im archivierten Space meldet role nur viewer
const SPACE_COLUMNS = `s.id, s.key, s.name, s.description, s.workspace_id, s.home_page_id, s.archived_at,
  app.space_role(s.id) AS role, app.can_manage_space(s.id) AS can_manage`;

function space(r: SpaceRow) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    workspaceId: r.workspace_id,
    homePageId: r.home_page_id,
    archived: r.archived_at !== null,
    role: r.role,
    canManage: r.can_manage,
  };
}

const spaceName = z.string().trim().min(1).max(200);
const spaceDescription = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((d) => d || null);

const createSpaceBody = z.object({
  key: spaceKey,
  name: spaceName,
  description: spaceDescription,
  workspaceId: idSchema.optional(),
  /** Rolle für alle im Workspace (ohne Gäste); null = keine. Standard: lesen */
  workspaceAccess: z.enum(['viewer', 'commenter', 'editor']).nullable().default('viewer'),
});

// Titel beim Anlegen und Umbenennen: Leerraum außen fällt weg, danach 1 bis 255 Zeichen
// (REVIEW_M1.md, R-24). Nur der Editor selbst lässt einen leeren Titel zu („Ohne Titel“).
const titleInput = pageTitleSchema.trim().min(1);

const createPageBody = z.object({
  parentId: idSchema.nullable(),
  title: titleInput,
  /** Neue Seite direkt hinter diese Geschwisterseite; sonst ans Ende */
  afterId: idSchema.nullish(),
});

const updateSpaceBody = z.object({ name: spaceName, description: spaceDescription });
const archiveBody = z.object({ archived: z.boolean() });
const treeQuery = z.object({ parent: idSchema.optional() });

interface TreeRow {
  id: string;
  parent_id: string | null;
  position: string;
  title: string;
  inherit_perms: boolean;
  role: SpaceRole | null;
  has_children: boolean;
}

const moveBody = z
  .object({
    parentId: idSchema.nullable(),
    afterId: idSchema.nullish(),
    beforeId: idSchema.nullish(),
  })
  .refine((b) => !(b.afterId && b.beforeId), 'afterId oder beforeId, nicht beides');

class NotFound extends Error {}

async function spaceByKey(tx: Tx, key: string): Promise<SpaceRow> {
  const { rows } = await tx.query<SpaceRow>(`SELECT ${SPACE_COLUMNS} FROM spaces s WHERE s.key = $1`, [key]);
  if (!rows[0]) throw new NotFound();
  return rows[0];
}

/** Sichtbare, nicht gelöschte Kinder einer Elternseite (bzw. Wurzeln bei NULL) */
async function siblings(tx: Tx, spaceId: string, parentId: string | null, exceptId?: string): Promise<Sibling[]> {
  const { rows } = await tx.query<Sibling>(
    `SELECT id, position FROM pages
     WHERE space_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL AND id IS DISTINCT FROM $3`,
    [spaceId, parentId, exceptId ?? null],
  );
  return rows;
}

const renameBody = z.object({ title: titleInput });

const searchQuery = z.object({
  q: z.string().trim().max(255).optional(),
  space: spaceKey.optional(),
});
const lookupBody = z.object({ ids: z.array(idSchema).min(1).max(100) });

interface SearchRow {
  id: string;
  title: string;
  space_key: string;
}

export function spacesRouter(db: pg.Pool, collab?: CollabClient) {
  const router = express.Router();

  const tx = <T>(res: Response, fn: (tx: Tx) => Promise<T>) => {
    const auth = getAuth(res)!;
    return withContext(db, { tenantId: auth.tenantId, userId: auth.userId }, fn);
  };
  const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    if (!getAuth(res)) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof NotFound) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      throw err;
    }
  };

  router.get(
    '/workspaces',
    handle(async (_req, res) => {
      const auth = getAuth(res)!;
      const rows = await tx(res, async (t) => {
        const r = await t.query<{ id: string; slug: string; name: string; role: string }>(
          `SELECT w.id, w.slug, w.name, m.role FROM workspaces w
           JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
           WHERE w.archived_at IS NULL ORDER BY w.name, w.id`,
          [auth.userId],
        );
        return r.rows;
      });
      res.json(rows);
    }),
  );

  router.get(
    '/spaces',
    handle(async (_req, res) => {
      const rows = await tx(res, async (t) => {
        const r = await t.query<SpaceRow>(`SELECT ${SPACE_COLUMNS} FROM spaces s ORDER BY s.name, s.id`);
        return r.rows;
      });
      res.json(rows.map(space));
    }),
  );

  router.post(
    '/spaces',
    handle(async (req, res) => {
      const body = createSpaceBody.parse(req.body);
      const auth = getAuth(res)!;
      const created = await tx(res, async (t) => {
        let workspaceId = body.workspaceId;
        if (!workspaceId) {
          // Ohne Angabe: der einzige Workspace der Person; bei mehreren muss sie wählen
          const { rows } = await t.query<{ workspace_id: string }>(
            `SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND role <> 'guest'`,
            [auth.userId],
          );
          if (rows.length !== 1) return { error: 'workspace_required' as const };
          workspaceId = rows[0]!.workspace_id;
        }
        await t.query('SELECT app.create_space($1, $2, $3, $4, $5, $6)', [
          workspaceId,
          body.key,
          body.name,
          auth.userId,
          body.workspaceAccess,
          body.description ?? null,
        ]);
        return spaceByKey(t, body.key);
      });
      if ('error' in created) {
        res.status(400).json({ error: created.error, message: 'workspaceId angeben (mehrere Workspaces)' });
        return;
      }
      res.status(201).json(space(created));
    }),
  );

  router.get(
    '/spaces/:key',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      res.json(space(await tx(res, (t) => spaceByKey(t, key))));
    }),
  );

  router.patch(
    '/spaces/:key',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      const body = updateSpaceBody.parse(req.body);
      const auth = getAuth(res)!;
      const updated = await tx(res, async (t) => {
        const s = await spaceByKey(t, key);
        await t.query('SELECT app.update_space($1, $2, $3, $4)', [s.id, body.name, body.description, auth.userId]);
        return spaceByKey(t, key);
      });
      res.json(space(updated));
    }),
  );

  router.post(
    '/spaces/:key/archive',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      const { archived } = archiveBody.parse(req.body);
      const auth = getAuth(res)!;
      const updated = await tx(res, async (t) => {
        const s = await spaceByKey(t, key);
        await t.query('SELECT app.archive_space($1, $2, $3)', [s.id, archived, auth.userId]);
        return spaceByKey(t, key);
      });
      res.json(space(updated));
    }),
  );

  // Eine Ebene des Seitenbaums (ARCHITECTURE_REVIEW.md, A-01): die Seiten, deren nächste
  // sichtbare Vorfahrin `parent` ist, ohne `parent` die oberste Ebene. Seiten unter einer für
  // die Person unsichtbaren Seite stehen so unter der nächsten sichtbaren (parentId bleibt die
  // echte Elternseite). Unsichtbare Elternseite: leere Liste. Rechte rechnet app.tree_level
  // einmal pro Ebene, nicht pro Seite.
  router.get(
    '/spaces/:key/pages',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      const { parent } = treeQuery.parse(req.query);
      const pages = await tx(res, async (t) => {
        const s = await spaceByKey(t, key);
        const { rows } = await t.query<TreeRow>('SELECT * FROM app.tree_level($1, $2)', [s.id, parent ?? null]);
        return rows;
      });
      res.json(
        pages.map((p) => ({
          id: p.id,
          parentId: p.parent_id,
          position: p.position,
          title: p.title,
          restricted: !p.inherit_perms,
          role: p.role,
          hasChildren: p.has_children,
        })),
      );
    }),
  );

  router.get(
    '/spaces/:key/trash',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      const rows = await tx(res, async (t) => {
        const s = await spaceByKey(t, key);
        const r = await t.query<{ id: string; title: string; deleted_at: Date; parent_id: string | null }>(
          `SELECT id, title, deleted_at, parent_id FROM pages
           WHERE space_id = $1 AND deleted_at IS NOT NULL AND trash_root_id = id ORDER BY deleted_at DESC, id`,
          [s.id],
        );
        return r.rows;
      });
      res.json(rows.map((p) => ({ id: p.id, title: p.title, deletedAt: p.deleted_at, parentId: p.parent_id })));
    }),
  );

  router.post(
    '/spaces/:key/pages',
    handle(async (req, res) => {
      const key = spaceKey.parse(req.params.key);
      const body = createPageBody.parse(req.body);
      const auth = getAuth(res)!;
      const id = await tx(res, async (t) => {
        const s = await spaceByKey(t, key);
        // Ohne afterId hängt app.create_page die Seite hinter alle Geschwister, auch unsichtbare
        const position = body.afterId ? positionFor(await siblings(t, s.id, body.parentId), body) : null;
        const { rows } = await t.query<{ id: string }>('SELECT app.create_page($1, $2, $3, $4, $5) AS id', [
          s.id,
          body.parentId,
          body.title,
          auth.userId,
          position,
        ]);
        return rows[0]!.id;
      });
      res.status(201).json({ id });
    }),
  );

  // Titelsuche für Seitenlinks („[“ im Editor) und später die Schnellsuche (E07, E12). Rechte über
  // die Leseregel auf pages; die rechnet app.page_rank pro Treffer, deshalb höchstens 10 und
  // mengenbasiert mit der Suche in M3 (ARCHITECTURE_REVIEW.md, A-01). Ohne Suchtext: zuletzt
  // geänderte Seiten im angegebenen Space.
  router.get(
    '/pages/search',
    handle(async (req, res) => {
      const query = searchQuery.parse(req.query);
      const rows = await tx(res, async (t) => {
        if (!query.q) {
          if (!query.space) return [];
          return (
            await t.query<SearchRow>(
              `SELECT p.id, p.title, s.key AS space_key FROM pages p JOIN spaces s ON s.id = p.space_id
               WHERE s.key = $1 AND s.archived_at IS NULL AND p.deleted_at IS NULL
               ORDER BY p.updated_at DESC, p.id LIMIT 10`,
              [query.space],
            )
          ).rows;
        }
        const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        return (
          await t.query<SearchRow>(
            `SELECT p.id, p.title, s.key AS space_key FROM pages p JOIN spaces s ON s.id = p.space_id
             WHERE p.title ILIKE $1 AND s.archived_at IS NULL AND p.deleted_at IS NULL
             ORDER BY (s.key = $3) DESC, similarity(p.title, $2) DESC, p.title, p.id LIMIT 10`,
            [pattern, query.q, query.space ?? null],
          )
        ).rows;
      });
      res.json(rows.map((r) => ({ id: r.id, title: r.title, spaceKey: r.space_key })));
    }),
  );

  // Titel verlinkter Seiten (Seitenlinks speichern nur die ID). Nicht lesbare und endgültig
  // gelöschte Seiten fehlen einfach, ohne Unterschied: Das verrät nichts über sie.
  router.post(
    '/pages/lookup',
    handle(async (req, res) => {
      const { ids } = lookupBody.parse(req.body);
      const rows = await tx(
        res,
        async (t) =>
          (
            await t.query<SearchRow & { deleted_at: Date | null }>(
              `SELECT p.id, p.title, s.key AS space_key, p.deleted_at FROM pages p JOIN spaces s ON s.id = p.space_id
               WHERE p.id = ANY($1::uuid[])`,
              [ids],
            )
          ).rows,
      );
      res.json(rows.map((r) => ({ id: r.id, title: r.title, spaceKey: r.space_key, trashed: r.deleted_at !== null })));
    }),
  );

  router.get(
    '/pages/:id',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const page = await tx(res, async (t) => {
        const { rows } = await t.query<{
          id: string;
          space_key: string;
          parent_id: string | null;
          title: string;
          inherit_perms: boolean;
          deleted_at: Date | null;
          role: SpaceRole | null;
        }>(
          `SELECT p.id, s.key AS space_key, p.parent_id, p.title, p.inherit_perms, p.deleted_at,
                  app.page_role(p.id) AS role
           FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = $1`,
          [id],
        );
        const p = rows[0];
        if (!p) throw new NotFound();
        // Brotkrume: nur Vorfahren, die die Person lesen darf (RLS)
        const crumbs = await t.query<{ id: string; title: string }>(
          `SELECT a.id, a.title FROM pages p JOIN pages a ON a.space_id = p.space_id AND a.path @> p.path AND a.id <> p.id
           WHERE p.id = $1 ORDER BY nlevel(a.path)`,
          [id],
        );
        return { p, breadcrumb: crumbs.rows };
      });
      res.json({
        id: page.p.id,
        spaceKey: page.p.space_key,
        parentId: page.p.parent_id,
        title: page.p.title,
        restricted: !page.p.inherit_perms,
        trashed: page.p.deleted_at !== null,
        role: page.p.role,
        breadcrumb: page.breadcrumb,
      });
    }),
  );

  router.post(
    '/pages/:id/move',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const body = moveBody.parse(req.body);
      const auth = getAuth(res)!;
      await tx(res, async (t) => {
        const { rows } = await t.query<{ space_id: string }>('SELECT space_id FROM pages WHERE id = $1', [id]);
        if (!rows[0]) throw new NotFound();
        const position = positionFor(await siblings(t, rows[0].space_id, body.parentId, id), body);
        await t.query('SELECT app.move_page($1, $2, $3, $4)', [id, body.parentId, position, auth.userId]);
      });
      res.status(204).end();
    }),
  );

  router.delete(
    '/pages/:id',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const auth = getAuth(res)!;
      const count = await tx(res, async (t) => {
        const { rows } = await t.query<{ n: number }>('SELECT app.trash_page($1, $2) AS n', [id, auth.userId]);
        return rows[0]!.n;
      });
      res.json({ count });
    }),
  );

  router.post(
    '/pages/:id/restore',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const auth = getAuth(res)!;
      const count = await tx(res, async (t) => {
        const { rows } = await t.query<{ n: number }>('SELECT app.restore_page($1, $2) AS n', [id, auth.userId]);
        return rows[0]!.n;
      });
      res.json({ count });
    }),
  );

  // Umbenennen aus der Seitenleiste (E04-08). Der Titel lebt im Yjs-Dokument; die API ändert
  // pages.title nie selbst, sondern prüft die Rechte und lässt den Collab-Server das Dokument
  // ändern (interner Aufruf). Wenn die Antwort kommt, ist der neue Titel schon gespeichert.
  router.post(
    '/pages/:id/title',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { title } = renameBody.parse(req.body);
      const auth = getAuth(res)!;
      const page = await tx(res, async (t) => {
        const { rows } = await t.query<{ trashed: boolean; role: SpaceRole | null }>(
          'SELECT deleted_at IS NOT NULL AS trashed, app.page_role(id) AS role FROM pages WHERE id = $1',
          [id],
        );
        return rows[0];
      });
      if (!page) throw new NotFound();
      if (roleRank(page.role) < roleRank('editor')) {
        res.status(403).json({ error: 'forbidden', message: 'Nur wer bearbeiten darf, kann umbenennen' });
        return;
      }
      if (page.trashed) {
        res.status(409).json({ error: 'rejected', message: 'Seite liegt im Papierkorb' });
        return;
      }
      if (!collab) {
        res.status(503).json({ error: 'unavailable', message: 'Umbenennen ist nicht eingerichtet' });
        return;
      }
      try {
        const result = await collab.renamePage(id, { tenantId: auth.tenantId, userId: auth.userId, title });
        if (result === 'not-found') throw new NotFound();
        if (result === 'trashed') {
          res.status(409).json({ error: 'rejected', message: 'Seite liegt im Papierkorb' });
          return;
        }
      } catch (err) {
        if (!(err instanceof CollabUnavailable)) throw err;
        console.error(`API: ${err.message}`);
        res.status(503).json({ error: 'unavailable', message: 'Umbenennen gerade nicht möglich' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
