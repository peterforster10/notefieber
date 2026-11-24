// Kontraste des Designsystems nach WCAG 2.2 AA (E15, Abnahmekriterium „Die Kontrastwerte bestehen die
// Prüfung“): Text mindestens 4,5:1 (1.4.3), Bedienelemente, Rahmen von Eingabefeldern, Icons und der
// Fokusring mindestens 3:1 (1.4.11). Geprüft werden die Tokens aus globals.css, auch für Zustände,
// die eine automatische Prüfung im Browser (axe, e2e/a11y.spec.ts) nicht zu sehen bekommt: Hover,
// ausgewählt, Hinweise, Callouts. Neue Farbpaare hier eintragen.
//
// Kontrastverhältnis und relative Luminanz nach der Definition in WCAG 2.2 (Abschnitt „Definitions“).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PERSON_COLORS } from '../lib/person-color.ts';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
const tokens = new Map([...root.matchAll(/--(nf-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));

function color(name) {
  if (name.startsWith('#')) return name;
  const value = tokens.get(name);
  assert.ok(value, `Token --${name} fehlt in globals.css oder ist keine Farbe #rrggbb`);
  return value;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const UI = 3;

/** [Vordergrund, Hintergrund, Mindestwert, wo] */
const PAIRS = [
  // Inhalt
  ['nf-text', 'nf-bg', TEXT, 'Fließtext'],
  ['nf-muted', 'nf-bg', TEXT, 'gedämpfter Text, Brotkrume, Metazeile'],
  ['nf-muted', 'nf-subtle', TEXT, 'Tastenkürzel im Menü bei Hover'],
  ['nf-muted', 'nf-surface', TEXT, 'Band im Rechte-Dialog'],
  ['nf-text', 'nf-subtle', TEXT, 'Tabellenkopf, Menüeintrag bei Hover'],
  ['nf-text', 'nf-code-bg', TEXT, 'Code im Text'],
  ['nf-accent', 'nf-bg', TEXT, 'Links'],
  ['nf-accent-hover', 'nf-bg', TEXT, 'Links bei Hover'],
  ['nf-accent', 'nf-accent-soft', TEXT, 'Seitenlink'],
  ['nf-text', 'nf-accent-soft', TEXT, 'Hinweis „Kommt bald“ im Dialog'],
  ['nf-on-accent', 'nf-accent', TEXT, 'Hauptknopf, Kürzel des Spaces'],
  ['nf-on-accent', 'nf-accent-hover', TEXT, 'Hauptknopf bei Hover'],
  ['nf-on-accent', 'nf-attention', TEXT, 'Knopf Archivieren'],
  ['nf-on-accent', 'nf-restricted-fg', TEXT, 'Knopf Archivieren bei Hover'],
  ['nf-attention', 'nf-bg', TEXT, 'Fehlermeldungen'],
  ['nf-attention', 'nf-attention-soft', TEXT, 'Hinweis im Editor, Callout Warnung'],
  ['nf-restricted-fg', 'nf-restricted-bg', TEXT, 'Hinweis „Eingeschränkt“'],
  ['nf-done-fg', 'nf-done-bg', TEXT, 'Erwähnung, Callout Erfolg, Einladungslink'],
  ['nf-done-fg', 'nf-bg', TEXT, '„Gespeichert“'],
  ['nf-danger', 'nf-danger-soft', TEXT, 'Callout Fehler'],
  ['nf-danger', 'nf-bg', TEXT, 'Menüeintrag Papierkorb'],
  ['nf-danger', 'nf-subtle', TEXT, 'Menüeintrag Papierkorb bei Hover'],
  ['nf-muted', 'nf-neutral-soft', TEXT, 'Callout Hinweis, Seitenlink nicht verfügbar'],
  ['nf-accent', 'nf-accent-soft', TEXT, 'Callout Info'],
  ['#ffffff', 'nf-muted', TEXT, 'Avatar „+n“'],

  // Seitenleiste (hell)
  ['nf-sidebar-text', 'nf-sidebar-bg', TEXT, 'Seitenbaum'],
  ['nf-sidebar-muted', 'nf-sidebar-bg', TEXT, 'Überschrift „Seiten“, Schlüssel des Spaces, EU-Hinweis'],
  ['nf-sidebar-text', 'nf-sidebar-hover', TEXT, 'Zeile bei Hover'],
  ['nf-sidebar-muted', 'nf-sidebar-hover', TEXT, 'Laden … bei Hover'],
  ['nf-sidebar-selected-text', 'nf-sidebar-selected', TEXT, 'ausgewählte Seite'],
  ['nf-accent', 'nf-sidebar-bg', TEXT, '„Wiederherstellen“ im Papierkorb'],
  ['nf-attention', 'nf-sidebar-bg', TEXT, 'Fehler in der Seitenleiste'],
  ['nf-sidebar-text', 'nf-bg', TEXT, 'Space-Karte'],
  ['nf-sidebar-muted', 'nf-bg', TEXT, 'Schlüssel auf der Space-Karte'],
  ['nf-sidebar-muted', 'nf-surface', TEXT, 'Space-Karte bei Hover'],

  // Bedienelemente, Rahmen, Icons, Fokus (3:1)
  ['nf-input-border', 'nf-bg', UI, 'Rahmen von Eingabefeldern'],
  ['nf-input-border', 'nf-sidebar-bg', UI, 'Eingabefelder in der Seitenleiste'],
  ['nf-sidebar-muted', 'nf-sidebar-hover', UI, 'Icons in der Zeile bei Hover'],
  ['nf-sidebar-muted', 'nf-sidebar-selected', UI, 'Aufklappen an der ausgewählten Zeile'],
  ['nf-focus', 'nf-bg', UI, 'Fokusring'],
  ['nf-focus', 'nf-sidebar-bg', UI, 'Fokusring in der Seitenleiste'],
  ['nf-focus', 'nf-sidebar-hover', UI, 'Fokusring auf einer Zeile'],
  ['nf-focus', 'nf-sidebar-selected', UI, 'Fokusring auf der ausgewählten Zeile'],
  ['nf-focus', 'nf-subtle', UI, 'Fokus im Menü'],
  ['nf-accent', 'nf-sidebar-hover', UI, 'Linie beim Ablegen'],
];

test('alle Farbpaare erreichen WCAG 2.2 AA', () => {
  const failures = PAIRS.map(([fg, bg, min, where]) => ({ fg, bg, min, where, ratio: contrast(color(fg), color(bg)) }))
    .filter((p) => p.ratio < p.min)
    .map((p) => `${p.where}: ${p.fg} auf ${p.bg} = ${p.ratio.toFixed(2)}:1, nötig ${p.min}:1`);
  assert.deepEqual(failures, []);
});

test('weiße Initialen auf jeder Personenfarbe', () => {
  const failures = PERSON_COLORS.filter((c) => contrast('#ffffff', c) < TEXT).map(
    (c) => `${c}: ${contrast('#ffffff', c).toFixed(2)}:1`,
  );
  assert.deepEqual(failures, []);
});

test('Formel stimmt mit bekannten Werten überein', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
});
