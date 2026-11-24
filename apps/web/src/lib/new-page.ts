// Seiten, die gerade über „+“ im Seitenbaum angelegt wurden (ohne Titel): Öffnet der Editor eine
// davon, setzt er den Cursor in das leere Titelfeld (E15). Nur im Speicher dieses Tabs; nach dem
// ersten Öffnen vergessen, damit ein späteres Neuladen den Cursor nicht wieder in den Titel setzt.
'use client';

const fresh = new Set<string>();

export function markNewPage(id: string): void {
  fresh.add(id);
}

export function isNewPage(id: string): boolean {
  return fresh.has(id);
}

export function forgetNewPage(id: string): void {
  fresh.delete(id);
}
