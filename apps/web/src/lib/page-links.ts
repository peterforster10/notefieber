// Titel verlinkter Seiten für Seitenlinks im Editor. Ein Seitenlink speichert nur die Seiten-ID
// (packages/editor-schema, pageLink); den aktuellen Titel holt der Browser über die API
// (POST /pages/lookup, nur lesbare Seiten). So bleibt der Link nach Umbenennen und Verschieben
// gültig, und wer die Zielseite nicht lesen darf, sieht ihren Titel nicht.
'use client';

import { createLookup } from './lookups';

export interface LinkedPage {
  id: string;
  title: string;
  spaceKey: string;
  trashed: boolean;
}

const pages = createLookup<LinkedPage>('/pages/lookup');

/** Titel und Space einer verlinkten Seite (undefined: wird geladen; value null: nicht verfügbar) */
export const useLinkedPage = (id: string) => pages.use(id);

/** Nach Umbenennen, Verschieben, Papierkorb: alle Titel neu laden */
export const invalidatePageLinks = () => pages.invalidate();
