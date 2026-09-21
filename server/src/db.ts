import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'continuity.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'character',  -- 'character' | 'prop'
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entity_fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id     INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      field_key     TEXT NOT NULL,
      label         TEXT NOT NULL,
      initial_value TEXT NOT NULL DEFAULT '',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      UNIQUE (entity_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      story_time  TEXT NOT NULL,               -- 故事时间，可排序字符串，如 'D01 21:00'
      seq         INTEGER NOT NULL DEFAULT 0,  -- 同刻序号：同一故事时间内的先后
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 期望快照：某场景开拍前，某对象某字段应有的值
    CREATE TABLE IF NOT EXISTS snapshots (
      scene_id       INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      entity_id      INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      field_key      TEXT NOT NULL,
      expected_value TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (scene_id, entity_id, field_key)
    );

    -- 显式状态变更：某场景结束后生效
    CREATE TABLE IF NOT EXISTS changes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id  INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      value     TEXT NOT NULL DEFAULT '',
      note      TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_scenes_order   ON scenes (story_time, seq, id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_scene ON snapshots (scene_id);
    CREATE INDEX IF NOT EXISTS idx_changes_scene  ON changes (scene_id);
    CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes (entity_id);
  `);
}

/** 首次启动时写入一份演示数据（含两处刻意制造的连续性冲突），便于打开即见效果。 */
export function seedIfEmpty(): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number };
  if (row.n > 0) return;

  const seed = db.transaction(() => {
    const insEntity = db.prepare(
      'INSERT INTO entities (name, kind, description) VALUES (?, ?, ?)'
    );
    const insField = db.prepare(
      'INSERT INTO entity_fields (entity_id, field_key, label, initial_value, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    const insScene = db.prepare(
      'INSERT INTO scenes (title, story_time, seq, description) VALUES (?, ?, ?, ?)'
    );
    const insSnap = db.prepare(
      'INSERT INTO snapshots (scene_id, entity_id, field_key, expected_value) VALUES (?, ?, ?, ?)'
    );
    const insChange = db.prepare(
      'INSERT INTO changes (scene_id, entity_id, field_key, value, note) VALUES (?, ?, ?, ?, ?)'
    );

    const lin = insEntity.run('林雪', 'character', '女主角').lastInsertRowid as number;
    insField.run(lin, 'costume', '服装', '蓝色风衣', 1);
    insField.run(lin, 'left_hand', '左手伤势', '无', 2);
    insField.run(lin, 'mood', '情绪', '平静', 3);

    const chen = insEntity.run('陈默', 'character', '男主角').lastInsertRowid as number;
    insField.run(chen, 'costume', '服装', '灰色西装', 1);
    insField.run(chen, 'glasses', '眼镜', '戴着', 2);

    const watch = insEntity.run('旧怀表', 'prop', '关键道具').lastInsertRowid as number;
    insField.run(watch, 'lid', '表盖', '合上', 1);
    insField.run(watch, 'hands', '指针', '停在 3:07', 2);

    const s1 = insScene.run('雨夜公寓', 'D01 21:00', 1, '林雪独自回到公寓').lastInsertRowid as number;
    insSnap.run(s1, lin, 'costume', '蓝色风衣');
    insSnap.run(s1, watch, 'lid', '合上');
    insChange.run(s1, watch, 'lid', '打开', '林雪打开怀表看照片');
    insChange.run(s1, lin, 'mood', '崩溃', '看到照片后情绪崩溃');

    const s2 = insScene.run('医院走廊', 'D02 08:30', 1, '次日清晨').lastInsertRowid as number;
    insSnap.run(s2, lin, 'costume', '蓝色风衣');
    insSnap.run(s2, lin, 'left_hand', '无');
    insSnap.run(s2, watch, 'lid', '打开');
    insChange.run(s2, lin, 'left_hand', '包扎', '摔倒被玻璃划伤');
    insChange.run(s2, watch, 'hands', '停在 4:15', '怀表被摔，指针走动后停住');

    const s3 = insScene.run('天台对峙', 'D02 18:00', 1, '两人摊牌').lastInsertRowid as number;
    insSnap.run(s3, lin, 'left_hand', '包扎');
    insSnap.run(s3, chen, 'glasses', '戴着');
    // 刻意的冲突：上一场已把指针改为 4:15，这里仍按旧剧本写 3:07
    insSnap.run(s3, watch, 'hands', '停在 3:07');
    insChange.run(s3, chen, 'glasses', '摘下', '陈默摘下眼镜');

    const s4 = insScene.run('码头告别', 'D03 06:00', 1, '清晨告别').lastInsertRowid as number;
    insSnap.run(s4, chen, 'glasses', '摘下');
    // 刻意的冲突：林雪情绪自 S1 起为「崩溃」，此处快照误写「平静」
    insSnap.run(s4, lin, 'mood', '平静');
    insChange.run(s4, watch, 'lid', '合上', '林雪合上怀表放进兜里');
  });

  seed();
  console.log('[db] 已写入演示数据（设置 SEED_DEMO=0 可关闭）');
}
