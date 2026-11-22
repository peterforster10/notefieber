// Zugriff auf die API (gleiche Adresse, /api wird weitergeleitet). Die Sitzung steckt im
// Cookie nf_session; der Browser schickt es selbst mit. Next.js bleibt reine Oberfläche:
// alle Daten und Regeln kommen aus der API.
'use client';

import { useQuery } from '@tanstack/react-query';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  // Fehlerantworten müssen kein JSON sein (z. B. 502 vom Proxy, wenn die API nicht läuft)
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    if (res.ok) throw new ApiError(res.status, 'Unerwartete Antwort der API');
    data = undefined;
  }
  if (!res.ok) {
    const message = data?.message ?? (res.status === 403 ? 'Dafür fehlen die Rechte.' : `Fehler ${res.status}`);
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export type Role = 'viewer' | 'commenter' | 'editor' | 'admin';
export const canEdit = (role: Role | null | undefined) => role === 'editor' || role === 'admin';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  orgRole: string;
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
const retry = (count: number, err: Error) => !(err instanceof ApiError && err.status < 500) && count < 2;

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
