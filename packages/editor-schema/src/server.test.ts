import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, TITLE_TEXT, mentionIds, pageLinkIds } from './index.ts';
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

// Jede Blockart, die die Oberfläche anbietet (M2, E07): übersteht BlockNote-JSON → Yjs → JSON
const LINKED = '019a5b3c-0000-7000-8000-0000000000aa';
const ALL_BLOCKS = [
  { type: 'heading', props: { level: 3 }, content: 'Überschrift' },
  { type: 'bulletListItem', content: 'Punkt' },
  { type: 'numberedListItem', content: 'Erstens' },
  { type: 'checkListItem', props: { checked: true }, content: 'Erledigt' },
  { type: 'toggleListItem', content: 'Aufklappen', children: [{ type: 'paragraph', content: 'Innen' }] },
  { type: 'quote', content: 'Zitat' },
  { type: 'codeBlock', props: { language: 'sql' }, content: 'SELECT 1;' },
  { type: 'divider' },
  {
    type: 'image',
    props: {
      url: '/api/v1/files/019a5b3c-0000-7000-8000-0000000000bb',
      name: 'a.png',
      caption: 'Bild',
      previewWidth: 320,
    },
  },
  { type: 'callout', props: { variant: 'warning' }, content: 'Achtung' },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Siehe ', styles: {} },
      { type: 'pageLink', props: { pageId: LINKED } },
    ],
  },
  {
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [{ cells: [[{ type: 'text', text: 'A', styles: {} }], [{ type: 'pageLink', props: { pageId: LINKED } }]] }],
    },
  },
];

test('Alle Blockarten überstehen den Rundlauf über Yjs', () => {
  const { blocks, plainText } = deriveContent(initialYDocState(ALL_BLOCKS, 'Alles'));
  assert.deepEqual(
    blocks.map((b) => b.type),
    ALL_BLOCKS.map((b) => b.type),
  );
  const byType = Object.fromEntries(blocks.map((b) => [b.type, b])) as Record<string, (typeof blocks)[number]>;
  assert.equal((byType.heading!.props as { level: number }).level, 3);
  assert.equal((byType.checkListItem!.props as { checked: boolean }).checked, true);
  assert.equal(byType.toggleListItem!.children.length, 1);
  assert.equal((byType.codeBlock!.props as { language: string }).language, 'sql');
  assert.deepEqual(
    (({ url, name, caption, previewWidth }) => ({ url, name, caption, previewWidth }))(
      byType.image!.props as { url: string; name: string; caption: string; previewWidth: number },
    ),
    { url: '/api/v1/files/019a5b3c-0000-7000-8000-0000000000bb', name: 'a.png', caption: 'Bild', previewWidth: 320 },
  );
  assert.equal((byType.callout!.props as { variant: string }).variant, 'warning');
  const link = (byType.paragraph!.content as { type: string; props?: { pageId: string } }[])[1];
  assert.deepEqual(link, { type: 'pageLink', props: { pageId: LINKED }, content: undefined });
  assert.deepEqual(pageLinkIds(blocks), [LINKED]);
  // Klartext: Seitenlinks ohne Titel (der steht nicht im Dokument), Callouts mit Text
  assert.match(plainText, /^Achtung$/m);
  assert.match(plainText, /^SELECT 1;$/m);
});

test('Datei-, Video- und Audio-Blöcke gibt es nicht (Anhänge erst mit dem Virenscan, M3)', () => {
  for (const type of ['file', 'video', 'audio']) {
    assert.throws(() => initialYDocState([{ type, props: { url: 'x' } }], 'x'), Error, type);
  }
});

test('Erwähnung und Inhaltsverzeichnis überstehen den Rundlauf; im Klartext steht kein Name', () => {
  const user = '019a5b3c-0000-7000-8000-0000000000cc';
  const { blocks, plainText } = deriveContent(
    initialYDocState(
      [
        { type: 'toc' },
        { type: 'heading', props: { level: 2 }, content: 'Ziele' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Frage an ', styles: {} },
            { type: 'mention', props: { userId: user } },
          ],
        },
      ],
      'Mit Erwähnung',
    ),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['toc', 'heading', 'paragraph'],
  );
  const mention = (blocks[2]!.content as { type: string; props?: { userId: string } }[])[1];
  assert.deepEqual(mention, { type: 'mention', props: { userId: user }, content: undefined });
  assert.deepEqual(mentionIds(blocks), [user]);
  assert.equal(plainText, 'Ziele\nFrage an ');
});
