import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PositionError, positionFor } from './positions.ts';

const siblings = [
  { id: 'c', position: 'a2' },
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
];

test('ans Ende, wenn nichts angegeben ist', () => {
  assert.equal(positionFor(siblings, {}), 'a3');
  assert.equal(positionFor([], {}), 'a0');
});

test('zwischen zwei Geschwister', () => {
  const p = positionFor(siblings, { afterId: 'a' });
  assert.ok(p > 'a0' && p < 'a1', p);
  const q = positionFor(siblings, { beforeId: 'a' });
  assert.ok(q < 'a0', q);
  assert.equal(positionFor(siblings, { afterId: 'c' }), 'a3');
});

test('gleiche Positionen (eingeschränkte Geschwister): dahinter statt dazwischen', () => {
  const dup = [
    { id: 'x', position: 'a1' },
    { id: 'y', position: 'a1' },
  ];
  assert.equal(positionFor(dup, { afterId: 'x' }), 'a2');
});

test('unbekannte Nachbarn werden abgelehnt', () => {
  assert.throws(() => positionFor(siblings, { afterId: 'gibtsnicht' }), PositionError);
  assert.throws(() => positionFor(siblings, { beforeId: 'gibtsnicht' }), PositionError);
});
