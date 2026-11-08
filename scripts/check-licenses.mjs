// Prüft die Lizenzen aller Abhängigkeiten, die mit den Apps ausgeliefert werden
// (pnpm licenses:check, auch in der CI). Der eigene Code ist proprietär (LICENSE), deshalb:
//   - keine starke Copyleft-Lizenz (GPL, AGPL, SSPL, EUPL), sie würde den eigenen Code erfassen
//   - keine BlockNote-XL-Pakete (@blocknote/xl-*, GPL-3.0 oder kommerziell; CLAUDE.md, Abschnitt 4)
//   - LGPL nur für ausdrücklich erlaubte Pakete (native Bibliotheken, dynamisch geladen)
//   - unbekannte Lizenzen sind ein Fehler, bis jemand sie geprüft und hier eingetragen hat
import { spawnSync } from 'node:child_process';

const FORBIDDEN = /\b(A?GPL|SSPL|EUPL)\b/i;
const WEAK_COPYLEFT = /\bLGPL\b/i;
const FORBIDDEN_PACKAGES = [/^@blocknote\/xl-/];

// Geprüfte Ausnahmen: Paketname (Muster) → Begründung
const ALLOWED = new Map([
  [/^@img\/sharp-/, 'libvips als vorgebaute, dynamisch geladene Bibliothek von sharp (Bilder in Next.js), LGPL-3.0'],
]);

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
    const allowed = [...ALLOWED.keys()].find((re) => re.test(pkg.name));
    if (FORBIDDEN_PACKAGES.some((re) => re.test(pkg.name))) {
      errors.push(`${id}: BlockNote-XL-Pakete sind nicht erlaubt`);
    } else if (FORBIDDEN.test(license) && !allowed) {
      errors.push(`${id}: starke Copyleft-Lizenz`);
    } else if (WEAK_COPYLEFT.test(license) && !allowed) {
      errors.push(`${id}: LGPL nur nach Prüfung (in scripts/check-licenses.mjs eintragen)`);
    } else if (/^(unknown|unlicensed|see license)/i.test(license) && !allowed) {
      errors.push(`${id}: Lizenz unbekannt`);
    }
  }
}

if (errors.length) {
  console.error(`Lizenzprüfung: ${errors.length} Problem(e) bei ${count} Paketen:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`Lizenzprüfung: ${count} Pakete, alle Lizenzen in Ordnung (${Object.keys(byLicense).join(', ')}).`);
