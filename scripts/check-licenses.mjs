// Prüft die Lizenzen aller Abhängigkeiten, die mit den Apps ausgeliefert werden
// (pnpm licenses:check, auch in der CI). Der eigene Code steht unter AGPL-3.0-only (LICENSE),
// deshalb darf nur hinein, was mit der AGPL-3.0 verträglich ist:
//   - Freigabeliste statt Sperrliste: jede Lizenz muss in ALLOWED_LICENSES stehen. Unbekannte
//     oder neue Lizenzen sind ein Fehler, bis jemand sie geprüft und hier eingetragen hat.
//   - Ausdrücke wie „(MIT OR Apache-2.0)“ oder „Apache-2.0 AND LGPL-3.0-or-later“ werden
//     ausgewertet: bei OR genügt eine erlaubte Alternative, bei AND müssen alle erlaubt sein.
//   - CC-BY-4.0 taugt nur für Daten, nicht für Code: nur als Ausnahme für caniuse-lite.
//   - Unverträglich und deshalb nie in der Liste: GPL-2.0-only, EPL-1.0, CDDL, SSPL,
//     BUSL/BSL (z. B. Outline), Commons Clause, Elastic License, CC-BY-NC, proprietäre Lizenzen.
//   - BlockNote-XL-Pakete (@blocknote/xl-*, GPL-3.0 oder kommerziell) sind im AGPL-Kern erlaubt.
//     In proprietären Enterprise-Teilen dürfen sie nie stehen (CLAUDE.md, Abschnitt 3); sobald
//     es solche Teile gibt, bekommt diese Prüfung eine eigene Regel für sie.
import { spawnSync } from 'node:child_process';

// Geprüft verträglich mit AGPL-3.0-only (SPDX-IDs). Begründung bei den nicht offensichtlichen.
const ALLOWED_LICENSES = new Map([
  // Freizügige Lizenzen
  ['MIT', ''],
  ['MIT-0', ''],
  ['ISC', ''],
  ['0BSD', ''],
  ['BSD-2-Clause', ''],
  ['BSD-3-Clause', ''],
  ['Apache-2.0', 'verträglich mit GPL-3.0 und AGPL-3.0, nicht mit GPL-2.0-only'],
  ['BlueOak-1.0.0', ''],
  ['Python-2.0', ''],
  ['Zlib', ''],
  ['Unlicense', ''],
  ['CC0-1.0', ''],
  // Schwaches Copyleft
  ['MPL-2.0', 'Dateien bleiben MPL-2.0; Kombination mit (A)GPL über Abschnitt 3.3 erlaubt (z. B. BlockNote)'],
  ['LGPL-2.1-or-later', ''],
  ['LGPL-3.0-only', ''],
  ['LGPL-3.0-or-later', 'z. B. libvips in @img/sharp-* (Bilder in Next.js)'],
  // Starkes Copyleft, verträglich mit AGPL-3.0 (GPL-3.0 Abschnitt 13)
  ['GPL-3.0-only', 'z. B. BlockNote-XL-Pakete; nur im AGPL-Kern'],
  ['GPL-3.0-or-later', ''],
  ['GPL-2.0-or-later', 'als GPL-3.0 nutzbar'],
  ['AGPL-3.0-only', ''],
  ['AGPL-3.0-or-later', ''],
]);

// Alte bzw. ungenaue Schreibweisen aus package.json auf SPDX-IDs abbilden
const ALIASES = new Map([
  ['GPL-3.0', 'GPL-3.0-only'],
  ['GPL-3.0+', 'GPL-3.0-or-later'],
  ['GPL-2.0+', 'GPL-2.0-or-later'],
  ['LGPL-2.1+', 'LGPL-2.1-or-later'],
  ['LGPL-3.0', 'LGPL-3.0-only'],
  ['LGPL-3.0+', 'LGPL-3.0-or-later'],
  ['AGPL-3.0', 'AGPL-3.0-only'],
  ['AGPL-3.0+', 'AGPL-3.0-or-later'],
  ['Apache 2.0', 'Apache-2.0'],
  ['Apache License 2.0', 'Apache-2.0'],
]);

// Geprüfte Ausnahmen für einzelne Pakete: Name (genau) → Lizenz, wie pnpm sie meldet, und
// Begründung. Die Ausnahme gilt nur für genau diese Lizenz; ändert das Paket sie, schlägt die
// Prüfung wieder an. Für Lizenzen, die nur für Daten taugen (nicht für Code), oder wenn die Angabe
// in package.json fehlt, die Lizenzdatei aber verträglich ist.
export const ALLOWED_PACKAGES = new Map([
  ['caniuse-lite', { license: 'CC-BY-4.0', reason: 'nur Daten zur Browserunterstützung (Browserslist), kein Code' }],
]);

/** Ausnahme für genau dieses Paket mit genau dieser Lizenz? */
export function isPackageException(name, license) {
  return ALLOWED_PACKAGES.get(name)?.license === license;
}

/**
 * Wertet einen SPDX-Ausdruck aus: true, wenn er mit AGPL-3.0-only verträglich ist.
 * Grammatik wie in SPDX: Klammern zuerst, AND bindet stärker als OR, „X WITH Ausnahme“ zählt als
 * eigene Lizenz (nur erlaubt, wenn genau so in ALLOWED_LICENSES). Bei OR genügt eine erlaubte
 * Alternative, bei AND müssen alle erlaubt sein. Was sich nicht lesen lässt (fehlende Klammer,
 * leerer Teil), ist nicht erlaubt: Die Prüfung soll im Zweifel anschlagen.
 */
export function isAllowed(expression) {
  // Bezeichner dürfen Leerzeichen enthalten („Apache License 2.0“, siehe ALIASES); Schlüsselwörter
  // gelten nur mit Leerraum oder Klammer davor und danach
  const tokens = String(expression)
    .split(/(\(|\)|(?<=^|[\s)])(?:AND|OR|WITH)(?=$|[\s(]))/i)
    .map((t) => t.trim())
    .filter(Boolean);
  let pos = 0;
  const peek = () => tokens[pos]?.toUpperCase();
  const isKeyword = (t) => t === 'AND' || t === 'OR' || t === 'WITH' || t === '(' || t === ')';

  // Jede Funktion liefert true/false und wirft bei kaputter Syntax
  const parseOr = () => {
    let result = parseAnd();
    while (peek() === 'OR') {
      pos++;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  const parseAnd = () => {
    let result = parseAtom();
    while (peek() === 'AND') {
      pos++;
      const right = parseAtom();
      result = result && right;
    }
    return result;
  };
  const parseAtom = () => {
    const token = tokens[pos];
    if (token === '(') {
      pos++;
      const inner = parseOr();
      if (tokens[pos] !== ')') throw new Error('Klammer fehlt');
      pos++;
      return inner;
    }
    if (token === undefined || isKeyword(token.toUpperCase())) throw new Error('Lizenz fehlt');
    pos++;
    let id = ALIASES.get(token) ?? token;
    if (peek() === 'WITH') {
      pos++;
      const exception = tokens[pos];
      if (exception === undefined || isKeyword(exception.toUpperCase())) throw new Error('Ausnahme fehlt');
      pos++;
      id = `${id} WITH ${exception}`;
    }
    return ALLOWED_LICENSES.has(id);
  };

  try {
    const result = parseOr();
    return pos === tokens.length && result;
  } catch {
    return false;
  }
}

function main() {
  // pnpm aus dem laufenden „pnpm run“ nehmen (npm_execpath), sonst aus dem PATH
  const execPath = process.env.npm_execpath;
  const [cmd, prefix] = execPath
    ? /\.(c|m)?js$/.test(execPath)
      ? [process.execPath, [execPath]]
      : [execPath, []]
    : ['pnpm', []];
  const run = spawnSync(cmd, [...prefix, '-r', 'licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: !execPath && process.platform === 'win32',
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.error);
    process.exit(run.status ?? 1);
  }

  const byLicense = JSON.parse(run.stdout);
  const errors = [];
  let count = 0;
  for (const [license, packages] of Object.entries(byLicense)) {
    for (const pkg of packages) {
      count++;
      const id = `${pkg.name}@${pkg.versions.join(', ')} (${license})`;
      if (!isPackageException(pkg.name, license) && !isAllowed(license)) {
        errors.push(`${id}: Lizenz nicht als AGPL-verträglich geprüft (in scripts/check-licenses.mjs eintragen)`);
      }
    }
  }

  if (errors.length) {
    console.error(`Lizenzprüfung: ${errors.length} Problem(e) bei ${count} Paketen:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `Lizenzprüfung: ${count} Pakete, alle verträglich mit AGPL-3.0-only (${Object.keys(byLicense).join(', ')}).`,
  );
}

// Nur als Skript ausführen, nicht beim Import (isAllowed lässt sich so einzeln prüfen)
if (import.meta.main) {
  main();
}
