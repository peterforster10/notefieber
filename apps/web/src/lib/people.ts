// Namen erwähnter Personen im Editor. Eine Erwähnung speichert nur die Personen-ID
// (packages/editor-schema, mention); den Namen holt der Browser über die API (POST /people/lookup,
// nur Personen, die man sehen darf: Gäste sehen etwa nur sich selbst).
'use client';

import { createLookup } from './lookups';

export interface MentionedPerson {
  id: string;
  displayName: string;
  deactivated: boolean;
}

const people = createLookup<MentionedPerson>('/people/lookup');

/** Name einer erwähnten Person (undefined: wird geladen; value null: nicht sichtbar) */
export const useMentionedPerson = (id: string) => people.use(id);
