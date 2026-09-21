import type { Conflict, Entity, Scene, TimelineScene } from './types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(data?.error ?? `请求失败（${res.status}）`);
  }
  return data as T;
}

export interface ScenePayload {
  code?: string;
  title?: string;
  storyTime?: number;
  sameOrder?: number;
  shotOrder?: number;
  note?: string;
  snapshots?: { fieldId: number; expected: string }[];
  changes?: { fieldId: number; newVal: string; note: string }[];
}

export const api = {
  listEntities: () => request<Entity[]>('GET', '/api/entities'),
  createEntity: (body: { kind: string; name: string; note?: string }) =>
    request<{ entity: Entity }>('POST', '/api/entities', body),
  updateEntity: (id: number, body: Record<string, unknown>) =>
    request<{ entity: Entity }>('PATCH', `/api/entities/${id}`, body),
  deleteEntity: (id: number) =>
    request<{ ok: boolean }>('DELETE', `/api/entities/${id}`),

  addField: (
    entityId: number,
    body: { name: string; defaultVal: string }
  ) =>
    request<{ entity: Entity }>(
      'POST',
      `/api/entities/${entityId}/fields`,
      body
    ),
  updateField: (fieldId: number, body: Record<string, unknown>) =>
    request<{ entity: Entity }>('PATCH', `/api/fields/${fieldId}`, body),
  deleteField: (fieldId: number) =>
    request<{ ok: boolean }>('DELETE', `/api/fields/${fieldId}`),

  listScenes: () => request<Scene[]>('GET', '/api/scenes'),
  createScene: (body: ScenePayload) =>
    request<{ scene: Scene }>('POST', '/api/scenes', body),
  updateScene: (id: number, body: ScenePayload) =>
    request<{ scene: Scene }>('PATCH', `/api/scenes/${id}`, body),
  deleteScene: (id: number) =>
    request<{ ok: boolean }>('DELETE', `/api/scenes/${id}`),

  timeline: (entityId?: number) =>
    request<{ scenes: TimelineScene[] }>(
      'GET',
      `/api/timeline${entityId ? `?entityId=${entityId}` : ''}`
    ),
  conflicts: (entityId?: number) =>
    request<{ conflicts: Conflict[] }>(
      'GET',
      `/api/conflicts${entityId ? `?entityId=${entityId}` : ''}`
    ),
};
