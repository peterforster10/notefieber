// Umwandlung Yjs ↔ BlockNote-JSON außerhalb des Browsers: Worker (abgeleiteter Inhalt, erster
// Yjs-Zustand aus Testdaten und Import) und Collab-Server (nur als Rückfall beim Öffnen).
// Ein Editor ohne Oberfläche mit dem gemeinsamen Schema reicht, kein jsdom und kein React
// (anders als @blocknote/server-util, das wir deshalb nicht brauchen).
import { BlockNoteEditor } from '@blocknote/core';
import type { PartialBlock } from '@blocknote/core';
import { blocksToYXmlFragment, yDocToBlocks } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, TITLE_MAX_LENGTH, TITLE_TEXT, blocksToPlainText, schema } from './index.ts';
import type { EditorBlock, EditorSchema } from './index.ts';

type Editor = BlockNoteEditor<EditorSchema['blockSchema'], EditorSchema['inlineContentSchema'], EditorSchema['styleSchema']>;
type EditorPartialBlock = PartialBlock<
  EditorSchema['blockSchema'],
  EditorSchema['inlineContentSchema'],
  EditorSchema['styleSchema']
>;

let editor: Editor | undefined;
function headless(): Editor {
  editor ??= BlockNoteEditor.create({ schema });
  return editor;
}

/** Abgeleiteter Inhalt aus einem gespeicherten Yjs-Zustand (page_contents.ydoc) */
export function deriveContent(state: Uint8Array): { blocks: EditorBlock[]; plainText: string; title: string } {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const blocks = yDocToBlocks(headless(), doc, CONTENT_FRAGMENT);
    return { blocks, plainText: blocksToPlainText(blocks), title: doc.getText(TITLE_TEXT).toString() };
  } finally {
    doc.destroy();
  }
}

/** Inhalt und Titel in ein (leeres) Yjs-Dokument schreiben, z. B. beim ersten Öffnen einer importierten Seite */
export function fillYDoc(doc: Y.Doc, blocks: readonly unknown[], title: string): void {
  const editor = headless();
  // ENTWURF (nächster Schritt): Teilblöcke aus Testdaten und Import vollständig machen und testen
  const full = blocks as EditorPartialBlock[];
  doc.transact(() => {
    const text = doc.getText(TITLE_TEXT);
    if (text.length === 0 && title) text.insert(0, title.slice(0, TITLE_MAX_LENGTH));
    const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
    if (fragment.length === 0 && full.length > 0) {
      blocksToYXmlFragment(editor, full as EditorBlock[], fragment);
    }
  });
}

/** Erster Yjs-Zustand einer Seite, die nur BlockNote-JSON hat (app.store_initial_ydoc) */
export function initialYDocState(blocks: readonly unknown[], title: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    fillYDoc(doc, blocks, title);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
