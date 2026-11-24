// Zugriff auf die API (gleiche Adresse, /api wird weitergeleitet). Die Sitzung steckt im
// Cookie nf_session; der Browser schickt es selbst mit. Next.js bleibt reine Oberfläche:
// alle Daten und Regeln kommen aus der API.
'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Fehler der API. Angezeigt wird nie message (deutsch, für Logs), sondern der übersetzte Text zu
 * code bzw. kind (useErrorText in lib/errors.ts, Texte unter errors in apps/web/messages/).
 */
export class ApiError extends Error {
  /** HTTP-Status; 0 = keine Verbindung zur API */
  status: number;
  /** Art des Fehlers aus der Antwort (error: forbidden, rejected …) */
  kind?: string;
  /** Genaue Regel, falls die API sie kennt (code: home_page_not_deletable …) */
  code?: string;
  constructor(status: number, kind?: string, code?: string, message?: string) {
    super(message ?? code ?? kind ?? `HTTP ${status}`);
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

/** Antwortkörper der API im Fehlerfall */
export interface ApiErrorBody {
  error?: string;
  code?: string;
  message?: string;
}
export const apiError = (status: number, body: ApiErrorBody | undefined) =>
  new ApiError(status, body?.error, body?.code, body?.message);

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  // Fehlerantworten müssen kein JSON sein (z. B. 502 vom Proxy, wenn die API nicht läuft)
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    if (res.ok) throw new ApiError(res.status, 'unexpected');
    data = undefined;
  }
  if (!res.ok) throw apiError(res.status, data);
  return data as T;
}

export type Role = 'viewer' | 'commenter' | 'editor' | 'admin';
export const canEdit = (role: Role | null | undefined) => role === 'editor' || role === 'admin';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  orgRole: string;
  /** Sprache der Oberfläche aus dem Profil (users.locale) */
  locale: string;
  tenant: { id: string; slug: string; name: string };
}
export interface Space {
  id: string;
  key: string;
  name: string;
  description: string | null;
  homePageId: string | null;
  archived: boolean;
  role: Role | null;
  /** Darf archivieren und zurückholen (im archivierten Space ist role höchstens viewer) */
  canManage: boolean;
}
/** Eine Seite in einer Ebene des Seitenbaums (GET /spaces/:key/pages?parent=…) */
export interface TreePage {
  id: string;
  parentId: string | null;
  position: string;
  title: string;
  restricted: boolean;
  role: Role | null;
  /** In der Ebene darunter steht mindestens eine Seite */
  hasChildren: boolean;
}
export interface PageDetails {
  id: string;
  spaceKey: string;
  parentId: string | null;
  title: string;
  restricted: boolean;
  trashed: boolean;
  role: Role | null;
  breadcrumb: { id: string; title: string }[];
}
export interface TrashedPage {
  id: string;
  title: string;
  deletedAt: string;
}

// Keine Wiederholung bei 401/403/404: Das ist eine Antwort, kein Ausfall.
const retry = (count: number, err: Error) =>
  !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    retry,
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
export const useSpaces = (enabled = true) =>
  useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces'), enabled, retry });
// Schlüssel für den Zwischenspeicher. Der Space-Schlüssel steht in Adressen klein (entw), in der
// API groß (ENTW); hier immer groß, damit Laden und Auffrischen (invalidateQueries) zusammenpassen.
export const queryKeys = {
  space: (key: string) => ['space', key.toUpperCase()] as const,
  /** Präfix aller geladenen Ebenen eines Spaces: Invalidieren frischt den ganzen Baum auf */
  tree: (key: string) => ['tree', key.toUpperCase()] as const,
  treeLevel: (key: string, parentId: string | null) => ['tree', key.toUpperCase(), parentId ?? 'root'] as const,
  trash: (key: string) => ['trash', key.toUpperCase()] as const,
  pages: ['page'] as const,
};

export const useSpace = (key: string) =>
  useQuery({ queryKey: queryKeys.space(key), queryFn: () => api<Space>(`/spaces/${key}`), retry });
/** Eine Ebene des Seitenbaums: Seiten, deren nächste sichtbare Vorfahrin parentId ist (null = oberste Ebene) */
export const useTreeLevel = (key: string, parentId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.treeLevel(key, parentId),
    queryFn: () => api<TreePage[]>(`/spaces/${key}/pages${parentId ? `?parent=${parentId}` : ''}`),
    enabled,
    retry,
  });
export const useTrash = (key: string) =>
  useQuery({ queryKey: queryKeys.trash(key), queryFn: () => api<TrashedPage[]>(`/spaces/${key}/trash`), retry });
export const usePage = (id: string | undefined) =>
  useQuery({
    queryKey: [...queryKeys.pages, id],
    queryFn: () => api<PageDetails>(`/pages/${id}`),
    enabled: !!id,
    retry,
  });
