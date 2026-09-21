import { useEffect, useMemo, useState } from 'react';
import { api, type ScenePayload } from '../api';
import type { BeforeState, Change, Entity, Scene, Snapshot } from '../types';

interface Props {
  entities: Entity[];
  scene: Scene;
  beforeStates: BeforeState[];
  highlight: boolean;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
  onDelete: () => void;
}

interface SnapDraft {
  fieldId: number;
  expected: string;
}
interface ChangeDraft {
  fieldId: number;
  newVal: string;
  note: string;
}

export default function SceneCard({
  entities,
  scene,
  beforeStates,
  highlight,
  onChange,
  notify,
  onDelete,
}: Props) {
  const allFields = useMemo(
    () =>
      entities.flatMap((e) =>
        e.fields.map((f) => ({
          fieldId: f.id,
          label: `${e.kind === 'character' ? '角色' : '道具'}·${e.name} / ${f.name}`,
          entityName: e.name,
          fieldName: f.name,
          defaultVal: f.defaultVal,
        }))
      ),
    [entities]
  );
  const fieldLabel = (id: number) =>
    allFields.find((f) => f.fieldId === id)?.label ?? `字段#${id}`;

  return (
    <section className={`panel scene-card ${highlight ? 'highlight' : ''}`} id={`scene-${scene.id}`}>
      <SceneMeta scene={scene} onChange={onChange} notify={notify} onDelete={onDelete} />

      <div className="derived-box">
        <h3>开拍前推导状态（重放前序变更得出）</h3>
        {beforeStates.length === 0 ? (
          <div className="muted small">暂无可显示的字段。</div>
        ) : (
          <div className="chip-wrap">
            {beforeStates.map((b) => (
              <span
                key={b.fieldId}
                className={`state-chip ${b.isExpected ? 'ok' : ''}`}
                title={sourceText(b)}
              >
                <b>{b.entityName}·{b.fieldName}</b> = {b.value || '（空）'}
                <em className="src">
                  {b.sourceType === 'default'
                    ? '初始值'
                    : `源自 ${b.sourceSceneCode || '#' + (b.sourceSceneId ?? '')}`}
                </em>
              </span>
            ))}
          </div>
        )}
      </div>

      <SnapshotEditor
        title="开拍期望快照"
        hint="登记本场开拍时每个需要盯的字段应该是什么值。系统会把上面的推导值与此处逐字段比对，只比对登记了的字段。"
        scene={scene}
        fields={allFields}
        beforeStates={beforeStates}
        fieldLabel={fieldLabel}
        onChange={onChange}
        notify={notify}
      />

      <ChangeEditor
        scene={scene}
        fields={allFields}
        fieldLabel={fieldLabel}
        onChange={onChange}
        notify={notify}
      />
    </section>
  );
}

function sourceText(b: BeforeState): string {
  if (b.sourceType === 'default') return '取值来自字段初始默认值';
  return `取值由场景 ${b.sourceSceneCode || '#' + (b.sourceSceneId ?? '')} 结束时的变更产生`;
}

/* ---------------- 场景元信息 ---------------- */

function SceneMeta({
  scene,
  onChange,
  notify,
  onDelete,
}: {
  scene: Scene;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
  onDelete: () => void;
}) {
  const [meta, setMeta] = useState({
    code: scene.code,
    title: scene.title,
    storyTime: String(scene.storyTime),
    sameOrder: String(scene.sameOrder),
    shotOrder: String(scene.shotOrder),
    note: scene.note,
  });

  useEffect(() => {
    setMeta({
      code: scene.code,
      title: scene.title,
      storyTime: String(scene.storyTime),
      sameOrder: String(scene.sameOrder),
      shotOrder: String(scene.shotOrder),
      note: scene.note,
    });
  }, [scene]);

  const dirty =
    meta.code !== scene.code ||
    meta.title !== scene.title ||
    meta.storyTime !== String(scene.storyTime) ||
    meta.sameOrder !== String(scene.sameOrder) ||
    meta.shotOrder !== String(scene.shotOrder) ||
    meta.note !== scene.note;

  async function save() {
    if (!meta.code.trim()) return alert('场景编号不能为空');
    const body: ScenePayload = {
      code: meta.code.trim(),
      title: meta.title,
      storyTime: Number(meta.storyTime),
      sameOrder: Number(meta.sameOrder),
      shotOrder: Number(meta.shotOrder),
      note: meta.note,
    };
    try {
      await api.updateScene(scene.id, body);
      await onChange();
      notify('场景信息已保存，顺序变化已自动重算');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="scene-meta">
      <div className="scene-meta-row">
        <input
          className="meta-code"
          value={meta.code}
          onChange={(e) => setMeta({ ...meta, code: e.target.value })}
        />
        <input
          className="meta-title"
          placeholder="场景标题"
          value={meta.title}
          onChange={(e) => setMeta({ ...meta, title: e.target.value })}
        />
        <button className="ghost danger" onClick={onDelete}>
          删除场景
        </button>
      </div>
      <div className="scene-meta-row">
        <label>
          故事时间
          <input
            type="number"
            value={meta.storyTime}
            onChange={(e) => setMeta({ ...meta, storyTime: e.target.value })}
          />
        </label>
        <label>
          同刻序号
          <input
            type="number"
            min={0}
            value={meta.sameOrder}
            onChange={(e) => setMeta({ ...meta, sameOrder: e.target.value })}
          />
        </label>
        <label>
          拍摄序号
          <input
            type="number"
            min={0}
            value={meta.shotOrder}
            onChange={(e) => setMeta({ ...meta, shotOrder: e.target.value })}
          />
        </label>
        <input
          className="meta-note"
          placeholder="备注（可选）"
          value={meta.note}
          onChange={(e) => setMeta({ ...meta, note: e.target.value })}
        />
        <button disabled={!dirty} className="primary" onClick={save}>
          保存信息
        </button>
      </div>
    </div>
  );
}

/* ---------------- 期望快照编辑 ---------------- */

function SnapshotEditor({
  title,
  hint,
  scene,
  fields,
  beforeStates,
  fieldLabel,
  onChange,
  notify,
}: {
  title: string;
  hint: string;
  scene: Scene;
  fields: { fieldId: number; label: string; defaultVal: string }[];
  beforeStates: BeforeState[];
  fieldLabel: (id: number) => string;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const seed = (): SnapDraft[] =>
    scene.snapshots.map((s: Snapshot) => ({
      fieldId: s.fieldId,
      expected: s.expected,
    }));
  const [rows, setRows] = useState<SnapDraft[]>(seed);
  useEffect(() => setRows(seed()), [scene]);

  const signature = (rs: { fieldId: number; expected: string }[]) =>
    JSON.stringify([...rs].sort((a, b) => a.fieldId - b.fieldId).map((r) => [r.fieldId, r.expected]));
  const dirty = signature(rows) !== signature(scene.snapshots);

  const derived = new Map(beforeStates.map((b) => [b.fieldId, b.value]));
  const usedFields = new Set(rows.map((r) => r.fieldId));

  async function save() {
    const ids = rows.map((r) => r.fieldId);
    if (new Set(ids).size !== ids.length) return alert('同一字段只能登记一个期望值');
    try {
      await api.updateScene(scene.id, {
        snapshots: rows.map((r) => ({ fieldId: r.fieldId, expected: r.expected })),
      });
      await onChange();
      notify('期望快照已保存，已重新比对');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="editor-block">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      <div className="rows">
        {rows.map((row, idx) => {
          const dVal = derived.get(row.fieldId);
          const mismatch = dVal !== undefined && dVal !== row.expected;
          return (
            <div className={`edit-row ${mismatch ? 'mismatch' : ''}`} key={idx}>
              <select
                value={row.fieldId}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...row, fieldId: Number(e.target.value) };
                  setRows(next);
                }}
              >
                {fields.map((f) => (
                  <option key={f.fieldId} value={f.fieldId}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                placeholder="期望值"
                value={row.expected}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...row, expected: e.target.value };
                  setRows(next);
                }}
              />
              <span className={`live-check ${mismatch ? 'bad' : 'good'}`}>
                {dVal === undefined
                  ? ''
                  : mismatch
                    ? `推导值「${dVal || '空'}」≠ 期望`
                    : '与推导值一致'}
              </span>
              <button
                className="ghost danger"
                onClick={() => setRows(rows.filter((_, i) => i !== idx))}
              >
                移除
              </button>
            </div>
          );
        })}
      </div>
      <div className="row-actions-block">
        <button
          onClick={() => {
            const next = fields.find((f) => !usedFields.has(f.fieldId));
            if (next) setRows([...rows, { fieldId: next.fieldId, expected: '' }]);
          }}
          disabled={usedFields.size >= fields.length}
        >
          + 添加期望字段
        </button>
        <button className="primary" disabled={!dirty} onClick={save}>
          保存快照
        </button>
      </div>
      {fields.length === 0 && (
        <div className="muted small">请先在「对象与状态字段」页建立字段。</div>
      )}
    </div>
  );
}

/* ---------------- 结束变更编辑 ---------------- */

function ChangeEditor({
  scene,
  fields,
  fieldLabel,
  onChange,
  notify,
}: {
  scene: Scene;
  fields: { fieldId: number; label: string; defaultVal: string }[];
  fieldLabel: (id: number) => string;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const seed = (): ChangeDraft[] =>
    scene.changes.map((c: Change) => ({
      fieldId: c.fieldId,
      newVal: c.newVal,
      note: c.note,
    }));
  const [rows, setRows] = useState<ChangeDraft[]>(seed);
  useEffect(() => setRows(seed()), [scene]);

  const signature = (rs: { fieldId: number; newVal: string; note: string }[]) =>
    JSON.stringify(
      [...rs].sort((a, b) => a.fieldId - b.fieldId).map((r) => [r.fieldId, r.newVal, r.note])
    );
  const dirty = signature(rows) !== signature(scene.changes);

  const usedFields = new Set(rows.map((r) => r.fieldId));

  async function save() {
    const ids = rows.map((r) => r.fieldId);
    if (new Set(ids).size !== ids.length)
      return alert('同一字段只能登记一条结束变更');
    try {
      await api.updateScene(scene.id, {
        changes: rows.map((r) => ({
          fieldId: r.fieldId,
          newVal: r.newVal,
          note: r.note,
        })),
      });
      await onChange();
      notify('结束变更已保存，后续场景已自动重算');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="editor-block">
      <h3>场景结束后的显式状态变更</h3>
      <p className="muted small">
        本场拍完后状态发生了什么变化（换服装、道具易手、伤口出现…）。
        变更在本场比对完成后才生效，只影响故事时间线上排在后面的场景。
      </p>
      <div className="rows">
        {rows.map((row, idx) => (
          <div className="edit-row" key={idx}>
            <select
              value={row.fieldId}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, fieldId: Number(e.target.value) };
                setRows(next);
              }}
            >
              {fields.map((f) => (
                <option key={f.fieldId} value={f.fieldId}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              placeholder="新状态"
              value={row.newVal}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, newVal: e.target.value };
                setRows(next);
              }}
            />
            <input
              className="note-input"
              placeholder="备注（可选）"
              value={row.note}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, note: e.target.value };
                setRows(next);
              }}
            />
            <button
              className="ghost danger"
              onClick={() => setRows(rows.filter((_, i) => i !== idx))}
            >
              移除
            </button>
          </div>
        ))}
      </div>
      <div className="row-actions-block">
        <button
          onClick={() => {
            const next = fields.find((f) => !usedFields.has(f.fieldId));
            if (next) setRows([...rows, { fieldId: next.fieldId, newVal: '', note: '' }]);
          }}
          disabled={usedFields.size >= fields.length}
        >
          + 添加变更字段
        </button>
        <button className="primary" disabled={!dirty} onClick={save}>
          保存变更
        </button>
      </div>
      {fields.length === 0 && (
        <div className="muted small">请先在「对象与状态字段」页建立字段。</div>
      )}
    </div>
  );
}
