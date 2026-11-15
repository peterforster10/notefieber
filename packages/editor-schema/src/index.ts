// Das Editor-Schema für Browser, Worker, Collab-Server und Import (ARCHITECTURE_REVIEW.md, A-05):
// Alle wandeln mit genau diesen Blöcken um, sonst gingen Inhalte beim Umwandeln verloren.
// Dazu der Aufbau des Yjs-Dokuments einer Seite (CLAUDE.md, Abschnitt 7):
//   Name           page:<uuid>
//   Y.XmlFragment  CONTENT_FRAGMENT: der BlockNote-Inhalt
//   Y.Text         TITLE_TEXT: der Titel (pages.title ist die Kopie, app.store_ydoc)
// Eigene Blöcke (z. B. Platzhalter für Confluence-Makros) kommen hier dazu, nie nur im Browser.
import { BlockNoteSchema } from '@blocknote/core';
import type { Block } from '@blocknote/core';

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
