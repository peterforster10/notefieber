// Eingabeprüfungen, gleich streng wie die CHECK-Bedingungen im Schema. Die Datenbank prüft
// ohnehin; hier gibt es dafür früh eine verständliche Fehlermeldung.
import { z } from 'zod';

/** Kurzname eines Mandanten oder Workspaces (tenants.slug, workspaces.slug). */
export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'ungültiger Kurzname');

/** Schlüssel eines Spaces wie in Confluence, z. B. ENTW (spaces.key). */
export const spaceKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,31}$/, 'ungültiger Space-Schlüssel');

/** IDs sind UUIDv7. */
export const idSchema = z.uuid();

/** Seitentitel (pages.title, höchstens 255 Zeichen). */
export const pageTitleSchema = z.string().max(255);
