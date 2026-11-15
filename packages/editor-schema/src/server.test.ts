import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, TITLE_TEXT } from './index.ts';
import { deriveContent, fillYDoc, initialYDocState } from './server.ts';

// So sehen die Seiten aus seed.sql aus (pg_temp.doc): unvollständige Eigenschaften, eigene IDs
const SEED = [
  {
    id: '019a5b3c-0000-7000-8000-000000000001',
    type: 'heading',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left', level: 2 },
    content: [{ type: 'text', text: 'Grundsätze', styles: {} }],
    children: [],
  },
  {
    id: '019a5b3c-0000-7000-8000-000000000002',
    type: 'paragraph',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: 'Jede Tabelle trägt tenant_id.', styles: {} }],
    children: [],
  },
];

test('Testdaten → Yjs → BlockNote-JSON: Inhalt, IDs und Titel bleiben', () => {
  const state = initialYDocState(SEED, 'Datenmodell');
  const { blocks, plainText, title } = deriveContent(state);
  assert.equal(title, 'Datenmodell');
  assert.equal(plainText, 'Grundsätze\nJede Tabelle trägt tenant_id.');
  assert.deepEqual(
    blocks.map((b) => [b.id, b.type]),
    SEED.map((b) => [b.id, b.type]),
  );
  assert.equal((blocks[0]?.props as { level?: number }).level, 2);
});

test('Ohne IDs (Import): der Editor vergibt welche', () => {
  const { blocks } = deriveContent(
    initialYDocState([{ type: 'paragraph', content: [{ type: 'text', text: 'ohne ID', styles: {} }] }], 'x'),
  );
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0]?.id);
});

test('fillYDoc füllt nur Leeres: getippter Titel und vorhandener Inhalt bleiben', () => {
  const doc = new Y.Doc();
  doc.getText(TITLE_TEXT).insert(0, 'Schon getippt');
  fillYDoc(doc, SEED, 'Aus pages.title');
  assert.equal(doc.getText(TITLE_TEXT).toString(), 'Schon getippt');
  const before = Y.encodeStateAsUpdate(doc);
  fillYDoc(doc, [{ type: 'paragraph', content: 'anders' }], 'nochmal');
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.equal(doc.getXmlFragment(CONTENT_FRAGMENT).length, 1); // ein blockGroup mit zwei Blöcken
});

test('Leere Seite: nur der Titel, gekürzt auf 255 Zeichen; leerer Zustand ergibt keine Blöcke', () => {
  const { blocks, title } = deriveContent(initialYDocState([], 'T'.repeat(300)));
  assert.equal(title.length, 255);
  assert.equal(blocks.length, 0);
  assert.deepEqual(deriveContent(Uint8Array.of(0, 0)), { blocks: [], plainText: '', title: '' });
});
