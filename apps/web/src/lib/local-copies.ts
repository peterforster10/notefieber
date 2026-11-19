// Lokale Kopien der Yjs-Dokumente in IndexedDB (E04-04): Änderungen, die bei einem Funkloch noch
// nicht beim Collab-Server angekommen sind, überstehen ein Neuladen und werden beim nächsten
// Verbinden übertragen. Entschieden am 19. November 2026:
//   - eine Datenbank pro Person und Seite: nf:<person>:page:<seite>
//   - Abmelden löscht alle lokalen Kopien von NoteFieber in diesem Browser (geteilte Rechner)
//   - Verliert die Person das Leserecht, löscht der Editor die Kopie dieser Seite sofort
// Restrisiko: Wer den Browser nur schließt, ohne sich abzumelden, lässt die Kopien im Profil liegen.
// Rechte gelten trotzdem: Ob die lokalen Änderungen gespeichert werden, entscheidet der
// Collab-Server beim Verbinden (lesende Verbindungen verwerfen sie).
'use client';

import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

const PREFIX = 'nf:';
const open = new Set<IndexeddbPersistence>();

export const localCopyName = (userId: string, pageId: string) => `${PREFIX}${userId}:page:${pageId}`;

/** Lokale Kopie öffnen und mit dem Dokument verbinden (lädt den gespeicherten Stand hinein) */
export function openLocalCopy(userId: string, pageId: string, doc: Y.Doc): IndexeddbPersistence {
  const copy = new IndexeddbPersistence(localCopyName(userId, pageId), doc);
  open.add(copy);
  // Will ein anderer Tab die Datenbank löschen (Abmelden dort), hier sofort schließen, sonst
  // wartet das Löschen, bis dieser Tab zu ist
  void copy.whenSynced.then(() => {
    if (copy.db) copy.db.onversionchange = () => closeLocalCopy(copy);
  });
  return copy;
}

/** Verbindung zur lokalen Kopie schließen, Inhalt bleibt (Seite verlassen) */
export function closeLocalCopy(copy: IndexeddbPersistence): void {
  if (!open.delete(copy)) return;
  void copy.destroy();
}

/** Lokale Kopie löschen (kein Zugriff mehr auf die Seite) */
export async function clearLocalCopy(copy: IndexeddbPersistence): Promise<void> {
  open.delete(copy);
  await copy.clearData();
}

function deleteDatabase(name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs); // blockiert ein anderer Tab, nicht ewig warten
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/**
 * Alle lokalen Kopien von NoteFieber in diesem Browser löschen (beim Abmelden). Was noch nicht
 * übertragen war, ist damit weg; das ist beim Abmelden gewollt.
 */
export async function clearAllLocalCopies(timeoutMs = 2000): Promise<void> {
  for (const copy of [...open]) closeLocalCopy(copy);
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) return;
  const dbs = await indexedDB.databases().catch(() => []);
  await Promise.all(
    dbs
      .map((d) => d.name)
      .filter((name): name is string => !!name?.startsWith(PREFIX))
      .map((name) => deleteDatabase(name, timeoutMs)),
  );
}
