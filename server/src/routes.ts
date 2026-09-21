import express from 'express';
import { db } from './db';
import { computeContinuity, mutateAndRecompute } from './logic';
import type { ComputedConflict } from './logic';

export const router = express.Router();

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ---------------- 基础工具 ---------------- */

function optStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function reqStr(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, `${label} 不能为空`);
  }
  return value;
}

function reqNum(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(400, `${label} 必须是数字`);
  }
  return value;
}

function optInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new ApiError(400, `${label} 必须是整数`);
}

function getEntityId(id: number): number {
  const row = db.prepare(`SELECT id FROM entities WHERE id = ?`).get(id) as
    | { id: number }
    | undefined;
  if (!row) throw new ApiError(404, '对象不存在');
  return id;
}

function getFieldId(id: number): { id: number; entity_id: number; name: string } {
  const row = db
    .prepare(`SELECT id, entity_id, name FROM fields WHERE id = ?`)
    .get(id) as { id: number; entity_id: number; name: string } | undefined;
  if (!row) throw new ApiError(404, '状态字段不存在');
  return row;
}

function getSceneId(id: number): number {
  const row = db.prepare(`SELECT id FROM scenes WHERE id = ?`).get(id) as
    | { id: number }
    | undefined;
  if (!row) throw new ApiError(404, '场景不存在');
  return id;
}

function fieldExists(fieldId: number, entityId?: number): void {
  const row = db
    .prepare(`SELECT entity_id FROM fields WHERE id = ?`)
    .get(fieldId) as { entity_id: number } | undefined;
  if (!row) throw new ApiError(400, `字段 ${fieldId} 不存在`);
  if (entityId !== undefined && row.entity_id !== entityId) {
    throw new ApiError(400, `字段 ${fieldId} 不属于该对象`);
  }
}

/* ---------------- DTO ---------------- */

interface FieldOut {
  id: number;
  entityId: number;
  name: string;
  defaultVal: string;
  sortOrder: number;
}

interface EntityOut {
  id: number;
  kind: 'character' | 'prop';
  name: string;
  note: string;
  fields: FieldOut[];
}

interface SceneRefOut {
  id: number;
  code: string;
  title: string;
  storyTime: number;
  sameOrder: number;
  shotOrder: number;
  note: string;
}

interface SnapshotOut {
  id: number;
  fieldId: number;
  expected: string;
}

interface ChangeOut {
  id: number;
  fieldId: number;
  newVal: string;
  note: string;
}

function fieldDTO(row: {
  id: number;
  entity_id: number;
  name: string;
  default_val: string;
  sort_order: number;
}): FieldOut {
  return {
    id: row.id,
    entityId: row.entity_id,
    name: row.name,
    defaultVal: row.default_val,
    sortOrder: row.sort_order,
  };
}

function entityDTO(id: number): EntityOut {
  const row = db
    .prepare(`SELECT id, kind, name, note FROM entities WHERE id = ?`)
    .get(id) as { id: number; kind: 'character' | 'prop'; name: string; note: string };
  const fields = db
    .prepare(
      `SELECT id, entity_id, name, default_val, sort_order
         FROM fields WHERE entity_id = ? ORDER BY sort_order, id`
    )
    .all(id) as Parameters<typeof fieldDTO>[0][];
  return { ...row, fields: fields.map(fieldDTO) };
}

type SceneOut = SceneRefOut & {
  snapshots: SnapshotOut[];
  changes: ChangeOut[];
};

function sceneDTO(id: number): SceneOut {
  const row = db
    .prepare(
      `SELECT id, code, title, story_time AS storyTime, same_order AS sameOrder,
              shot_order AS shotOrder, note FROM scenes WHERE id = ?`
    )
    .get(id) as SceneRefOut;
  const snapshots = db
    .prepare(
      `SELECT id, field_id AS fieldId, expected FROM snapshots
        WHERE scene_id = ? ORDER BY id`
    )
    .all(id) as SnapshotOut[];
  const changes = db
    .prepare(
      `SELECT id, field_id AS fieldId, new_val AS newVal, note FROM changes
        WHERE scene_id = ? ORDER BY id`
    )
    .all(id) as ChangeOut[];
  return { ...row, snapshots, changes };
}

/* ---------------- 输入解析 ---------------- */

interface SnapshotIn {
  fieldId: number;
  expected: string;
}

interface ChangeIn {
  fieldId: number;
  newVal: string;
  note?: string;
}

interface ScenePayload {
  code: string;
  title: string;
  storyTime: number;
  sameOrder: number;
  shotOrder: number;
  note: string;
  snapshots: SnapshotIn[];
  changes: ChangeIn[];
}

function parseSnapshots(value: unknown): SnapshotIn[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'snapshots 必须是数组');
  const seen = new Set<number>();
  return value.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new ApiError(400, `snapshots[${i}] 格式不正确`);
    }
    const obj = item as Record<string, unknown>;
    const fieldId = reqNum(obj.fieldId, `snapshots[${i}].fieldId`);
    if (!Number.isInteger(fieldId)) {
      throw new ApiError(400, `snapshots[${i}].fieldId 必须是整数`);
    }
    if (seen.has(fieldId)) {
      throw new ApiError(400, `snapshots[${i}] 字段重复：同一场景每个字段只能有一个期望值`);
    }
    seen.add(fieldId);
    fieldExists(fieldId);
    return { fieldId, expected: optStr(obj.expected) };
  });
}

function parseChanges(value: unknown): ChangeIn[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'changes 必须是数组');
  const seen = new Set<number>();
  return value.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new ApiError(400, `changes[${i}] 格式不正确`);
    }
    const obj = item as Record<string, unknown>;
    const fieldId = reqNum(obj.fieldId, `changes[${i}].fieldId`);
    if (!Number.isInteger(fieldId)) {
      throw new ApiError(400, `changes[${i}].fieldId 必须是整数`);
    }
    if (seen.has(fieldId)) {
      throw new ApiError(400, `changes[${i}] 字段重复：同一场景每个字段只能登记一条结束变更`);
    }
    seen.add(fieldId);
    fieldExists(fieldId);
    return {
      fieldId,
      newVal: optStr(obj.newVal),
      note: optStr(obj.note),
    };
  });
}

function parseScenePayload(body: unknown): ScenePayload {
  if (!body || typeof body !== 'object') throw new ApiError(400, '请求体格式不正确');
  const b = body as Record<string, unknown>;
  return {
    code: reqStr(b.code, '场景编号'),
    title: optStr(b.title),
    storyTime: reqNum(b.storyTime, '故事时间'),
    sameOrder: optInt(b.sameOrder, 0, '同刻序号'),
    shotOrder: optInt(b.shotOrder, 0, '拍摄序号'),
    note: optStr(b.note),
    snapshots: parseSnapshots(b.snapshots ?? []),
    changes: parseChanges(b.changes ?? []),
  };
}

/** 覆盖场景的快照与显式变更（新建场景时全量替换） */
function replaceSceneChildren(sceneId: number, p: ScenePayload): void {
  replaceSnapshots(sceneId, p.snapshots);
  replaceChanges(sceneId, p.changes);
}

function replaceSnapshots(sceneId: number, rows: SnapshotIn[]): void {
  db.prepare(`DELETE FROM snapshots WHERE scene_id = ?`).run(sceneId);
  const ins = db.prepare(
    `INSERT INTO snapshots (scene_id, field_id, expected) VALUES (?, ?, ?)`
  );
  for (const s of rows) ins.run(sceneId, s.fieldId, s.expected);
}

function replaceChanges(sceneId: number, rows: ChangeIn[]): void {
  db.prepare(`DELETE FROM changes WHERE scene_id = ?`).run(sceneId);
  const ins = db.prepare(
    `INSERT INTO changes (scene_id, field_id, new_val, note) VALUES (?, ?, ?, ?)`
  );
  for (const c of rows) ins.run(sceneId, c.fieldId, c.newVal, c.note ?? '');
}

/* ---------------- 对象 / 字段 ---------------- */

router.get('/entities', (_req, res) => {
  const entities = db
    .prepare(`SELECT id, kind, name, note FROM entities ORDER BY id`)
    .all() as Omit<EntityOut, 'fields'>[];
  res.json(entities.map((e) => entityDTO(e.id)));
});

router.post('/entities', (req, res) => {
  const b = req.body ?? {};
  const kind = b.kind === 'character' || b.kind === 'prop' ? b.kind : null;
  if (!kind) throw new ApiError(400, 'kind 必须是 character 或 prop');
  const name = reqStr(b.name, '名称');

  const result = mutateAndRecompute(() => {
    try {
      db.prepare(`INSERT INTO entities (kind, name, note) VALUES (?, ?, ?)`).run(
        kind,
        name,
        optStr(b.note)
      );
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, `已存在名为「${name}」的对象`);
      throw e;
    }
  });
  const id = db.prepare(`SELECT id FROM entities WHERE name = ?`).get(name) as {
    id: number;
  };
  res.status(201).json({ entity: entityDTO(id.id), recompute: summarize(result) });
});

router.patch('/entities/:id', (req, res) => {
  const id = getEntityId(Number(req.params.id));
  const b = req.body ?? {};
  const name = b.name === undefined ? undefined : reqStr(b.name, '名称');
  const kind =
    b.kind === undefined
      ? undefined
      : b.kind === 'character' || b.kind === 'prop'
        ? b.kind
        : (() => {
            throw new ApiError(400, 'kind 必须是 character 或 prop');
          })();

  const result = mutateAndRecompute(() => {
    const current = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as {
      kind: string;
      name: string;
      note: string;
    };
    try {
      db.prepare(
        `UPDATE entities SET kind = ?, name = ?, note = ? WHERE id = ?`
      ).run(kind ?? current.kind, name ?? current.name, optStr(b.note, current.note), id);
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, '已存在同名对象');
      throw e;
    }
  });
  res.json({ entity: entityDTO(id), recompute: summarize(result) });
});

router.delete('/entities/:id', (req, res) => {
  const id = getEntityId(Number(req.params.id));
  const result = mutateAndRecompute(() => {
    db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
  });
  res.json({ ok: true, recompute: summarize(result) });
});

router.post('/entities/:id/fields', (req, res) => {
  const entityId = getEntityId(Number(req.params.id));
  const b = req.body ?? {};
  const name = reqStr(b.name, '字段名称');
  const defaultVal = optStr(b.defaultVal);
  const maxOrder = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM fields WHERE entity_id = ?`)
    .get(entityId) as { m: number };
  const sortOrder = optInt(b.sortOrder, maxOrder.m + 1, '排序');

  const result = mutateAndRecompute(() => {
    try {
      db.prepare(
        `INSERT INTO fields (entity_id, name, default_val, sort_order)
         VALUES (?, ?, ?, ?)`
      ).run(entityId, name, defaultVal, sortOrder);
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, `该对象下已存在字段「${name}」`);
      throw e;
    }
  });
  res.status(201).json({ entity: entityDTO(entityId), recompute: summarize(result) });
});

router.patch('/fields/:id', (req, res) => {
  const field = getFieldId(Number(req.params.id));
  const b = req.body ?? {};
  const name = b.name === undefined ? undefined : reqStr(b.name, '字段名称');
  const defaultVal =
    b.defaultVal === undefined ? undefined : optStr(b.defaultVal);
  const sortOrder =
    b.sortOrder === undefined || b.sortOrder === null
      ? undefined
      : optInt(b.sortOrder, 0, '排序');

  const result = mutateAndRecompute(() => {
    const current = db
      .prepare(`SELECT name, default_val, sort_order FROM fields WHERE id = ?`)
      .get(field.id) as { name: string; default_val: string; sort_order: number };
    try {
      db.prepare(
        `UPDATE fields SET name = ?, default_val = ?, sort_order = ? WHERE id = ?`
      ).run(
        name ?? current.name,
        defaultVal ?? current.default_val,
        sortOrder ?? current.sort_order,
        field.id
      );
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, '该对象下已存在同名字段');
      throw e;
    }
  });
  res.json({ entity: entityDTO(field.entity_id), recompute: summarize(result) });
});

router.delete('/fields/:id', (req, res) => {
  const field = getFieldId(Number(req.params.id));
  const result = mutateAndRecompute(() => {
    db.prepare(`DELETE FROM fields WHERE id = ?`).run(field.id);
  });
  res.json({ ok: true, recompute: summarize(result) });
});

/* ---------------- 场景 ---------------- */

router.get('/scenes', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id FROM scenes ORDER BY story_time, same_order, shot_order, id`
    )
    .all() as { id: number }[];
  res.json(rows.map((r) => sceneDTO(r.id)));
});

router.post('/scenes', (req, res) => {
  const p = parseScenePayload(req.body);
  const result = mutateAndRecompute(() => {
    try {
      db.prepare(
        `INSERT INTO scenes (code, title, story_time, same_order, shot_order, note)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(p.code, p.title, p.storyTime, p.sameOrder, p.shotOrder, p.note);
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, `已存在场景编号「${p.code}」`);
      throw e;
    }
    const id = (
      db.prepare(`SELECT id FROM scenes WHERE code = ?`).get(p.code) as { id: number }
    ).id;
    replaceSceneChildren(id, p);
  });
  const id = (
    db.prepare(`SELECT id FROM scenes WHERE code = ?`).get(p.code) as { id: number }
  ).id;
  res.status(201).json({ scene: sceneDTO(id), recompute: summarize(result) });
});

router.patch('/scenes/:id', (req, res) => {
  const id = getSceneId(Number(req.params.id));
  const b = req.body ?? {};

  // 元信息（任一字段缺省即保持原值）
  const current = db.prepare(`SELECT * FROM scenes WHERE id = ?`).get(id) as {
    code: string;
    title: string;
    story_time: number;
    same_order: number;
    shot_order: number;
    note: string;
  };
  const code = b.code === undefined ? current.code : reqStr(b.code, '场景编号');
  const title = optStr(b.title, current.title);
  const storyTime =
    b.storyTime === undefined ? current.story_time : reqNum(b.storyTime, '故事时间');
  const sameOrder =
    b.sameOrder === undefined ? current.same_order : optInt(b.sameOrder, 0, '同刻序号');
  const shotOrder =
    b.shotOrder === undefined
      ? current.shot_order
      : optInt(b.shotOrder, 0, '拍摄序号');
  const note = optStr(b.note, current.note);

  const hasSnapshots = b.snapshots !== undefined;
  const hasChanges = b.changes !== undefined;
  const snapshots = parseSnapshots(b.snapshots ?? []);
  const changes = parseChanges(b.changes ?? []);

  const result = mutateAndRecompute(() => {
    try {
      db.prepare(
        `UPDATE scenes SET code = ?, title = ?, story_time = ?, same_order = ?,
               shot_order = ?, note = ? WHERE id = ?`
      ).run(code, title, storyTime, sameOrder, shotOrder, note, id);
    } catch (e) {
      if (isUniqueError(e)) throw new ApiError(409, `已存在场景编号「${code}」`);
      throw e;
    }
    // PATCH 只替换请求中显式给出的那一类，未给出的快照/变更保持不变
    if (hasSnapshots) replaceSnapshots(id, snapshots);
    if (hasChanges) replaceChanges(id, changes);
  });
  res.json({ scene: sceneDTO(id), recompute: summarize(result) });
});

router.delete('/scenes/:id', (req, res) => {
  const id = getSceneId(Number(req.params.id));
  const result = mutateAndRecompute(() => {
    db.prepare(`DELETE FROM scenes WHERE id = ?`).run(id);
  });
  res.json({ ok: true, recompute: summarize(result) });
});

/* ---------------- 时间线 / 冲突 ---------------- */

interface RecomputeSummary {
  conflictCount: number;
  sceneCount: number;
}

function summarize(result: {
  conflicts: ComputedConflict[];
  scenes: { id: number }[];
}): RecomputeSummary {
  return { conflictCount: result.conflicts.length, sceneCount: result.scenes.length };
}

/** 为冲突打上“该对象的首次分歧”标记（按故事顺序） */
function markFirst<T extends { entityId: number }>(items: T[]): (T & {
  first: boolean;
})[] {
  const seen = new Set<number>();
  return items.map((c) => {
    const first = !seen.has(c.entityId);
    if (first) seen.add(c.entityId);
    return { ...c, first };
  });
}

router.get('/timeline', (req, res) => {
  const entityFilter = req.query.entityId;
  let filterId: number | null = null;
  if (entityFilter !== undefined) {
    const id = Number(entityFilter);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, 'entityId 必须是正整数');
    }
    filterId = id;
  }

  const result = computeContinuity();
  const scenes = result.scenes.map((scene) => {
    const snapshots = (
      db
        .prepare(
          `SELECT id, field_id AS fieldId, expected FROM snapshots
            WHERE scene_id = ? ORDER BY id`
        )
        .all(scene.id) as SnapshotOut[]
    );
    const changes = db
      .prepare(
        `SELECT id, field_id AS fieldId, new_val AS newVal, note FROM changes
          WHERE scene_id = ? ORDER BY id`
      )
      .all(scene.id) as ChangeOut[];

    const before =
      filterId === null
        ? scene.before
        : scene.before.filter((s) => s.entityId === filterId);
    const conflicts = markFirst(
      scene.conflicts.filter((c) => filterId === null || c.entityId === filterId)
    );
    const changesOut = changes.filter((c) => {
      if (filterId === null) return true;
      return before.some((b) => b.fieldId === c.fieldId);
    });

    return {
      id: scene.id,
      code: scene.code,
      title: scene.title,
      storyTime: scene.storyTime,
      sameOrder: scene.sameOrder,
      shotOrder: scene.shotOrder,
      note: scene.note,
      before: before.map((b) => ({
        ...b,
        isExpected:
          snapshots.find((s) => s.fieldId === b.fieldId)?.expected === b.value,
      })),
      snapshots: snapshots.filter((s) =>
        filterId === null ? true : before.some((b) => b.fieldId === s.fieldId)
      ),
      changes: changesOut,
      conflicts,
    };
  });

  res.json({ scenes });
});

router.get('/conflicts', (req, res) => {
  const filter = req.query.entityId;
  let sql = `
    SELECT c.id, c.scene_id AS sceneId, s.code AS sceneCode, s.title AS sceneTitle,
           s.story_time AS storyTime, s.same_order AS sameOrder,
           c.field_id AS fieldId, c.entity_id AS entityId, c.entity_kind AS entityKind,
           c.entity_name AS entityName, c.field_name AS fieldName,
           c.expected_val AS expectedVal, c.actual_val AS actualVal,
           c.source_scene_id AS sourceSceneId, c.source_scene_code AS sourceSceneCode,
           c.source_type AS sourceType
      FROM conflicts c
      JOIN scenes s ON s.id = c.scene_id
  `;
  const params: unknown[] = [];
  if (filter !== undefined) {
    const id = Number(filter);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, 'entityId 必须是正整数');
    }
    sql += ` WHERE c.entity_id = ?`;
    params.push(id);
  }
  // 按故事顺序排列，保证“首次分歧”标记稳定
  sql += ` ORDER BY s.story_time, s.same_order, s.shot_order, s.id, c.id`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  res.json({ conflicts: markFirst(rows as unknown as { entityId: number }[]) });
});

/* ---------------- 错误处理 ---------------- */

function isUniqueError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

router.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(400).json({ error: '请求体不是合法的 JSON' });
    return;
  }
  console.error('[api] 未处理错误：', err);
  res.status(500).json({ error: '服务器内部错误' });
});
