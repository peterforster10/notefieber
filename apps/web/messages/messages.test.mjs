// Texte der Oberfläche in beiden Sprachen vollständig (Definition of Done in docs/EPICS.md): gleiche
// Schlüssel, in jeder Nachricht dieselben Platzhalter ({name}) und Auszeichnungen (<strong>), keine
// leeren Texte. Dazu die Wahl der Sprache aus src/i18n/locales.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fromAcceptLanguage, matchLocale, toLocale } from '../src/i18n/locales.ts';

const load = (locale) => JSON.parse(readFileSync(new URL(`./${locale}.json`, import.meta.url), 'utf8'));
const de = load('de');
const en = load('en');

/** Alle Blätter als Pfad → Text */
function flatten(obj, prefix = '') {
  const out = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') for (const [p, v] of flatten(value, path)) out.set(p, v);
    else out.set(path, value);
  }
  return out;
}

const arguments_ = (text) => [...text.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]).sort();
const tags = (text) => [...text.matchAll(/<\/?([A-Za-z]+)>/g)].map((m) => m[0]).sort();

test('Deutsch und Englisch haben dieselben Schlüssel', () => {
  const a = [...flatten(de).keys()].sort();
  const b = [...flatten(en).keys()].sort();
  assert.deepEqual(
    a.filter((k) => !b.includes(k)),
    [],
    'fehlt in en.json',
  );
  assert.deepEqual(
    b.filter((k) => !a.includes(k)),
    [],
    'fehlt in de.json',
  );
});

test('jede Nachricht ist ein nicht leerer Text mit denselben Platzhaltern in beiden Sprachen', () => {
  const english = flatten(en);
  for (const [key, text] of flatten(de)) {
    const other = english.get(key);
    assert.equal(typeof text, 'string', `de: ${key}`);
    assert.equal(typeof other, 'string', `en: ${key}`);
    assert.ok(text.trim() && other.trim(), `leer: ${key}`);
    assert.deepEqual(arguments_(other), arguments_(text), `Platzhalter: ${key}`);
    assert.deepEqual(tags(other), tags(text), `Auszeichnungen: ${key}`);
  }
});

test('Sprache aus Cookie, Profil oder Accept-Language', () => {
  assert.equal(matchLocale('de-AT'), 'de');
  assert.equal(matchLocale('EN_gb'), 'en');
  assert.equal(matchLocale('fr'), undefined);
  assert.equal(matchLocale(undefined), undefined);
  assert.equal(toLocale('fr'), 'de');
  assert.equal(fromAcceptLanguage('fr-CH, en;q=0.8, de;q=0.9'), 'de');
  assert.equal(fromAcceptLanguage('en-US,en;q=0.9'), 'en');
  assert.equal(fromAcceptLanguage('fr, it;q=0.5'), undefined);
  assert.equal(fromAcceptLanguage('de;q=0, en;q=0.1'), 'en');
  assert.equal(fromAcceptLanguage(''), undefined);
});
