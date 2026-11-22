// Zustand der Seitenleiste pro Space: welche Seiten im Baum aufgeklappt sind und ob der
// Papierkorb offen ist. Die Seitenleiste wird bei jedem Seitenwechsel neu aufgebaut (eigene
// Route pro Seite); damit dabei nichts zuklappt, liegt der Zustand im sessionStorage: nur in
// diesem Tab, übersteht Seitenwechsel und Neuladen, nicht das Schließen des Tabs. Nur IDs, keine
// Titel. Abmelden löscht ihn (app/account.tsx). Ohne Speicher (privates Fenster, gesperrt) geht
// alles weiter, nur ohne Erinnern.
'use client';

const PREFIX = 'nf:sidebar:';
const treeKey = (spaceId: string) => `${PREFIX}${spaceId}:tree`;
const trashKey = (spaceId: string) => `${PREFIX}${spaceId}:trash`;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // kein Speicher: dann eben ohne Erinnern
  }
}

/** Aufgeklappte Seiten im Baum dieses Spaces */
export function loadExpanded(spaceId: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(read(treeKey(spaceId)) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveExpanded(spaceId: string, ids: Set<string>): void {
  write(treeKey(spaceId), ids.size ? JSON.stringify([...ids]) : null);
}

/** Ist der Papierkorb dieses Spaces aufgeklappt? */
export function loadTrashOpen(spaceId: string): boolean {
  return read(trashKey(spaceId)) === '1';
}

export function saveTrashOpen(spaceId: string, open: boolean): void {
  write(trashKey(spaceId), open ? '1' : null);
}

/** Beim Abmelden: Zustand aller Spaces in diesem Tab vergessen */
export function clearSidebarState(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // kein Speicher
  }
}
