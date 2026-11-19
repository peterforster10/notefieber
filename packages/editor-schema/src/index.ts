// Das Editor-Schema für Browser, Worker, Collab-Server und Import (ARCHITECTURE_REVIEW.md, A-05):
// Alle wandeln mit genau diesen Blöcken um, sonst gingen Inhalte beim Umwandeln verloren.
// Dazu der Aufbau des Yjs-Dokuments einer Seite (CLAUDE.md, Abschnitt 7):
//   Name           page:<uuid>
//   Y.XmlFragment  CONTENT_FRAGMENT: der BlockNote-Inhalt
//   Y.Text         TITLE_TEXT: der Titel (pages.title ist die Kopie, app.store_ydoc)
// Eigene Blöcke (z. B. Platzhalter für Confluence-Makros) kommen hier dazu, nie nur im Browser.
import { BlockNoteSchema } from '@blocknote/core';
import type { Block } from '@blocknote/core';
import type * as Y from 'yjs';

export const schema = BlockNoteSchema.create();
export type EditorSchema = typeof schema;
export type EditorBlock = Block<
  EditorSchema['blockSchema'],
  EditorSchema['inlineContentSchema'],
  EditorSchema['styleSchema']
>;

/** Name des Y.XmlFragment mit dem BlockNote-Inhalt */
export const CONTENT_FRAGMENT = 'content';
/** Name des Y.Text mit dem Titel */
export const TITLE_TEXT = 'title';
/** Höchstlänge des Titels; längere kürzt die Datenbank (app.store_ydoc), der Editor schon vorher */
export const TITLE_MAX_LENGTH = 255;
/** Leerer Anfangszustand neuer Seiten in page_contents.ydoc (app.create_page) */
export const EMPTY_YDOC = Uint8Array.of(0, 0);

/**
 * Titel im Y.Text setzen, mit der kleinsten Änderung (gemeinsamer Anfang und gemeinsames Ende
 * bleiben): Tippt jemand gleichzeitig im Titel, gehen seine Zeichen nicht verloren. Für den Editor
 * im Browser und für Änderungen von der Serverseite (Umbenennen aus der Seitenleiste). Kürzt auf
 * TITLE_MAX_LENGTH.
 */
export function setTitle(text: Y.Text, title: string): void {
  const next = title.slice(0, TITLE_MAX_LENGTH);
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  // Erst einfügen, dann löschen: So hängt der neue Text vor dem alten (rechter Nachbar sichtbar),
  // und was jemand gleichzeitig hinter dem alten tippt, landet verlässlich dahinter. Andersherum
  // entschiede bei gleichzeitigem Tippen die zufällige Client-ID über die Reihenfolge.
  const apply = () => {
    const inserted = endNext - start;
    if (inserted > 0) text.insert(start, next.slice(start, endNext));
    if (endPrev > start) text.delete(start + inserted, endPrev - start);
  };
  if (text.doc) text.doc.transact(apply);
  else apply();
}

const DOCUMENT = /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Name des Yjs-Dokuments einer Seite */
export function documentName(pageId: string): string {
  return `page:${pageId.toLowerCase()}`;
}

/** Seiten-ID aus dem Dokumentnamen; undefined, wenn es kein gültiger Name ist */
export function pageIdFromDocument(name: string): string | undefined {
  return DOCUMENT.exec(name)?.[1];
}

// Klartext für Suche und später KI, ohne DOM. Bewusst über die JSON-Struktur statt über die
// Typen des Schemas: Auch unbekannte Blöcke (Import, ältere Fassungen) geben ihren Text her.
type Json = unknown;

function inlineText(content: Json): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item: Json) => {
      if (!item || typeof item !== 'object') return '';
      const node = item as { type?: unknown; text?: unknown; content?: unknown };
      if (typeof node.text === 'string') return node.text;
      return inlineText(node.content);
    })
    .join('');
}

function tableText(content: { rows?: unknown }): string[] {
  if (!Array.isArray(content.rows)) return [];
  return content.rows.map((row: Json) => {
    const cells = row && typeof row === 'object' ? (row as { cells?: unknown }).cells : undefined;
    if (!Array.isArray(cells)) return '';
    return cells
      .map((cell: Json) =>
        cell && typeof cell === 'object' && !Array.isArray(cell)
          ? inlineText((cell as { content?: unknown }).content)
          : inlineText(cell),
      )
      .join('\t');
  });
}

/** Klartext eines BlockNote-Dokuments: eine Zeile pro Block (Tabellen: pro Zeile, Zellen mit Tab) */
export function blocksToPlainText(blocks: readonly Json[]): string {
  const lines: string[] = [];
  const walk = (list: readonly Json[]) => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const block = item as { content?: unknown; children?: unknown };
      const content = block.content;
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        lines.push(...tableText(content as { rows?: unknown }));
      } else {
        const text = inlineText(content);
        if (text) lines.push(text);
      }
      if (Array.isArray(block.children)) walk(block.children);
    }
  };
  walk(blocks);
  return lines.join('\n');
}
