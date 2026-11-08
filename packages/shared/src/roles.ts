// Rollen wie in den CHECK-Bedingungen des Schemas (10_tables.sql).

/** Rolle auf einem Space oder einer Seite (grants.role), aufsteigend. */
export const SPACE_ROLES = ['viewer', 'commenter', 'editor', 'admin'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

/** Rolle in einem Workspace (workspace_members.role). */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Rolle im Mandanten (users.role). */
export const ORG_ROLES = ['org_admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Woher eine Gruppe kommt (groups.source). */
export const GROUP_SOURCES = ['local', 'import', 'idp', 'scim'] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];

/** Rang einer Rolle wie app.role_rank: 0 = kein Zugriff, 1 viewer … 4 admin. */
export function roleRank(role: SpaceRole | null | undefined): number {
  return role ? SPACE_ROLES.indexOf(role) + 1 : 0;
}
