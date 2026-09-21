export type EntityKind = 'character' | 'prop';

export interface Field {
  id: number;
  entityId: number;
  name: string;
  defaultVal: string;
  sortOrder: number;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  note: string;
  fields: Field[];
}

export interface Snapshot {
  id?: number;
  fieldId: number;
  expected: string;
}

export interface Change {
  id?: number;
  fieldId: number;
  newVal: string;
  note: string;
}

export interface Scene {
  id: number;
  code: string;
  title: string;
  storyTime: number;
  sameOrder: number;
  shotOrder: number;
  note: string;
  snapshots: Snapshot[];
  changes: Change[];
}

export type SourceType = 'default' | 'snapshot' | 'change';

export interface Conflict {
  id?: number;
  sceneId: number;
  sceneCode?: string;
  sceneTitle?: string;
  storyTime?: number;
  sameOrder?: number;
  fieldId: number;
  entityId: number;
  entityKind: EntityKind;
  entityName: string;
  fieldName: string;
  expectedVal: string;
  actualVal: string;
  sourceSceneId: number | null;
  sourceSceneCode: string;
  sourceType: SourceType;
  first: boolean;
}

export interface BeforeState {
  fieldId: number;
  entityId: number;
  entityKind: EntityKind;
  entityName: string;
  fieldName: string;
  value: string;
  sourceType: SourceType;
  sourceSceneId: number | null;
  sourceSceneCode: string;
  isExpected: boolean;
}

export interface TimelineScene {
  id: number;
  code: string;
  title: string;
  storyTime: number;
  sameOrder: number;
  shotOrder: number;
  note: string;
  before: BeforeState[];
  snapshots: Snapshot[];
  changes: Change[];
  conflicts: Conflict[];
}
