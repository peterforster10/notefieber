// Interner Aufruf der API an den Collab-Server (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-07):
// Änderungen am Yjs-Dokument von der Serverseite (Umbenennen aus der Seitenleiste, später Version
// wiederherstellen, Nacharbeiten nach dem Import, Vorlagen). Eigener Port, nur im Cluster erreichbar
// (nicht über den Ingress), dazu ein geteiltes Geheimnis im Header. Die Rechte prüft die API vorher;
// der Collab-Server prüft nur, dass die Seite im genannten Mandanten liegt.
import { z } from 'zod';

/** Header mit dem geteilten Geheimnis (COLLAB_INTERNAL_SECRET in API und Collab-Server) */
export const INTERNAL_SECRET_HEADER = 'x-nf-internal-secret';

/** Pfad für das Umbenennen einer Seite */
export const internalTitlePath = (pageId: string) => `/internal/v1/pages/${pageId}/title`;

export const internalTitleSchema = z.object({
  tenantId: z.uuid(),
  /** Wer umbenennt (für updated_by und editors_since_version) */
  userId: z.uuid(),
  title: z.string().max(10_000),
});
export type InternalTitleRequest = z.infer<typeof internalTitleSchema>;
