// Erkennung fremder Lizenz- und Copyright-Hinweise (pnpm test, auch in der CI).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findNotices } from './check-notices.mjs';

const kinds = (text) => findNotices(text).map((f) => f.kind);

test('typische Kopfkommentare fremder Lizenzen', () => {
  assert.deepEqual(kinds('// SPDX-License-Identifier: MIT'), ['SPDX-Kennung']);
  assert.deepEqual(kinds('/* @license MIT */'), ['@license']);
  assert.deepEqual(kinds('// Copyright (c) 2019 Jane Doe'), ['Copyright']);
  assert.deepEqual(kinds('// (c) 2021 Some Corp'), ['Copyright']);
  assert.deepEqual(kinds(' * Permission is hereby granted, free of charge, to any person'), ['MIT-Text']);
  assert.deepEqual(kinds(' * Redistribution and use in source and binary forms, with or without'), ['BSD-Text']);
  assert.deepEqual(kinds(' * Licensed under the Apache License, Version 2.0 (the "License");'), ['Apache-Text']);
  assert.deepEqual(kinds(' * under the terms of the GNU General Public License version 2'), ['GPL-Text']);
  assert.deepEqual(kinds(' * subject to the terms of the Mozilla Public License, v. 2.0'), ['MPL-Text']);
  assert.deepEqual(kinds(' * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY'), ['Gewährleistungsausschluss']);
});

test('eine Meldung pro Zeile, Zeilennummern ab 1', () => {
  const found = findNotices('const a = 1;\n// Copyright 2020 X. All rights reserved.\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test('eigener Code und Lizenznamen ohne Hinweistext sind kein Fund', () => {
  assert.deepEqual(kinds('// SPDX-License-Identifier: AGPL-3.0-only'), []);
  assert.deepEqual(kinds('// Copyright (C) 2026 Peter Forster'), []);
  assert.deepEqual(kinds("['Apache License 2.0', 'Apache-2.0'],"), []);
  assert.deepEqual(kinds("const ok = ['MIT', 'GPL-3.0-only', 'MPL-2.0'];"), []);
  assert.deepEqual(kinds('// Lizenzprüfung: nur AGPL-verträgliche Lizenzen'), []);
});
