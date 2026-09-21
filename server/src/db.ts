import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config';

// 打开数据库前确保数据目录存在（首次启动即自动初始化）
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new BetterSqlite3(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL CHECK (kind IN ('character', 'prop')),
      name       TEXT NOT NULL UNIQUE,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fields (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id    INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      default_val  TEXT NOT NULL DEFAULT '',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      UNIQUE (entity_id, name)
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL DEFAULT '',
      story_time    REAL NOT NULL,
      same_order    INTEGER NOT NULL DEFAULT 0,
      shot_order    INTEGER NOT NULL DEFAULT 0,
      note          TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id    INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      field_id    INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      expected    TEXT NOT NULL,
      UNIQUE (scene_id, field_id)
    );

    CREATE TABLE IF NOT EXISTS changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id    INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      field_id    INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      new_val     TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      UNIQUE (scene_id, field_id)
    );

    -- 冲突为派生数据：每次变更事务内整体重算并覆盖
    CREATE TABLE IF NOT EXISTS conflicts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id           INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      field_id           INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      entity_id          INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_kind        TEXT NOT NULL,
      entity_name        TEXT NOT NULL,
      field_name         TEXT NOT NULL,
      expected_val       TEXT NOT NULL,
      actual_val         TEXT NOT NULL,
      source_scene_id    INTEGER,
      source_scene_code  TEXT NOT NULL DEFAULT '',
      source_type        TEXT NOT NULL DEFAULT 'default'
    );

    CREATE INDEX IF NOT EXISTS idx_fields_entity ON fields(entity_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_order ON scenes(story_time, same_order, shot_order, id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_scene ON snapshots(scene_id);
    CREATE INDEX IF NOT EXISTS idx_changes_scene ON changes(scene_id);
    CREATE INDEX IF NOT EXISTS idx_conflicts_entity ON conflicts(entity_id);
    CREATE INDEX IF NOT EXISTS idx_conflicts_scene ON conflicts(scene_id);
  `);
}
