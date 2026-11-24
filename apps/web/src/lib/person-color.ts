// Farbe pro Person für Avatare und Cursor, stabil über Sitzungen hinweg (aus der ID). Weiße Schrift
// auf jeder Farbe erreicht mindestens 4,5:1 (geprüft in src/app/contrast.test.mjs).
export const PERSON_COLORS = [
  '#1F5FD6',
  '#C2410C',
  '#1E5135',
  '#7C3AED',
  '#B45309',
  '#0E7490',
  '#BE185D',
  '#4D7C0F',
] as const;

export function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length]!;
}
