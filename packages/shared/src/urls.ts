// Lesbare Adressen im Frontend (die API arbeitet weiter mit UUIDs):
//   /spaces/entw                                       Space (Schlüssel klein, gespeichert als ENTW)
//   /spaces/entw/pages/datenmodell-1yGd3kQ8vXr2mT5pLwN9aB   Seite: Titel + kurze ID
// Die kurze ID ist die UUID der Seite in Base62 (immer 22 Zeichen, 0-9A-Za-z, umkehrbar,
// ohne Datenbank). Der Titel davor ist nur zum Lesen: Wird die Seite umbenannt, funktioniert
// der alte Link weiter, weil nur die ID nach dem letzten Bindestrich zählt.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHORT_LENGTH = 22; // 62^22 > 2^128
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = /^[0-9A-Za-z]{22}$/;

/** UUID → 22 Zeichen Base62 */
export function shortId(uuid: string): string {
  if (!UUID.test(uuid)) throw new Error(`Keine UUID: ${uuid}`);
  let n = BigInt(`0x${uuid.replaceAll('-', '')}`);
  let out = '';
  for (let i = 0; i < SHORT_LENGTH; i++) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

/** 22 Zeichen Base62 → UUID (klein geschrieben); undefined, wenn es keine gültige kurze ID ist */
export function uuidFromShortId(short: string): string | undefined {
  if (!SHORT.test(short)) return undefined;
  let n = 0n;
  for (const c of short) n = n * 62n + BigInt(ALPHABET.indexOf(c));
  if (n >= 1n << 128n) return undefined;
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Titel für die Adresse: klein, Umlaute ausgeschrieben, sonst nur a-z, 0-9 und Bindestriche */
export function slugify(title: string, maxLength = 60): string {
  const s = title
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // übrige Akzente weg (é → e)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, maxLength).replace(/-+$/, '');
}

/** Teil der Adresse für eine Seite: „datenmodell-1yGd3kQ8vXr2mT5pLwN9aB“ (ohne Titel nur die ID) */
export function pageSlug(title: string, id: string): string {
  const s = slugify(title);
  return s ? `${s}-${shortId(id)}` : shortId(id);
}

/** Gegenstück zu pageSlug: die UUID aus der Adresse, egal welcher Titel davor steht */
export function pageIdFromSlug(slug: string): string | undefined {
  return uuidFromShortId(slug.slice(slug.lastIndexOf('-') + 1));
}

export function spacePath(key: string): string {
  return `/spaces/${key.toLowerCase()}`;
}

/** Einstellungen eines Spaces: Name, Beschreibung, Archivieren */
export function spaceSettingsPath(key: string): string {
  return `${spacePath(key)}/settings`;
}

export function pagePath(spaceKey: string, page: { id: string; title: string }): string {
  return `${spacePath(spaceKey)}/pages/${pageSlug(page.title, page.id)}`;
}
