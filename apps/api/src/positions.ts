// Positionen im Seitenbaum (pages.position) als Fractional Index, wie app.next_position in
// der Datenbank (gleiche Schlüssel wie das npm-Paket fractional-indexing). Die API kennt nur
// die Geschwister, die die Person sieht; eingeschränkte Geschwister können dieselbe Position
// haben. Sortiert wird deshalb immer nach (position, id).
import { generateKeyBetween } from 'fractional-indexing';

export interface Sibling {
  id: string;
  position: string;
}

function compare(a: Sibling, b: Sibling): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Position für eine Seite unter `siblings` (ohne die Seite selbst): direkt hinter `afterId`,
 * direkt vor `beforeId`, oder ans Ende. Liegen zwei Nachbarn auf derselben Position, kommt die
 * Seite dahinter (ans Ende des Abschnitts) statt dazwischen.
 */
export function positionFor(
  siblings: Sibling[],
  target: { afterId?: string | null; beforeId?: string | null },
): string {
  const sorted = [...siblings].sort(compare);
  let lower: string | null = null;
  let upper: string | null = null;
  if (target.afterId) {
    const i = sorted.findIndex((s) => s.id === target.afterId);
    if (i < 0) throw new PositionError('afterId ist keine sichtbare Geschwisterseite');
    lower = sorted[i]!.position;
    upper = sorted[i + 1]?.position ?? null;
  } else if (target.beforeId) {
    const i = sorted.findIndex((s) => s.id === target.beforeId);
    if (i < 0) throw new PositionError('beforeId ist keine sichtbare Geschwisterseite');
    upper = sorted[i]!.position;
    lower = sorted[i - 1]?.position ?? null;
  } else {
    lower = sorted.at(-1)?.position ?? null;
  }
  if (lower !== null && upper !== null && lower >= upper) upper = null;
  return generateKeyBetween(lower, upper);
}

export class PositionError extends Error {}
