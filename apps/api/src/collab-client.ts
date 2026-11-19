// Interner Aufruf der API an den Collab-Server (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-07).
// Die API prüft vorher die Rechte; der Collab-Server ändert das Yjs-Dokument, damit offene Browser
// es sofort sehen. Eigener Port, nur im Cluster, geteiltes Geheimnis (packages/shared/src/internal.ts).
import { INTERNAL_SECRET_HEADER, internalTitlePath, type InternalTitleRequest } from '@notefieber/shared';

export class CollabUnavailable extends Error {}

export interface CollabClient {
  /** Titel einer Seite setzen; 'not-found' oder 'trashed', wenn der Collab-Server ablehnt */
  renamePage(pageId: string, req: InternalTitleRequest): Promise<'ok' | 'not-found' | 'trashed'>;
}

export function createCollabClient(baseUrl: string, secret: string | undefined): CollabClient | undefined {
  if (!secret) return undefined;
  return {
    async renamePage(pageId, req) {
      let res: Response;
      try {
        res = await fetch(new URL(internalTitlePath(pageId), baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_SECRET_HEADER]: secret },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        throw new CollabUnavailable(`Collab-Server nicht erreichbar: ${err instanceof Error ? err.message : err}`);
      }
      if (res.status === 204) return 'ok';
      if (res.status === 404) return 'not-found';
      if (res.status === 409) return 'trashed';
      throw new CollabUnavailable(`Collab-Server antwortet mit ${res.status}`);
    },
  };
}
