'use client';

// Anwesenheit (E04-02): wer die Seite gerade offen hat, auch Lesende. Kommt aus Yjs Awareness des
// Collab-Servers und wird nie gespeichert. Der Editor (page-editor.tsx) meldet die Liste nach oben,
// der Kopfbereich (page-header.tsx) zeigt die Avatare.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface PersonState {
  id: string;
  name: string;
  color: string;
}

/** Alle Personen mit offener Seite, die eigene zuerst; eine Person mit zwei Tabs nur einmal */
export function usePresence(provider: HocuspocusProvider, selfId: string): PersonState[] {
  const awareness = provider.awareness;
  const [people, setPeople] = useState<PersonState[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const update = () => {
      const byId = new Map<string, PersonState>();
      for (const state of awareness.getStates().values()) {
        const p = (state as { person?: PersonState }).person;
        if (p?.id) byId.set(p.id, p);
      }
      const next = [...byId.values()].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0));
      // Awareness meldet auch jede Cursorbewegung; nur bei anderen Personen neu rendern
      setPeople((prev) => (samePeople(prev, next) ? prev : next));
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness, selfId]);
  return people;
}

function samePeople(a: PersonState[], b: PersonState[]): boolean {
  return (
    a.length === b.length && a.every((p, i) => p.id === b[i]!.id && p.name === b[i]!.name && p.color === b[i]!.color)
  );
}

const SHOWN = 5;

/** Avatare im Kopfbereich; als Ganzes ein Bild mit allen Namen für Screenreader */
export function PresenceAvatars({ people, selfId }: { people: PersonState[]; selfId: string }) {
  const t = useTranslations('editor');
  if (people.length === 0) return null;
  const shown = people.slice(0, SHOWN);
  const names = people.map((p) => (p.id === selfId ? t('you', { name: p.name }) : p.name)).join(', ');
  return (
    <div className="nf-presence" role="img" aria-label={t('presenceNames', { names })}>
      {shown.map((p) => (
        <span
          key={p.id}
          title={p.id === selfId ? t('you', { name: p.name }) : p.name}
          style={{ background: p.color }}
          aria-hidden
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > shown.length && (
        <span className="nf-presence-more" aria-hidden>
          +{people.length - shown.length}
        </span>
      )}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}
