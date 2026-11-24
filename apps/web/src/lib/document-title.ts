// Titel im Browser-Tab (E15, WCAG 2.4.2 „Seite mit Titel“): auf einer Seite ihr Titel, auf der
// Startseite eines Spaces und in seinen Einstellungen der Name des Spaces, jeweils mit „· NoteFieber“.
// Die Seiten laden ihre Daten im Browser über die API, deshalb setzt ihn das Frontend selbst und nicht
// die Metadaten von Next.js (dort steht nur „NoteFieber“ für alles andere).
'use client';

import { useEffect } from 'react';

export const APP_NAME = 'NoteFieber';

/** Tab-Titel setzen, solange die Ansicht offen ist; ohne Text (noch am Laden) bleibt der bisherige */
export function useDocumentTitle(text: string | undefined): void {
  useEffect(() => {
    if (!text) return;
    const title = `${text} · ${APP_NAME}`;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    // Nach einer Navigation im Browser schreibt Next.js den Titel aus seinen Metadaten („NoteFieber“),
    // teils erst nach dieser Ansicht; dann gilt wieder ihr eigener
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      // Zurück auf „NoteFieber“, aber nur, wenn noch dieser Titel steht (die nächste Ansicht kann ihren
      // schon gesetzt haben)
      if (document.title === title) document.title = APP_NAME;
    };
  }, [text]);
}
