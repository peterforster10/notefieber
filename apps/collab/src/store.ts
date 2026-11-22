// Laden und Speichern der Yjs-Dokumente (CLAUDE.md, Abschnitt 6, Schritte 3 und 5).
// Laden: page_contents.ydoc. Ist es noch der leere Anfangszustand, baut der Collab-Server einen
// ersten Zustand: pages.title in Y.Text "title" (sonst leert das erste Speichern den Titel) und,
// wenn die Seite schon BlockNote-JSON hat (Testdaten, Import) und der Worker noch nicht da war,
// den Inhalt daraus. Diesen Zustand sichert er sofort (app.store_initial_ydoc), nicht erst beim
// nächsten Speichern: Sonst fügte jedes Laden den Titel neu ein, und ein Browser mit dem alten
// Stand (lokale Kopie, offener Tab nach einem Neustart) verdoppelte ihn (REVIEW_M1.md, R-19).
// Speichern: nur Yjs-Zustand, Titel und Bearbeitende (app.store_ydoc); BlockNote-JSON und
// Klartext leitet der Worker ab, wenn die Seite ruht.
import type pg from 'pg';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, EMPTY_YDOC, TITLE_MAX_LENGTH, TITLE_TEXT } from '@notefieber/editor-schema';
import { withTenant } from './db.ts';

export interface DocumentInfo {
  tenantId: string;
  spaceId: string;
  pageId: string;
}

function isEmptyState(state: Uint8Array): boolean {
  return state.length === EMPTY_YDOC.length && state.every((b, i) => b === EMPTY_YDOC[i]);
}

/** Gespeicherten Stand in doc laden (doc ist noch leer und an keine Verbindung gebunden). */
export async function loadDocument(db: pg.Pool, info: DocumentInfo, doc: Y.Doc): Promise<void> {
  const row = await withTenant(db, info.tenantId, async (client) => {
    const r = await client.query<{ ydoc: Buffer; content_json: unknown[] | null; title: string }>(
      `SELECT c.ydoc, c.content_json, p.title
       FROM page_contents c JOIN pages p ON p.id = c.page_id WHERE c.page_id = $1`,
      [info.pageId],
    );
    return r.rows[0];
  });
  if (!row) throw new Error(`Collab-Server: Inhalt der Seite ${info.pageId} fehlt`);

  if (!isEmptyState(row.ydoc)) {
    Y.applyUpdate(doc, row.ydoc);
  } else {
    Y.applyUpdate(doc, await storeInitial(db, info, await initialState(row.content_json, row.title)));
  }
  doc.getXmlFragment(CONTENT_FRAGMENT); // Fragment anlegen, damit alle denselben Typ sehen
}

/** Erster Yjs-Zustand einer Seite, die noch den leeren Anfangszustand hat */
async function initialState(contentJson: unknown[] | null, title: string): Promise<Uint8Array> {
  if (Array.isArray(contentJson) && contentJson.length > 0) {
    // Rückfall: Der Worker baut den Yjs-Zustand sonst vorher (app.pages_to_derive). Erst hier
    // geladen, damit der Collab-Server den Editor ohne Oberfläche nur in diesem Fall braucht.
    const { initialYDocState } = await import('@notefieber/editor-schema/server');
    return initialYDocState(contentJson, title);
  }
  // Neue, leere Seite: nur der Titel
  const doc = new Y.Doc();
  try {
    if (title) doc.getText(TITLE_TEXT).insert(0, title.slice(0, TITLE_MAX_LENGTH));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Ersten Zustand sichern (app.store_initial_ydoc, schreibt nur über den leeren Anfangszustand) und
 * zurückgeben, was danach gilt: der eigene Zustand oder, war der Worker gerade schneller, seiner.
 * So gibt es pro Seite genau eine Einfügung des Titels, egal wie oft das Dokument geladen wird.
 */
async function storeInitial(db: pg.Pool, info: DocumentInfo, state: Uint8Array): Promise<Uint8Array> {
  if (isEmptyState(state)) return state; // ohne Titel und Inhalt gibt es nichts zu sichern
  return withTenant(db, info.tenantId, async (client) => {
    const r = await client.query<{ ok: boolean }>('SELECT app.store_initial_ydoc($1, $2) AS ok', [
      info.pageId,
      Buffer.from(state),
    ]);
    if (r.rows[0]?.ok) return state;
    const again = await client.query<{ ydoc: Buffer }>('SELECT ydoc FROM page_contents WHERE page_id = $1', [
      info.pageId,
    ]);
    return again.rows[0]?.ydoc ?? state;
  });
}

/**
 * Yjs-Zustand, Titel und Bearbeitende speichern (app.store_ydoc). Liegt die Seite inzwischen im
 * Papierkorb, lehnt die Datenbank ab; dann gilt der zuletzt gespeicherte Stand (E04-07), das wird
 * nur protokolliert. Jeder andere Fehler geht weiter an Hocuspocus, das das Dokument dann im
 * Speicher behält und beim nächsten Speichern erneut versucht. Gibt die Größe des Yjs-Zustands
 * in Byte zurück (Kennzahl, A-04: Je größer, desto mehr WAL pro Speichern).
 */
export async function storeDocument(db: pg.Pool, info: DocumentInfo, doc: Y.Doc, editors: string[]): Promise<number> {
  const state = Y.encodeStateAsUpdate(doc);
  const title = doc.getText(TITLE_TEXT).toString();
  try {
    await withTenant(db, info.tenantId, (client) =>
      client.query('SELECT app.store_ydoc($1, $2, $3, $4::uuid[])', [info.pageId, Buffer.from(state), title, editors]),
    );
  } catch (err) {
    const trashed = await withTenant(db, info.tenantId, async (client) => {
      const r = await client.query<{ trashed: boolean }>(
        'SELECT deleted_at IS NOT NULL AS trashed FROM pages WHERE id = $1',
        [info.pageId],
      );
      return r.rows[0]?.trashed ?? true;
    }).catch(() => false);
    if (!trashed) throw err;
    console.warn(`Collab-Server: Seite ${info.pageId} liegt im Papierkorb, Änderungen nicht gespeichert`);
  }
  return state.length;
}
