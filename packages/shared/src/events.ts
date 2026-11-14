// Ereignisse in der Outbox (CLAUDE.md, Abschnitt 7; Nutzdaten in docs/CONCEPTS.md).
// Subject: t.<mandant>.wiki.s.<space>

export const EVENT_TYPES = [
  'space.created',
  'space.updated',
  'space.archived',
  'page.created',
  'page.updated',
  'page.moved',
  'page.trashed',
  'page.restored',
  'page.permissions_changed',
  'grant.changed',
  'member.removed',
  'member.changed',
  'user.deactivated',
  'comment.created',
  'import.requested',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Nach diesen Ereignissen trennt der Collab-Server betroffene Verbindungen, damit neue
 * Rechte sofort gelten (CLAUDE.md, Abschnitt 6). Bei der neuen Anmeldung bekommt die Person
 * die neue Rolle; Seiten im Papierkorb öffnet er nur schreibgeschützt (page.trashed gilt
 * für den ganzen Teilbaum, page.restored macht sie wieder schreibbar; REVIEW.md, R-10).
 */
export const RECONNECT_EVENTS: readonly EventType[] = [
  'grant.changed',
  'page.permissions_changed',
  'member.removed',
  'member.changed',
  'user.deactivated',
  'space.archived',
  'page.trashed',
  'page.restored',
];

export function spaceSubject(tenantId: string, spaceId: string): string {
  return `t.${tenantId}.wiki.s.${spaceId}`;
}
