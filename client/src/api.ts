/* ---------------------------- 与后端共享的数据类型 ---------------------------- */

export interface EntityField {
  id: number;
  entityId: number;
  key: string;
  label: string;
  initialValue: string;
  sortOrder: number;
}

export interface Entity {
  id: number;
  name: string;
  kind: 'character' | 'prop';
  description: string;
  fields: EntityField[];
}

export interface SnapshotEntry {
  entityId: number;
  fieldKey: string;
  expectedValue: string;
}

export interface ChangeEntry {
  id: number;
  entityId: number;
  fieldKey: string;
  value: string;
  note: string;
}

export interface Scene {
  id: number;
  title: string;
  storyTime: string;
  seq: number;
  description: string;
  snapshots: SnapshotEntry[];
  changes: ChangeEntry[];
}

export interface SourceRef {
  sceneId: number | null;
  sceneTitle: string;
  storyTime: string;
  seq: number;
}

export interface Check {
  entityId: number;
  entityName: string;
  entityKind: string;
  fieldKey: string;
  fieldLabel: string;
  expected: string;
  actual: string;
  match: boolean;
  source: SourceRef;
}

export interface AppliedChange {
  entityId: number;
  entityName: string;
  fieldKey: string;
  fieldLabel: string;
  before: string;
  value: string;
  note: string;
}

export interface TimelineItem {
  scene: {
    id: number;
    title: string;
    storyTime: string;
    seq: number;
    description: string;
  };
  checks: Check[];
  changes: AppliedChange[];
  conflictCount: number;
}

export interface Conflict extends Check {
  sceneId: number;
  sceneTitle: string;
  storyTime: string;
  seq: number;
  firstDivergence: boolean;
}

export interface ContinuityReport {
  generatedAt: string;
  timeline: TimelineItem[];
  conflicts: Conflict[];
}

/* --------------------------------- 请求封装 --------------------------------- */

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface EntityPayload {
  name: string;
  kind: string;
  description: string;
  fields: { id?: number; key: string; label: string; initialValue: string }[];
}

export interface ScenePayload {
  title: string;
  storyTime: string;
  seq: number;
  description: string;
}

export const api = {
  listEntities: () => req<Entity[]>('/api/entities'),
  createEntity: (p: EntityPayload) =>
    req<Entity>('/api/entities', { method: 'POST', body: JSON.stringify(p) }),
  updateEntity: (id: number, p: EntityPayload) =>
    req<Entity>(`/api/entities/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  deleteEntity: (id: number) => req<{ ok: true }>(`/api/entities/${id}`, { method: 'DELETE' }),

  listScenes: () => req<Scene[]>('/api/scenes'),
  createScene: (p: ScenePayload) =>
    req<Scene>('/api/scenes', { method: 'POST', body: JSON.stringify(p) }),
  updateScene: (id: number, p: ScenePayload) =>
    req<Scene>(`/api/scenes/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  deleteScene: (id: number) => req<{ ok: true }>(`/api/scenes/${id}`, { method: 'DELETE' }),

  saveSnapshot: (id: number, entries: SnapshotEntry[]) =>
    req<Scene>(`/api/scenes/${id}/snapshot`, { method: 'PUT', body: JSON.stringify({ entries }) }),
  saveChanges: (id: number, entries: Omit<ChangeEntry, 'id'>[]) =>
    req<Scene>(`/api/scenes/${id}/changes`, { method: 'PUT', body: JSON.stringify({ entries }) }),

  continuity: (entityId?: number) =>
    req<ContinuityReport>(`/api/continuity${entityId ? `?entityId=${entityId}` : ''}`),
};
