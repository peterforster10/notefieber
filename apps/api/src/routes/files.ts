// Dateien an Seiten (E11), in M2 nur Bilder für den Bild-Block im Editor (E07). Hoch- und
// Herunterladen laufen über die API, nicht über signierte URLs: Garage bleibt nur im Cluster
// (CLAUDE.md, Abschnitt 11), und jede Anfrage prüft das Leserecht neu. Welche Dateien die Person
// sehen darf, entscheidet die Leseregel auf files (wie die Seite); hochladen darf nur, wer die
// Seite bearbeiten darf (Regel write_insert und vorher app.page_role).
//
//   POST /pages/:id/files   Bild hochladen (roher Body, Name im Header X-File-Name)
//   GET  /files/:id         Datei ansehen
//
// Bis zum Virenscan (M3) haben alle Dateien scan_status pending. Mit FILES_REQUIRE_SCAN liefert
// die API nur clean aus; ohne (lokal) auch pending, aber ohnehin nur die erlaubten Bildtypen,
// deren Typ sie an den ersten Bytes erkannt hat (nie SVG: könnte Skripte enthalten).
import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { idSchema, roleRank, type SpaceRole } from '@notefieber/shared';
import { getAuth } from '../auth/session.ts';
import type { ApiConfig } from '../config.ts';
import { withContext } from '../db.ts';
import type { BlobStore } from '../storage.ts';

type Tx = pg.PoolClient;

const IMAGE_TYPES = [
  {
    mime: 'image/png',
    ext: 'png',
    magic: (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mime: 'image/jpeg', ext: 'jpg', magic: (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/gif', ext: 'gif', magic: (b: Uint8Array) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
  { mime: 'image/webp', ext: 'webp', magic: (b: Uint8Array) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
] as const;
const INLINE_TYPES = new Set<string>(IMAGE_TYPES.map((t) => t.mime));

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((v, i) => bytes[i] === v);
}
function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  return [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
}

/** Bildtyp an den ersten Bytes; der Content-Type des Browsers zählt nicht */
export function detectImage(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | undefined {
  return IMAGE_TYPES.find((t) => t.magic(bytes));
}

/** Dateiname aus dem Header: URL-kodiert, ohne Steuerzeichen und Pfad, höchstens 255 Zeichen */
export function fileName(header: string | undefined, ext: string): string {
  let name = '';
  try {
    name = decodeURIComponent(header ?? '');
  } catch {
    name = '';
  }
  // eslint-disable-next-line no-control-regex -- Steuerzeichen gehören nicht in Dateinamen
  name = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || `bild.${ext}`).slice(0, 255);
}

class HttpFail extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export function filesRouter(config: ApiConfig, db: pg.Pool, store: BlobStore) {
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
      if (err instanceof HttpFail) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  };

  router.post(
    '/pages/:id/files',
    express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }),
    handle(async (req, res) => {
      const pageId = idSchema.parse(req.params.id);
      const auth = getAuth(res)!;
      // Vorher prüfen, damit nichts Unberechtigtes in Garage landet; die Regel auf files prüft
      // beim Einfügen noch einmal
      const page = await tx(res, async (t) => {
        const { rows } = await t.query<{ deleted_at: Date | null; role: SpaceRole | null }>(
          'SELECT deleted_at, app.page_role(id) AS role FROM pages WHERE id = $1',
          [pageId],
        );
        return rows[0];
      });
      if (!page) throw new HttpFail(404, 'not_found');
      if (roleRank(page.role) < roleRank('editor')) throw new HttpFail(403, 'forbidden', 'Nur Bearbeitende laden hoch');
      if (page.deleted_at) throw new HttpFail(409, 'rejected', 'Seite liegt im Papierkorb');

      const bytes: Uint8Array = Buffer.isBuffer(req.body) ? req.body : new Uint8Array();
      if (bytes.length === 0) throw new HttpFail(400, 'invalid_request', 'Leere Datei');
      const type = detectImage(bytes);
      if (!type) throw new HttpFail(415, 'unsupported_type', 'Nur Bilder: PNG, JPEG, GIF oder WebP');

      const name = fileName(req.get('x-file-name'), type.ext);
      const id = await tx(res, async (t) => (await t.query<{ id: string }>('SELECT uuidv7() AS id')).rows[0]!.id);
      const key = `t/${auth.tenantId}/files/${id}`;
      await store.put(key, bytes, type.mime);
      try {
        await tx(res, (t) =>
          t.query(
            `INSERT INTO files (id, tenant_id, page_id, uploaded_by, storage_key, file_name, mime, size_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, auth.tenantId, pageId, auth.userId, key, name, type.mime, bytes.length],
          ),
        );
      } catch (err) {
        await store.delete(key).catch(() => undefined);
        throw err;
      }
      res.status(201).json({ id, url: `/api/v1/files/${id}`, name, mime: type.mime, size: bytes.length });
    }),
  );

  router.get(
    '/files/:id',
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const file = await tx(res, async (t) => {
        const { rows } = await t.query<{
          storage_key: string;
          file_name: string;
          mime: string;
          size_bytes: string;
          scan_status: 'pending' | 'clean' | 'infected' | 'error';
        }>(
          `SELECT storage_key, file_name, mime, size_bytes, scan_status FROM files
           WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        );
        return rows[0];
      });
      if (!file) throw new HttpFail(404, 'not_found');
      if (file.scan_status === 'infected') throw new HttpFail(403, 'infected', 'Datei blockiert');
      if (config.FILES_REQUIRE_SCAN && file.scan_status !== 'clean') {
        throw new HttpFail(409, 'scan_pending', 'Datei wird geprüft');
      }
      const object = await store.get(file.storage_key);
      if (!object) throw new HttpFail(404, 'not_found');

      const inline = INLINE_TYPES.has(file.mime);
      res.set({
        'Content-Type': inline ? file.mime : 'application/octet-stream',
        'Content-Length': file.size_bytes,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=3600',
      });
      await pipeline(object.body, res);
    }),
  );

  return router;
}
