// Das Editor-Schema für Browser, Worker, Collab-Server und Import (ARCHITECTURE_REVIEW.md, A-05):
// Alle wandeln mit genau diesen Blöcken um, sonst gingen Inhalte beim Umwandeln verloren.
// Dazu der Aufbau des Yjs-Dokuments einer Seite (CLAUDE.md, Abschnitt 7):
//   Name           page:<uuid>
//   Y.XmlFragment  CONTENT_FRAGMENT: der BlockNote-Inhalt
//   Y.Text         TITLE_TEXT: der Titel (pages.title ist die Kopie, app.store_ydoc)
// Eigene Blöcke (z. B. Platzhalter für Confluence-Makros) kommen hier dazu, nie nur im Browser.
//
// Blöcke (M2, E07): alle Standardblöcke von BlockNote außer file, video und audio (Anhänge kommen
// mit dem Virenscan in M3; Blöcke hinzufügen ist rückwärtskompatibel, wegnehmen nicht), dazu
//   callout   Kasten mit Variante (wie die Confluence-Panels Info, Hinweis, Erfolg, Warnung, Fehler)
//   pageLink  Link auf eine Seite, Inline-Inhalt nur mit der Seiten-ID: Der Titel steht nicht im
//             Dokument, er ändert sich, und wer die Zielseite nicht lesen darf, soll ihn nicht sehen.
//             Den aktuellen Titel holt die Oberfläche über die API (POST /pages/lookup).
//   mention   Erwähnung einer Person, Inline-Inhalt nur mit der Personen-ID (wie pageLink: der Name
//             ändert sich, und wer die Person nicht sehen darf, etwa ein Gast, soll ihn nicht lesen).
//             Den Namen holt die Oberfläche über POST /people/lookup; Benachrichtigungen folgen (E16).
//   toc       Inhaltsverzeichnis ohne eigenen Inhalt: Die Oberfläche baut es beim Anzeigen aus den
//             Überschriften der Seite, im Dokument steht nur der Block (wie das Confluence-Makro).
// Die Darstellung hier ist schlicht (DOM ohne React) und dient Worker, Import und Export. Der
// Browser setzt dieselben Configs (calloutConfig, pageLinkConfig, mentionConfig, tocConfig) mit eigener React-Darstellung ein
// (apps/web/src/components/editor/schema.tsx), damit die Eigenschaften nie auseinanderlaufen.
import {
  BlockNoteSchema,
  createBlockSpec,
  createCodeBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
} from '@blocknote/core';
import type { Block } from '@blocknote/core';
import type * as Y from 'yjs';

/** Varianten eines Callouts, in der Reihenfolge des Menüs */
export const CALLOUT_VARIANTS = ['info', 'note', 'success', 'warning', 'error'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const calloutConfig = {
  type: 'callout',
  propSchema: {
    textColor: defaultProps.textColor,
    variant: { default: 'info', values: CALLOUT_VARIANTS },
  },
  content: 'inline',
} as const;

export const pageLinkConfig = {
  type: 'pageLink',
  propSchema: { pageId: { default: '' } },
  content: 'none',
} as const;

export const mentionConfig = {
  type: 'mention',
  propSchema: { userId: { default: '' } },
  content: 'none',
} as const;

export const tocConfig = {
  type: 'toc',
  propSchema: {},
  content: 'none',
} as const;

/**
 * Sprachen des Code-Blocks (Eigenschaft language). Die Schlüssel sind die Namen von Shiki, damit
 * die Hervorhebung im Browser (@blocknote/code-block) sie erkennt; sie ist reine Darstellung und
 * ändert das Schema nicht.
 */
export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: 'Text', aliases: ['plain', 'txt'] },
  shellscript: { name: 'Shell', aliases: ['bash', 'sh', 'shell'] },
  c: { name: 'C' },
  cpp: { name: 'C++' },
  csharp: { name: 'C#', aliases: ['cs'] },
  css: { name: 'CSS' },
  html: { name: 'HTML' },
  java: { name: 'Java' },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  json: { name: 'JSON' },
  kotlin: { name: 'Kotlin', aliases: ['kt'] },
  markdown: { name: 'Markdown', aliases: ['md'] },
  php: { name: 'PHP' },
  python: { name: 'Python', aliases: ['py'] },
  rust: { name: 'Rust', aliases: ['rs'] },
  sql: { name: 'SQL' },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  xml: { name: 'XML' },
  yaml: { name: 'YAML', aliases: ['yml'] },
};

// Ohne DOM-Typen (das Paket läuft auch im Worker): Gerendert wird nur im Browser; Worker und
// Import wandeln nur um und rufen render nie auf. Zurück geht das Element als never, weil der Typ
// HTMLElement hier fehlt, im Browser (apps/web, mit DOM-Typen) aber verlangt wird.
interface MiniElement {
  className: string;
  dataset: Record<string, string | undefined>;
  appendChild(child: MiniElement): MiniElement;
}
function element(tag: string): MiniElement {
  return (globalThis as unknown as { document: { createElement(tag: string): MiniElement } }).document.createElement(
    tag,
  );
}

const calloutSpec = createBlockSpec(calloutConfig, {
  render: (block) => {
    const dom = element('div');
    dom.className = 'nf-callout';
    dom.dataset.variant = block.props.variant;
    const contentDOM = element('div');
    dom.appendChild(contentDOM);
    return { dom: dom as never, contentDOM: contentDOM as never };
  },
  parse: (el) =>
    el.classList.contains('nf-callout')
      ? {
          variant: (CALLOUT_VARIANTS as readonly string[]).includes(el.dataset.variant ?? '')
            ? (el.dataset.variant as CalloutVariant)
            : 'info',
        }
      : undefined,
});

const pageLinkSpec = createInlineContentSpec(pageLinkConfig, {
  render: (content) => {
    const dom = element('a');
    dom.className = 'nf-page-link';
    dom.dataset.pageId = content.props.pageId;
    return { dom: dom as never };
  },
  parse: (el) =>
    el.classList.contains('nf-page-link') && el.dataset.pageId ? { pageId: el.dataset.pageId } : undefined,
});

const mentionSpec = createInlineContentSpec(mentionConfig, {
  render: (content) => {
    const dom = element('span');
    dom.className = 'nf-mention';
    dom.dataset.userId = content.props.userId;
    return { dom: dom as never };
  },
  parse: (el) => (el.classList.contains('nf-mention') && el.dataset.userId ? { userId: el.dataset.userId } : undefined),
});

const tocSpec = createBlockSpec(tocConfig, {
  render: () => {
    const dom = element('nav');
    dom.className = 'nf-toc';
    return { dom: dom as never };
  },
  parse: (el) => (el.classList.contains('nf-toc') ? {} : undefined),
});

const { file: _file, video: _video, audio: _audio, ...standardBlockSpecs } = defaultBlockSpecs;

/**
 * Die Blöcke vor BlockNoteSchema.create. Wer ein eigenes Schema baut (der Browser mit React-Darstellung,
 * apps/web/src/components/editor/schema.tsx), nimmt diese, nicht schema.blockSpecs: BlockNote
 * verarbeitet die Tastatur-Regeln (experimental_keyboard) beim Erzeugen, ein zweites create aus
 * schema.blockSpecs verliert sie. Dann gab Enter in einer Liste einen Absatz statt eines neuen Punkts.
 */
export const blockSpecs = {
  ...standardBlockSpecs,
  codeBlock: createCodeBlockSpec({ defaultLanguage: 'text', supportedLanguages: CODE_LANGUAGES }),
  callout: calloutSpec(),
  toc: tocSpec(),
};
export const inlineContentSpecs = { ...defaultInlineContentSpecs, pageLink: pageLinkSpec, mention: mentionSpec };

export const schema = BlockNoteSchema.create({ blockSpecs, inlineContentSpecs });
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IDs aus einem Inline-Inhalt (z. B. pageLink.pageId) überall im Dokument: in Absätzen, Links,
 * Tabellen und Kindblöcken, ohne Doppelte, nur gültige UUIDs, klein geschrieben.
 */
function inlineIds(blocks: readonly Json[], type: string, prop: string): string[] {
  const ids = new Set<string>();
  const inline = (content: Json): void => {
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const node = item as { type?: unknown; props?: Record<string, unknown>; content?: unknown };
      const id = node.props?.[prop];
      if (node.type === type && typeof id === 'string' && UUID.test(id)) ids.add(id.toLowerCase());
      inline(node.content);
    }
  };
  const walk = (list: readonly Json[]): void => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const block = item as { content?: unknown; children?: unknown };
      const content = block.content;
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        const rows = (content as { rows?: unknown }).rows;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const cells = row && typeof row === 'object' ? (row as { cells?: unknown }).cells : undefined;
            if (!Array.isArray(cells)) continue;
            for (const cell of cells) {
              inline(
                cell && typeof cell === 'object' && !Array.isArray(cell)
                  ? (cell as { content?: unknown }).content
                  : cell,
              );
            }
          }
        }
      } else {
        inline(content);
      }
      if (Array.isArray(block.children)) walk(block.children);
    }
  };
  walk(blocks);
  return [...ids];
}

/** IDs aller Seiten, auf die ein Dokument verlinkt (pageLink); für page_links (Worker) */
export function pageLinkIds(blocks: readonly Json[]): string[] {
  return inlineIds(blocks, 'pageLink', 'pageId');
}

/** IDs aller erwähnten Personen (mention); für Benachrichtigungen (E16) */
export function mentionIds(blocks: readonly Json[]): string[] {
  return inlineIds(blocks, 'mention', 'userId');
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
