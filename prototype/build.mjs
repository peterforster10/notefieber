#!/usr/bin/env node
// Baut die Prototyp-Seiten aus ihren Teilen (SPDX-License-Identifier: AGPL-3.0-only).
//
//   node prototype/build.mjs           pages/src/Main.html → pages/Main.dc.html
//   node prototype/build.mjs --check   nur prüfen, ob pages/Main.dc.html aktuell ist (Exit-Code 1, wenn nicht)
//
// Eine Zeile, die nur aus einer Einbindung besteht, wird durch den Inhalt der Datei ersetzt
// (Pfad relativ zur einbindenden Datei, Einbindungen dürfen verschachtelt sein):
//   <!-- @include template/sidebar.html -->     in HTML
//   /* @include styles/tokens.css */            in CSS
//   // @include logic/component/editor.js      in JavaScript
// Main.dc.html bleibt eine einzelne Datei im x-dc-Format, damit das Design-Werkzeug sie öffnen kann.
// Geändert wird nur in pages/src/, danach neu bauen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const PAGES = [{ src: 'pages/src/Main.html', out: 'pages/Main.dc.html' }];
const INCLUDE = /^\s*(?:<!--|\/\*|\/\/)\s*@include\s+(\S+?)\s*(?:-->|\*\/)?\s*$/;

function expand(file, stack = []) {
  if (stack.includes(file)) throw new Error('Einbindung im Kreis: ' + [...stack, file].map((f) => relative(root, f)).join(' → '));
  if (!existsSync(file)) throw new Error('Fehlt: ' + relative(root, file) + (stack.length ? ' (eingebunden in ' + relative(root, stack[stack.length - 1]) + ')' : ''));
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // Teildateien enden mit einem Zeilenumbruch; der gehört zur letzten Zeile, nicht zu einer leeren Zeile danach
  if (stack.length && lines[lines.length - 1] === '') lines.pop();
  return lines.flatMap((line) => {
    const m = INCLUDE.exec(line);
    return m ? expand(join(dirname(file), m[1]), [...stack, file]) : [line];
  });
}

const check = process.argv.includes('--check');
let stale = 0;
for (const { src, out } of PAGES) {
  const built = expand(join(root, src)).join('\n');
  const target = join(root, out);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (check) {
    if (current !== built) { stale++; console.error(out + ' ist nicht aktuell: node prototype/build.mjs'); }
    else console.log(out + ' ist aktuell');
  } else if (current === built) {
    console.log(out + ' unverändert');
  } else {
    writeFileSync(target, built);
    console.log(out + ' gebaut (' + built.split('\n').length + ' Zeilen)');
  }
}
process.exit(stale ? 1 : 0);
