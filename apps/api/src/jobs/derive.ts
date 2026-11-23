// Abgeleiteter Inhalt (CLAUDE.md, Abschnitt 6, Schritt 6; ARCHITECTURE_REVIEW.md, A-04 und A-05).
// Der Collab-Server speichert nur den Yjs-Zustand (app.store_ydoc) und markiert die Seite als
// veraltet. Ruht sie, leitet der Worker BlockNote-JSON und Klartext ab (app.store_derived; die
// Datenbank pflegt dabei page_search und meldet page.updated). Seiten, die nur BlockNote-JSON haben
// (Testdaten, später der Import), bekommen hier ihren ersten Yjs-Zustand (app.store_initial_ydoc),
// damit der Collab-Server beim Öffnen nicht selbst umwandeln muss. Beim Ableiten pflegt er auch
// die Verlinkungen (page_links) aus den Seitenlinks im Inhalt.
// Polling statt Queue (entschieden für M1): app.pages_to_derive sieht alle Mandanten, gibt aber nur
// IDs heraus; gelesen und geschrieben wird danach im Mandanten der Seite. pg-boss kommt mit M2.
import type pg from 'pg';
import { pageLinkIds } from '@notefieber/editor-schema';
import { deriveContent, initialYDocState } from '@notefieber/editor-schema/server';
import { withContext } from '../db.ts';

export interface DeriveOptions {
  /** So lange muss eine Seite ruhen, bevor sie abgeleitet wird (Sekunden, CLAUDE.md: ca. 30 s) */
  restSeconds: number;
  /** Höchstens so viele Seiten jeder Art pro Durchlauf */
  batch: number;
}

/** derived: abgeleitet; initial: erster Yjs-Zustand; changed: inzwischen weiterbearbeitet bzw. schon erledigt */
export type DeriveResult = 'derived' | 'initial' | 'changed';

export interface DeriveSummary {
  derived: number;
  initial: number;
  changed: number;
  failed: number;
  /** true, wenn eine der Listen voll war: gleich noch einmal laufen */
  more: boolean;
}

/**
 * Eine veraltete Seite ableiten, aus dem Yjs-Zustand mit dem Stand `seen` (page_contents.updated_at
 * als Text, mit Mikrosekunden; ein JS-Date würde sie abschneiden und nie mehr passen).
 */
export async function derivePage(db: pg.Pool, tenantId: string, pageId: string, seen: string): Promise<DeriveResult> {
  return withContext(db, { tenantId }, async (c) => {
    const r = await c.query<{ ydoc: Buffer }>(
      'SELECT ydoc FROM page_contents WHERE page_id = $1 AND derived_stale AND updated_at = $2::timestamptz',
      [pageId, seen],
    );
    const row = r.rows[0];
    if (!row) return 'changed';
    const { blocks, plainText } = deriveContent(row.ydoc);
    const s = await c.query<{ ok: boolean }>('SELECT app.store_derived($1, $2::timestamptz, $3::jsonb, $4) AS ok', [
      pageId,
      seen,
      JSON.stringify(blocks),
      plainText,
    ]);
    if (!s.rows[0]?.ok) return 'changed';
    // Verlinkungen für Rückverweise (E06) in derselben Transaktion; Ziele in anderen Mandanten
    // oder unbekannte IDs lässt app.replace_page_links weg
    await c.query('SELECT app.replace_page_links($1, $2::uuid[])', [pageId, pageLinkIds(blocks)]);
    return 'derived';
  });
}

/** Ersten Yjs-Zustand aus dem BlockNote-JSON einer Seite bauen (Testdaten, Import) */
export async function initialYDoc(db: pg.Pool, tenantId: string, pageId: string): Promise<DeriveResult> {
  return withContext(db, { tenantId }, async (c) => {
    const r = await c.query<{ content_json: unknown[] | null; title: string }>(
      `SELECT c.content_json, p.title FROM page_contents c JOIN pages p ON p.id = c.page_id
       WHERE c.page_id = $1 AND c.ydoc = '\\x0000'::bytea`,
      [pageId],
    );
    const row = r.rows[0];
    if (!row || !Array.isArray(row.content_json) || row.content_json.length === 0) return 'changed';
    const state = initialYDocState(row.content_json, row.title);
    const s = await c.query<{ ok: boolean }>('SELECT app.store_initial_ydoc($1, $2) AS ok', [
      pageId,
      Buffer.from(state),
    ]);
    return s.rows[0]?.ok ? 'initial' : 'changed';
  });
}

/** Ein Durchlauf: alle Seiten, die gerade Arbeit haben (höchstens `batch` je Art) */
export async function deriveOnce(db: pg.Pool, opts: DeriveOptions): Promise<DeriveSummary> {
  const { rows } = await db.query<{ tenant_id: string; page_id: string; seen: string; needs_ydoc: boolean }>(
    `SELECT tenant_id, page_id, updated_at::text AS seen, needs_ydoc
     FROM app.pages_to_derive(make_interval(secs => $1), $2)`,
    [opts.restSeconds, opts.batch],
  );
  const summary: DeriveSummary = {
    derived: 0,
    initial: 0,
    changed: 0,
    failed: 0,
    more:
      rows.filter((r) => r.needs_ydoc).length >= opts.batch || rows.filter((r) => !r.needs_ydoc).length >= opts.batch,
  };
  for (const row of rows) {
    try {
      const result = row.needs_ydoc
        ? await initialYDoc(db, row.tenant_id, row.page_id)
        : await derivePage(db, row.tenant_id, row.page_id, row.seen);
      summary[result]++;
    } catch (err) {
      // Eine kaputte Seite hält die anderen nicht auf; sie bleibt veraltet und kommt wieder
      summary.failed++;
      console.error(`Worker: Seite ${row.page_id} nicht abgeleitet:`, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
