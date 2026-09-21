import { Router, type Request, type Response } from 'express';
import { db } from './db.js';
import { computeContinuity } from './engine.js';

export const api = Router();

/* ---------------------------------- 工具 ---------------------------------- */

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

function requireStr(v: unknown, name: string, max = 200): string {
  const s = str(v);
  if (!s) throw new HttpError(400, `${name} 不能为空`);
  if (s.length > max) throw new HttpError(400, `${name} 过长（>${max}）`);
  return s;
}

function idParam(req: Request, name = 'id'): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '非法的 id');
  return id;
}

/** 包装同步路由，统一错误处理 */
const h =
  (fn: (req: Request, res: Response) => void) =>
  (req: Request, res: Response): void => {
    try {
      fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message });
      } else {
        console.error(e);
        res.status(500).json({ error: '服务器内部错误' });
      }
    }
  };

/* --------------------------------- 序列化 --------------------------------- */

interface EntityRow {
  id: number;
  name: string;
  kind: string;
  description: string;
}
interface FieldRow {
  id: number;
  entity_id: number;
  field_key: string;
  label: string;
  initial_value: string;
  sort_order: number;
}
interface SceneRow {
  id: number;
  title: string;
  story_time: string;
  seq: number;
  description: string;
}

function entityDto(row: EntityRow) {
  const fields = db
    .prepare('SELECT * FROM entity_fields WHERE entity_id = ? ORDER BY sort_order, id')
    .all(row.id) as unknown as FieldRow[];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    fields: fields.map((f) => ({
      id: f.id,
      entityId: f.entity_id,
      key: f.field_key,
      label: f.label,
      initialValue: f.initial_value,
      sortOrder: f.sort_order,
    })),
  };
}

function sceneDto(row: SceneRow) {
  const snapshots = db
    .prepare('SELECT * FROM snapshots WHERE scene_id = ?')
    .all(row.id) as unknown as {
    entity_id: number;
    field_key: string;
    expected_value: string;
  }[];
  const changes = db
    .prepare('SELECT * FROM changes WHERE scene_id = ? ORDER BY id')
    .all(row.id) as unknown as {
    id: number;
    entity_id: number;
    field_key: string;
    value: string;
    note: string;
  }[];
  return {
    id: row.id,
    title: row.title,
    storyTime: row.story_time,
    seq: row.seq,
    description: row.description,
    snapshots: snapshots.map((s) => ({
      entityId: s.entity_id,
      fieldKey: s.field_key,
      expectedValue: s.expected_value,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      entityId: c.entity_id,
      fieldKey: c.field_key,
      value: c.value,
      note: c.note,
    })),
  };
}

/* ------------------------------ 对象与状态字段 ----------------------------- */

api.get(
  '/entities',
  h((_req, res) => {
    const rows = db
      .prepare('SELECT * FROM entities ORDER BY id')
      .all() as unknown as EntityRow[];
    res.json(rows.map(entityDto));
  })
);

interface FieldInput {
  id?: number;
  key: string;
  label: string;
  initialValue: string;
}

function parseFields(raw: unknown): FieldInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'fields 必须是数组');
  const seen = new Set<string>();
  return raw.map((f, i) => {
    const key = requireStr((f as Record<string, unknown>).key, `字段[${i}].key`, 50);
    if (seen.has(key)) throw new HttpError(400, `字段 key 重复：${key}`);
    seen.add(key);
    return {
      id: num((f as Record<string, unknown>).id, 0) || undefined,
      key,
      label: requireStr((f as Record<string, unknown>).label, `字段[${i}].label`, 50),
      initialValue: str((f as Record<string, unknown>).initialValue).slice(0, 200),
    };
  });
}

function parseEntityBody(req: Request) {
  const kind = str(req.body?.kind) || 'character';
  if (kind !== 'character' && kind !== 'prop') {
    throw new HttpError(400, "kind 只能是 'character' 或 'prop'");
  }
  return {
    name: requireStr(req.body?.name, '对象名称'),
    kind,
    description: str(req.body?.description).slice(0, 500),
    fields: parseFields(req.body?.fields ?? []),
  };
}

api.post(
  '/entities',
  h((req, res) => {
    const body = parseEntityBody(req);
    const created = db.transaction(() => {
      const id = db
        .prepare('INSERT INTO entities (name, kind, description) VALUES (?, ?, ?)')
        .run(body.name, body.kind, body.description).lastInsertRowid as number;
      const ins = db.prepare(
        'INSERT INTO entity_fields (entity_id, field_key, label, initial_value, sort_order) VALUES (?, ?, ?, ?, ?)'
      );
      body.fields.forEach((f, i) => ins.run(id, f.key, f.label, f.initialValue, i + 1));
      return id;
    })();
    const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(created) as EntityRow;
    res.status(201).json(entityDto(row));
  })
);

api.put(
  '/entities/:id',
  h((req, res) => {
    const id = idParam(req);
    const body = parseEntityBody(req);
    db.transaction(() => {
      const r = db
        .prepare('UPDATE entities SET name = ?, kind = ?, description = ? WHERE id = ?')
        .run(body.name, body.kind, body.description, id);
      if (r.changes === 0) throw new HttpError(404, '对象不存在');

      const existing = db
        .prepare('SELECT * FROM entity_fields WHERE entity_id = ?')
        .all(id) as unknown as FieldRow[];
      const byId = new Map(existing.map((f) => [f.id, f]));
      const keepIds = new Set(body.fields.filter((f) => f.id).map((f) => f.id as number));

      // 删除被移除的字段，并清理其快照与变更记录
      for (const old of existing) {
        if (!keepIds.has(old.id)) {
          db.prepare('DELETE FROM snapshots WHERE entity_id = ? AND field_key = ?').run(id, old.field_key);
          db.prepare('DELETE FROM changes WHERE entity_id = ? AND field_key = ?').run(id, old.field_key);
          db.prepare('DELETE FROM entity_fields WHERE id = ?').run(old.id);
        }
      }

      body.fields.forEach((f, i) => {
        if (f.id && byId.has(f.id)) {
          const old = byId.get(f.id)!;
          if (old.field_key !== f.key) {
            // key 变更时同步迁移历史数据
            db.prepare('UPDATE snapshots SET field_key = ? WHERE entity_id = ? AND field_key = ?').run(f.key, id, old.field_key);
            db.prepare('UPDATE changes SET field_key = ? WHERE entity_id = ? AND field_key = ?').run(f.key, id, old.field_key);
          }
          db.prepare(
            'UPDATE entity_fields SET field_key = ?, label = ?, initial_value = ?, sort_order = ? WHERE id = ?'
          ).run(f.key, f.label, f.initialValue, i + 1, f.id);
        } else {
          db.prepare(
            'INSERT INTO entity_fields (entity_id, field_key, label, initial_value, sort_order) VALUES (?, ?, ?, ?, ?)'
          ).run(id, f.key, f.label, f.initialValue, i + 1);
        }
      });
    })();
    const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow;
    res.json(entityDto(row));
  })
);

api.delete(
  '/entities/:id',
  h((req, res) => {
    const id = idParam(req);
    const r = db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    if (r.changes === 0) throw new HttpError(404, '对象不存在');
    res.json({ ok: true });
  })
);

/* --------------------------------- 场景 --------------------------------- */

function parseSceneBody(req: Request) {
  return {
    title: requireStr(req.body?.title, '场景标题'),
    storyTime: requireStr(req.body?.storyTime, '故事时间', 50),
    seq: num(req.body?.seq, 0),
    description: str(req.body?.description).slice(0, 500),
  };
}

api.get(
  '/scenes',
  h((_req, res) => {
    const rows = db
      .prepare('SELECT * FROM scenes ORDER BY story_time ASC, seq ASC, id ASC')
      .all() as unknown as SceneRow[];
    res.json(rows.map(sceneDto));
  })
);

api.post(
  '/scenes',
  h((req, res) => {
    const b = parseSceneBody(req);
    const id = db
      .prepare('INSERT INTO scenes (title, story_time, seq, description) VALUES (?, ?, ?, ?)')
      .run(b.title, b.storyTime, b.seq, b.description).lastInsertRowid as number;
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow;
    res.status(201).json(sceneDto(row));
  })
);

api.put(
  '/scenes/:id',
  h((req, res) => {
    const id = idParam(req);
    const b = parseSceneBody(req);
    const r = db
      .prepare('UPDATE scenes SET title = ?, story_time = ?, seq = ?, description = ? WHERE id = ?')
      .run(b.title, b.storyTime, b.seq, b.description, id);
    if (r.changes === 0) throw new HttpError(404, '场景不存在');
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow;
    res.json(sceneDto(row));
  })
);

api.delete(
  '/scenes/:id',
  h((req, res) => {
    const id = idParam(req);
    const r = db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
    if (r.changes === 0) throw new HttpError(404, '场景不存在');
    res.json({ ok: true });
  })
);

interface SnapshotEntryInput {
  entityId: number;
  fieldKey: string;
  expectedValue: string;
}

/** 整体替换某场景的期望快照（空字符串视为「不校验」，不入库） */
api.put(
  '/scenes/:id/snapshot',
  h((req, res) => {
    const id = idParam(req);
    const entries = (Array.isArray(req.body?.entries) ? req.body.entries : []) as Record<
      string,
      unknown
    >[];
    db.transaction(() => {
      const exists = db.prepare('SELECT id FROM scenes WHERE id = ?').get(id);
      if (!exists) throw new HttpError(404, '场景不存在');
      db.prepare('DELETE FROM snapshots WHERE scene_id = ?').run(id);
      const ins = db.prepare(
        'INSERT INTO snapshots (scene_id, entity_id, field_key, expected_value) VALUES (?, ?, ?, ?)'
      );
      for (const e of entries) {
        const entityId = num(e.entityId);
        const fieldKey = str(e.fieldKey);
        const expectedValue = str(e.expectedValue);
        if (!entityId || !fieldKey || expectedValue === '') continue;
        ins.run(id, entityId, fieldKey, expectedValue.slice(0, 200));
      }
    })();
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow;
    res.json(sceneDto(row));
  })
);

/** 整体替换某场景结束后的显式变更列表 */
api.put(
  '/scenes/:id/changes',
  h((req, res) => {
    const id = idParam(req);
    const entries = (Array.isArray(req.body?.entries) ? req.body.entries : []) as Record<
      string,
      unknown
    >[];
    db.transaction(() => {
      const exists = db.prepare('SELECT id FROM scenes WHERE id = ?').get(id);
      if (!exists) throw new HttpError(404, '场景不存在');
      db.prepare('DELETE FROM changes WHERE scene_id = ?').run(id);
      const ins = db.prepare(
        'INSERT INTO changes (scene_id, entity_id, field_key, value, note) VALUES (?, ?, ?, ?, ?)'
      );
      for (const e of entries) {
        const entityId = num(e.entityId);
        const fieldKey = str(e.fieldKey);
        if (!entityId || !fieldKey) continue;
        ins.run(id, entityId, fieldKey, str(e.value).slice(0, 200), str(e.note).slice(0, 200));
      }
    })();
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow;
    res.json(sceneDto(row));
  })
);

/* ------------------------------ 连续性校验结果 ----------------------------- */

api.get(
  '/continuity',
  h((req, res) => {
    const report = computeContinuity();
    const entityId = num(req.query.entityId, 0);
    if (entityId > 0) {
      res.json({
        ...report,
        timeline: report.timeline.map((t) => ({
          ...t,
          checks: t.checks.filter((c) => c.entityId === entityId),
          changes: t.changes.filter((c) => c.entityId === entityId),
          conflictCount: t.checks.filter((c) => c.entityId === entityId && !c.match).length,
        })),
        conflicts: report.conflicts.filter((c) => c.entityId === entityId),
      });
      return;
    }
    res.json(report);
  })
);
