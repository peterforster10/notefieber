import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocksToPlainText, documentName, pageIdFromDocument } from './index.ts';

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
