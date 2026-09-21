import { db } from './db';

/** 重放规则所依赖的最小行结构 */
export interface FieldRow {
  id: number;
  entity_id: number;
  name: string;
  default_val: string;
  sort_order: number;
}

interface EntityRow {
  id: number;
  kind: 'character' | 'prop';
  name: string;
}

interface SceneRow {
  id: number;
  code: string;
  title: string;
  story_time: number;
  same_order: number;
  shot_order: number;
  note: string;
}

export interface SnapshotRow {
  id: number;
  scene_id: number;
  field_id: number;
  expected: string;
}

export interface ChangeRow {
  id: number;
  scene_id: number;
  field_id: number;
  new_val: string;
  note: string;
}

/** 场景开始前某字段的取值来源 */
export type SourceType = 'default' | 'snapshot' | 'change';

interface ValSource {
  val: string;
  type: SourceType;
  /** 产生当前取值的场景（默认值来源时为 null） */
  sceneId: number | null;
}

export interface ComputedConflict {
  sceneId: number;
  fieldId: number;
  entityId: number;
  entityKind: 'character' | 'prop';
  entityName: string;
  fieldName: string;
  expectedVal: string;
  actualVal: string;
  sourceSceneId: number | null;
  sourceSceneCode: string;
  sourceType: SourceType;
}

export interface DerivedFieldState {
  fieldId: number;
  entityId: number;
  entityKind: 'character' | 'prop';
  entityName: string;
  fieldName: string;
  value: string;
  sourceType: SourceType;
  sourceSceneId: number | null;
  sourceSceneCode: string;
}

export interface ComputedScene {
  id: number;
  code: string;
  title: string;
  storyTime: number;
  sameOrder: number;
  shotOrder: number;
  note: string;
  /** 本场开拍前对每个字段的推导状态（按对象/字段排序） */
  before: DerivedFieldState[];
  conflicts: ComputedConflict[];
}

export interface ContinuityResult {
  scenes: ComputedScene[];
  conflicts: ComputedConflict[];
}

/**
 * 按故事时间线重放：
 *   1. 场景依 (story_time, same_order, shot_order, id) 排列，同刻序号保证同一时刻的先后；
 *   2. 每个场景先以“开拍前推导状态”比对期望快照（只比对登记了期望的字段）；
 *   3. 比对完成后再应用本场结束时登记的显式变更，供后续场景使用。
 * 期望快照本身不会写回推导状态——它只代表“开拍时应有的样子”；
 * 若某场没有变更，则后续场景继续沿用此前的取值。
 */
export function computeContinuity(): ContinuityResult {
  const entities = db
    .prepare(`SELECT id, kind, name FROM entities ORDER BY id`)
    .all() as EntityRow[];
  const entityById = new Map(entities.map((e) => [e.id, e]));

  const fields = db
    .prepare(
      `SELECT id, entity_id, name, default_val, sort_order
         FROM fields ORDER BY entity_id, sort_order, id`
    )
    .all() as FieldRow[];
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  const scenes = db
    .prepare(
      `SELECT id, code, title, story_time, same_order, shot_order, note
         FROM scenes ORDER BY story_time, same_order, shot_order, id`
    )
    .all() as SceneRow[];

  const snapshots = db
    .prepare(`SELECT id, scene_id, field_id, expected FROM snapshots`)
    .all() as SnapshotRow[];
  const changes = db
    .prepare(`SELECT id, scene_id, field_id, new_val, note FROM changes`)
    .all() as ChangeRow[];

  const snapshotsByScene = new Map<number, SnapshotRow[]>();
  for (const s of snapshots) {
    pushInto(snapshotsByScene, s.scene_id, s);
  }
  const changesByScene = new Map<number, ChangeRow[]>();
  for (const c of changes) {
    pushInto(changesByScene, c.scene_id, c);
  }

  // 每个字段的当前取值与来源，初始来自字段默认值
  const state = new Map<number, ValSource>();
  for (const f of fields) {
    state.set(f.id, { val: f.default_val, type: 'default', sceneId: null });
  }

  const sceneCodeById = new Map(scenes.map((s) => [s.id, s.code]));
  const allConflicts: ComputedConflict[] = [];
  const computedScenes: ComputedScene[] = [];

  const describeState = (): DerivedFieldState[] =>
    fields.map((f) => {
      const src = state.get(f.id)!;
      const e = entityById.get(f.entity_id)!;
      return {
        fieldId: f.id,
        entityId: f.entity_id,
        entityKind: e.kind,
        entityName: e.name,
        fieldName: f.name,
        value: src.val,
        sourceType: src.type,
        sourceSceneId: src.sceneId,
        sourceSceneCode: src.sceneId === null ? '' : sceneCodeById.get(src.sceneId) ?? '',
      };
    });

  for (const scene of scenes) {
    // 1) 开拍前比对期望快照 —— 记录首次分歧
    for (const snap of snapshotsByScene.get(scene.id) ?? []) {
      const field = fieldById.get(snap.field_id);
      if (!field) continue; // 已被删除的字段（理论上被外键级联拦截）
      const src = state.get(snap.field_id);
      const actual = src ? src.val : field.default_val;
      if (actual !== snap.expected) {
        const entity = entityById.get(field.entity_id)!;
        allConflicts.push({
          sceneId: scene.id,
          fieldId: field.id,
          entityId: entity.id,
          entityKind: entity.kind,
          entityName: entity.name,
          fieldName: field.name,
          expectedVal: snap.expected,
          actualVal: actual,
          sourceSceneId: src?.sceneId ?? null,
          sourceSceneCode:
            src && src.sceneId !== null ? sceneCodeById.get(src.sceneId) ?? '' : '',
          sourceType: src?.type ?? 'default',
        });
      }
    }

    computedScenes.push({
      id: scene.id,
      code: scene.code,
      title: scene.title,
      storyTime: scene.story_time,
      sameOrder: scene.same_order,
      shotOrder: scene.shot_order,
      note: scene.note,
      before: describeState(),
      conflicts: [], // 下面统一回填
    });

    // 2) 场景结束后应用显式变更
    for (const ch of changesByScene.get(scene.id) ?? []) {
      if (!fieldById.has(ch.field_id)) continue;
      state.set(ch.field_id, { val: ch.new_val, type: 'change', sceneId: scene.id });
    }
  }

  const conflictsByScene = new Map<number, ComputedConflict[]>();
  for (const c of allConflicts) {
    pushInto(conflictsByScene, c.sceneId, c);
  }
  for (const cs of computedScenes) {
    cs.conflicts = conflictsByScene.get(cs.id) ?? [];
  }

  return { scenes: computedScenes, conflicts: allConflicts };
}

/**
 * 在单个事务内执行写入并整体重算，覆盖 conflicts 表。
 * 任何写入失败都会连同重算一起回滚，保证冲突列表始终与当前数据一致。
 */
export function mutateAndRecompute(mutate: () => void): ContinuityResult {
  const tx = db.transaction((): ContinuityResult => {
    mutate();
    db.prepare(`DELETE FROM conflicts`).run();

    const result = computeContinuity();
    const insert = db.prepare(
      `INSERT INTO conflicts
         (scene_id, field_id, entity_id, entity_kind, entity_name, field_name,
          expected_val, actual_val, source_scene_id, source_scene_code, source_type)
       VALUES
         (@scene_id, @field_id, @entity_id, @entity_kind, @entity_name, @field_name,
          @expected_val, @actual_val, @source_scene_id, @source_scene_code, @source_type)`
    );
    for (const c of result.conflicts) {
      insert.run({
        scene_id: c.sceneId,
        field_id: c.fieldId,
        entity_id: c.entityId,
        entity_kind: c.entityKind,
        entity_name: c.entityName,
        field_name: c.fieldName,
        expected_val: c.expectedVal,
        actual_val: c.actualVal,
        source_scene_id: c.sourceSceneId,
        source_scene_code: c.sourceSceneCode,
        source_type: c.sourceType,
      });
    }
    return result;
  });
  return tx();
}

function pushInto<T>(map: Map<number, T[]>, key: number, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
