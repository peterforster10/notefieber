// Prüft den eigenen Code auf fremde Lizenz- und Copyright-Hinweise (pnpm notices:check, auch in
// der CI über pnpm check). Hintergrund (CLAUDE.md, Abschnitt 14, „Fremder Code“): Gibt ein
// KI-Modell oder eine Vorlage fremden Code wieder, kommt oft der Kopfkommentar mit. Dann gilt für
// diese Stelle eine andere Lizenz, deren Pflichten (Hinweis behalten, Verträglichkeit) jemand
// bewusst prüfen muss.
//
// Geprüft werden alle Dateien unter apps/, packages/ und scripts/, die Git kennt oder die neu und
// nicht ignoriert sind. Ein Fund ist ein Fehler, bis die Datei mit Lizenz und Begründung in
// ALLOWED_FILES steht, etwa eine angepasste MIT-Vorlage, deren Copyright-Hinweis erhalten
// bleiben muss.
//
// Snippets ohne Hinweis findet diese Prüfung nicht; dafür bräuchte es Snippet-Matching (z. B.
// SCANOSS), siehe docs/TODOS.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['apps', 'packages', 'scripts'];
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|html|sql|sh|ya?ml|toml)$/i;

// Eigene Copyright-Zeilen sind erlaubt (LICENSE, README.md)
const OWN_COPYRIGHT = /Peter Forster/;

// Hinweise, an denen man fremde Lizenzen erkennt. Bewusst die Wortlaute aus den Lizenztexten
// selbst, nicht nur die Namen: Namen wie „Apache-2.0“ stehen auch in check-licenses.mjs.
export const NOTICE_PATTERNS = [
  { name: 'SPDX-Kennung', re: /SPDX-License-Identifier:\s*(?<id>[^\s*]+)/i },
  { name: '@license', re: /@(?:license|preserve)\b/i },
  { name: 'Copyright', re: /\bcopyright\b|\(c\)\s*(?:19|20)\d\d|©/i },
  { name: 'MIT-Text', re: /permission is hereby granted, free of charge/i },
  { name: 'BSD-Text', re: /redistribution and use in source and binary forms/i },
  { name: 'Apache-Text', re: /licensed under the apache license|apache license,\s*version 2\.0/i },
  { name: 'GPL-Text', re: /gnu (?:lesser |affero )?general public license/i },
  { name: 'MPL-Text', re: /mozilla public license/i },
  { name: 'Gewährleistungsausschluss', re: /provided ["“]as is["”]/i },
  { name: 'Alle Rechte vorbehalten', re: /all rights reserved/i },
  { name: 'Lizenzverweis', re: /\blicensed under\b/i },
];

// SPDX-Kennung des eigenen Codes; eine solche Zeile ist kein fremder Hinweis
const OWN_SPDX = new Set(['AGPL-3.0-only']);

// Geprüfte Ausnahmen: Pfad (wie in Git) → Lizenz und Begründung. Eigene Prüf-Skripte stehen hier,
// weil sie die Wortlaute als Muster bzw. Testfälle enthalten.
export const ALLOWED_FILES = new Map([
  ['scripts/check-notices.mjs', { license: '-', reason: 'enthält die Muster selbst' }],
  ['scripts/check-notices.test.mjs', { license: '-', reason: 'enthält Beispieltexte als Testfälle' }],
]);

/** Fremde Hinweise in einem Text: Liste mit Zeilennummer, Art und Zeile. */
export function findNotices(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { name, re } of NOTICE_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      if (name === 'SPDX-Kennung' && OWN_SPDX.has(m.groups.id)) continue;
      if (name === 'Copyright' && OWN_COPYRIGHT.test(line)) continue;
      found.push({ line: i + 1, kind: name, text: line.trim().slice(0, 120) });
      break; // eine Meldung pro Zeile genügt
    }
  });
  return found;
}

function trackedFiles() {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...ROOTS], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.error);
    process.exit(run.status ?? 1);
  }
  return run.stdout.split('\0').filter((f) => f && TEXT.test(f));
}

function main() {
  const files = trackedFiles();
  const errors = [];
  for (const file of files) {
    if (ALLOWED_FILES.has(file) || !fs.existsSync(file)) continue;
    for (const f of findNotices(fs.readFileSync(path.resolve(file), 'utf8'))) {
      errors.push(`${file}:${f.line} (${f.kind}): ${f.text}`);
    }
  }
  if (errors.length) {
    console.error(
      `Prüfung auf fremde Hinweise: ${errors.length} Fund(e) in ${files.length} Dateien:\n  ${errors.join('\n  ')}\n` +
        'Fremden Code ersetzen oder, wenn er bleiben soll, Datei mit Lizenz und Begründung in ' +
        'ALLOWED_FILES (scripts/check-notices.mjs) eintragen und die Lizenz prüfen (CLAUDE.md, Abschnitt 14).',
    );
    process.exit(1);
  }
  console.log(`Prüfung auf fremde Hinweise: ${files.length} Dateien, keine fremden Lizenz- oder Copyright-Hinweise.`);
}

// Nur als Skript ausführen, nicht beim Import (findNotices lässt sich so einzeln prüfen)
if (import.meta.main) {
  main();
}
