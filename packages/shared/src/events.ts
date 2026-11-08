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
 * Rechte sofort gelten (CLAUDE.md, Abschnitt 6).
 */
export const RECONNECT_EVENTS: readonly EventType[] = [
  'grant.changed',
  'page.permissions_changed',
  'member.removed',
  'member.changed',
  'user.deactivated',
  'space.archived',
];

export function spaceSubject(tenantId: string, spaceId: string): string {
  return `t.${tenantId}.wiki.s.${spaceId}`;
}
