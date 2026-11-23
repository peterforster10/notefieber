// Nachschlagen per ID für Inline-Inhalte im Editor, die nur eine ID speichern: Seitenlinks
// (POST /pages/lookup) und Erwähnungen (POST /people/lookup). Was die Person nicht sehen darf,
// liefert die API nicht; dann ist der Eintrag null.
//
// Bewusst ein eigener kleiner Speicher statt TanStack Query: Die Inline-Inhalte rendert BlockNote als
// eigene React-Bäume im Editor, ohne Sicherheit, dass dort der Kontext der App ankommt. IDs, die
// im selben Moment gebraucht werden, gehen in einer Anfrage hinaus (höchstens 100).
'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';

/** undefined: wird geladen; value null: nicht sichtbar oder gelöscht */
export type Entry<T> = { value: T | null; loadedAt: number } | undefined;

const STALE_MS = 30_000;
const MAX_IDS = 100;

export interface Lookup<T> {
  /** Eintrag zu einer ID; lädt nach, wenn unbekannt oder älter als 30 s */
  use(id: string): Entry<T>;
  /** Alle bekannten Einträge neu laden (nach Umbenennen, Verschieben, Papierkorb) */
  invalidate(): void;
}

export function createLookup<T extends { id: string }>(path: string): Lookup<T> {
  const entries = new Map<string, Entry<T>>();
  const listeners = new Set<() => void>();
  let pending = new Set<string>();
  let scheduled = false;

  const emit = () => listeners.forEach((l) => l());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  async function flush() {
    scheduled = false;
    const ids = [...pending];
    pending = new Set();
    for (let i = 0; i < ids.length; i += MAX_IDS) {
      const chunk = ids.slice(i, i + MAX_IDS);
      try {
        const found = await api<T[]>(path, { method: 'POST', body: { ids: chunk } });
        const byId = new Map(found.map((v) => [v.id, v]));
        const now = Date.now();
        for (const id of chunk) entries.set(id, { value: byId.get(id) ?? null, loadedAt: now });
      } catch {
        // Netz weg oder abgemeldet: beim nächsten Anzeigen noch einmal versuchen
        for (const id of chunk) entries.delete(id);
      }
    }
    emit();
  }

  function request(id: string) {
    pending.add(id);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => void flush());
  }

  function refreshIfStale(id: string) {
    const entry = entries.get(id);
    if (entries.has(id) && (!entry || Date.now() - entry.loadedAt <= STALE_MS)) return;
    // Als geladen merken, damit eine zweite Stelle mit derselben ID nicht noch einmal fragt
    entries.set(id, entry ? { ...entry, loadedAt: Date.now() } : undefined);
    request(id);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      for (const id of entries.keys()) refreshIfStale(id);
    });
  }

  return {
    use(id) {
      const entry = useSyncExternalStore(
        subscribe,
        () => entries.get(id),
        () => undefined,
      );
      useEffect(() => {
        if (id) refreshIfStale(id);
      }, [id]);
      return entry;
    },
    invalidate() {
      for (const id of entries.keys()) request(id);
    },
  };
}
