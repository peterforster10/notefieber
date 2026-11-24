import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BlockNoteSchema } from '@blocknote/core';
import { blockSpecs, blocksToPlainText, documentName, pageIdFromDocument, schema, setTitle } from './index.ts';

const ID = '01a1bc1b-c003-7b51-b4d7-a9701a1a81d2';

test('Dokumentname: page:<uuid>, umkehrbar, sonst undefined', () => {
  assert.equal(documentName(ID), `page:${ID}`);
  assert.equal(documentName(ID.toUpperCase()), `page:${ID}`);
  assert.equal(pageIdFromDocument(`page:${ID}`), ID);
  for (const name of ['', ID, `page:${ID}x`, `space:${ID}`, 'page:../etc', `page:${ID.toUpperCase()}`]) {
    assert.equal(pageIdFromDocument(name), undefined, name);
  }
});

test('Klartext: eine Zeile pro Block, Links, Kinder, Tabellen, leere Blöcke übersprungen', () => {
  const blocks = [
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Grundsätze', styles: {} }], children: [] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Siehe ', styles: {} },
        {
          type: 'link',
          href: 'https://example.org',
          content: [{ type: 'text', text: 'Doku', styles: { bold: true } }],
        },
        { type: 'text', text: '.', styles: {} },
      ],
      children: [{ type: 'bulletListItem', content: [{ type: 'text', text: 'Unterpunkt', styles: {} }], children: [] }],
    },
    { type: 'paragraph', content: [], children: [] },
    { type: 'image', props: { url: 'x' }, children: [] },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              { type: 'tableCell', content: [{ type: 'text', text: 'A', styles: {} }] },
              [{ type: 'text', text: 'B', styles: {} }],
            ],
          },
          {
            cells: [
              { type: 'tableCell', content: [] },
              { type: 'tableCell', content: [{ type: 'text', text: 'D', styles: {} }] },
            ],
          },
        ],
      },
      children: [],
    },
    null,
    'kaputt',
  ];
  assert.equal(blocksToPlainText(blocks), 'Grundsätze\nSiehe Doku.\nUnterpunkt\nA\tB\n\tD');
  assert.equal(blocksToPlainText([]), '');
});

test('setTitle: kleinste Änderung, gleichzeitiges Tippen bleibt erhalten, gekürzt auf 255', async () => {
  const Y = await import('yjs');
  // A benennt um (Server), B tippt gleichzeitig hinten weiter (Browser). Die Reihenfolge darf
  // nicht von den zufälligen Client-IDs abhängen, deshalb viele Durchläufe mit neuen Dokumenten.
  for (let i = 0; i < 100; i++) {
    const x = new Y.Doc();
    const y = new Y.Doc();
    x.getText('title').insert(0, 'Release-Prozess');
    Y.applyUpdate(y, Y.encodeStateAsUpdate(x));
    setTitle(x.getText('title'), 'Release-Ablauf');
    y.getText('title').insert(y.getText('title').length, ' 2027');
    Y.applyUpdate(x, Y.encodeStateAsUpdate(y));
    Y.applyUpdate(y, Y.encodeStateAsUpdate(x));
    assert.equal(x.getText('title').toString(), 'Release-Ablauf 2027', `Durchlauf ${i}`);
    assert.equal(y.getText('title').toString(), x.getText('title').toString());
  }

  const a = new Y.Doc();
  a.getText('title').insert(0, 'Release-Prozess');

  setTitle(a.getText('title'), 'T'.repeat(300));
  assert.equal(a.getText('title').length, 255);
  const before = Y.encodeStateVector(a);
  setTitle(a.getText('title'), 'T'.repeat(255));
  assert.deepEqual(Y.encodeStateVector(a), before, 'gleicher Titel ändert nichts');
});

test('pageLinkIds: aus Absätzen, Links, Tabellen und Kindern, ohne Doppelte und ungültige IDs', async () => {
  const { pageLinkIds } = await import('./index.ts');
  const a = '019a5b3c-0000-7000-8000-00000000000a';
  const b = '019a5b3c-0000-7000-8000-00000000000b';
  const link = (pageId: string) => ({ type: 'pageLink', props: { pageId } });
  const blocks = [
    { type: 'paragraph', content: [link(a), link(a.toUpperCase()), link('kaputt'), link('')], children: [] },
    {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', content: [link(b)] }, [link(a)]] }] },
    },
    {
      type: 'callout',
      content: [],
      children: [{ type: 'paragraph', content: [{ type: 'link', content: [link(b)] }] }],
    },
    null,
  ];
  assert.deepEqual(pageLinkIds(blocks).sort(), [a, b]);
  assert.deepEqual(pageLinkIds([]), []);
});

test('mentionIds: Personen aus Erwähnungen, getrennt von Seitenlinks', async () => {
  const { mentionIds, pageLinkIds } = await import('./index.ts');
  const p = '019a5b3c-0000-7000-8000-0000000000aa';
  const u = '019a5b3c-0000-7000-8000-0000000000bb';
  const blocks = [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', props: { userId: u } },
        { type: 'mention', props: { userId: 'kaputt' } },
        { type: 'pageLink', props: { pageId: p } },
      ],
    },
    {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [[{ type: 'mention', props: { userId: u } }]] }] },
    },
  ];
  assert.deepEqual(mentionIds(blocks), [u]);
  assert.deepEqual(pageLinkIds(blocks), [p]);
});

test('Tastatur-Regeln bleiben, wenn der Browser aus blockSpecs ein eigenes Schema baut', () => {
  // BlockNote verarbeitet experimental_keyboard beim Erzeugen eines Schemas; ein zweites create aus
  // schema.blockSpecs verlor sie: Enter am Ende eines Listenpunkts gab einen Absatz statt eines Punkts
  const browser = BlockNoteSchema.create({ blockSpecs: { ...blockSpecs } });
  type Keyboard = { splitKeepsType: boolean; enter: string };
  const kb = (s: { blockSpecs: unknown }, type: string) =>
    (s.blockSpecs as Record<string, { implementation: { keyboard: (b: unknown) => Keyboard } }>)[
      type
    ]!.implementation.keyboard({ type, props: {}, content: [], children: [] });
  for (const type of ['bulletListItem', 'numberedListItem', 'checkListItem']) {
    assert.equal(kb(browser, type).splitKeepsType, true, type);
    assert.equal(kb(schema, type).splitKeepsType, true, type);
  }
  assert.equal(kb(browser, 'paragraph').splitKeepsType, false);
  assert.equal(kb(browser, 'codeBlock').enter, kb(schema, 'codeBlock').enter, 'Enter im Code-Block');
});
