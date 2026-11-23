// Auswertung der SPDX-Ausdrücke in der Lizenzprüfung (pnpm test, auch in der CI).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowed, isPackageException } from './check-licenses.mjs';

test('einzelne Lizenzen: Freigabeliste und Aliase', () => {
  for (const id of ['MIT', 'Apache-2.0', 'MPL-2.0', 'AGPL-3.0-only', 'GPL-3.0', 'Apache License 2.0', 'Apache 2.0']) {
    assert.equal(isAllowed(id), true, id);
  }
  for (const id of [
    'GPL-2.0-only',
    'SSPL-1.0',
    'BUSL-1.1',
    'Elastic-2.0',
    'CC-BY-NC-4.0',
    'Unknown',
    'UNLICENSED',
    '',
  ]) {
    assert.equal(isAllowed(id), false, id);
  }
});

test('OR: eine erlaubte Alternative genügt; AND: alle müssen erlaubt sein', () => {
  assert.equal(isAllowed('(MIT OR CC0-1.0)'), true);
  assert.equal(isAllowed('GPL-2.0-only OR MIT'), true);
  assert.equal(isAllowed('Apache-2.0 AND LGPL-3.0-or-later'), true);
  assert.equal(isAllowed('MIT AND GPL-2.0-only'), false);
});

test('Klammern bestimmen die Rangfolge, AND bindet stärker als OR', () => {
  // Hier muss GPL-2.0-only immer mit dabei sein: unverträglich, auch wenn Apache-2.0 erlaubt ist
  assert.equal(isAllowed('GPL-2.0-only AND (MIT OR Apache-2.0)'), false);
  assert.equal(isAllowed('(MIT OR Apache-2.0) AND GPL-2.0-only'), false);
  // Ohne Klammern: (GPL-2.0-only AND MIT) OR Apache-2.0, also erlaubt über Apache-2.0
  assert.equal(isAllowed('GPL-2.0-only AND MIT OR Apache-2.0'), true);
  assert.equal(isAllowed('((MIT))'), true);
  assert.equal(isAllowed('(MIT AND (ISC OR SSPL-1.0)) OR BUSL-1.1'), true);
  assert.equal(isAllowed('(MIT AND (SSPL-1.0 OR BUSL-1.1)) OR Elastic-2.0'), false);
  // Schlüsselwörter unabhängig von Groß- und Kleinschreibung, auch direkt an Klammern
  assert.equal(isAllowed('(MIT or Apache-2.0)and ISC'), true);
});

test('WITH zählt als eigene Lizenz; kaputte Ausdrücke sind nie erlaubt', () => {
  assert.equal(isAllowed('GPL-2.0-only WITH Classpath-exception-2.0'), false);
  assert.equal(isAllowed('MIT WITH Foo-exception OR ISC'), true);
  for (const broken of ['(MIT', 'MIT)', 'MIT AND', 'OR MIT', 'MIT OR OR ISC', '()', 'MIT WITH']) {
    assert.equal(isAllowed(broken), false, broken);
  }
});

test('CC-BY-4.0 nur als Ausnahme für caniuse-lite, und nur mit genau dieser Lizenz', () => {
  assert.equal(isAllowed('CC-BY-4.0'), false);
  assert.equal(isPackageException('caniuse-lite', 'CC-BY-4.0'), true);
  assert.equal(isPackageException('caniuse-lite', 'SSPL-1.0'), false);
  assert.equal(isPackageException('irgendwas', 'CC-BY-4.0'), false);
});
