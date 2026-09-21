import { useMemo, useState } from 'react';
import type { Entity, TimelineScene } from '../types';

interface Props {
  entities: Entity[];
  timeline: TimelineScene[];
  onJumpScene: (sceneId: number) => void;
}

export default function TimelineView({ entities, timeline, onJumpScene }: Props) {
  const [entityId, setEntityId] = useState<number | ''>('');
  const filterId = entityId === '' ? null : entityId;

  const filtered = useMemo(
    () =>
      filterId === null
        ? timeline
        : timeline.map((s) => ({
            ...s,
            before: s.before.filter((b) => b.entityId === filterId),
            snapshots: s.snapshots.filter((sn) =>
              s.before.some((b) => b.fieldId === sn.fieldId)
            ),
            changes: s.changes.filter((c) =>
              s.before.some((b) => b.fieldId === c.fieldId)
            ),
            conflicts: s.conflicts.filter((c) => c.entityId === filterId),
          })),
    [timeline, filterId]
  );

  const totalConflicts = filtered.reduce((n, s) => n + s.conflicts.length, 0);

  return (
    <div className="view">
      <section className="panel">
        <h2>故事时间线（重放视图）</h2>
        <p className="muted">
          按 <b>故事时间 → 同刻序号</b> 重放，与实际拍摄顺序无关。每个场景卡片展示开拍前推导状态、
          本场结束后的变更，以及分歧标记。
        </p>
        <div className="filter-bar">
          <label>
            按对象筛选：
            <select
              value={entityId}
              onChange={(e) =>
                setEntityId(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">全部对象</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind === 'character' ? '角色' : '道具'}·{e.name}
                </option>
              ))}
            </select>
          </label>
          <span className={totalConflicts ? 'conflict-count' : 'ok-count'}>
            {totalConflicts > 0 ? `当前筛选下 ${totalConflicts} 处分歧` : '当前筛选下无分歧'}
          </span>
        </div>
      </section>

      <div className="timeline">
        {filtered.map((scene, idx) => (
          <TimelineCard
            key={scene.id}
            scene={scene}
            isLast={idx === filtered.length - 1}
            onJumpScene={onJumpScene}
          />
        ))}
        {filtered.length === 0 && (
          <div className="panel empty">还没有场景。前往「场景登记」创建第一个场景。</div>
        )}
      </div>
    </div>
  );
}

function TimelineCard({
  scene,
  isLast,
  onJumpScene,
}: {
  scene: TimelineScene;
  isLast: boolean;
  onJumpScene: (sceneId: number) => void;
}) {
  // 按对象分组展示开拍前状态
  const groups = new Map<string, { kind: string; name: string; rows: typeof scene.before }>();
  for (const b of scene.before) {
    const key = `${b.entityId}`;
    if (!groups.has(key))
      groups.set(key, { kind: b.entityKind, name: b.entityName, rows: [] });
    groups.get(key)!.rows.push(b);
  }
  const expectedByField = new Map(scene.snapshots.map((s) => [s.fieldId, s.expected]));

  return (
    <div className="tl-item">
      <div className="tl-rail">
        <div className={`tl-node ${scene.conflicts.length ? 'conflict' : ''}`}>
          {scene.conflicts.length ? '!' : '✓'}
        </div>
        {!isLast && <div className="tl-line" />}
      </div>
      <div className="panel tl-card">
        <div className="tl-head">
          <span className="scene-code">{scene.code}</span>
          <span className="scene-title">{scene.title || '（未命名场景）'}</span>
          <span className="order-tag">
            故事时间 {scene.storyTime}
            {scene.sameOrder > 0 ? ` · 同刻 #${scene.sameOrder}` : ''} · 拍摄 #{scene.shotOrder}
          </span>
          {scene.conflicts.length > 0 && (
            <span className="conflict-tag">{scene.conflicts.length} 处分歧</span>
          )}
          <button className="ghost" onClick={() => onJumpScene(scene.id)}>
            编辑 →
          </button>
        </div>
        {scene.note && <div className="muted small scene-note">{scene.note}</div>}

        {scene.conflicts.length > 0 && (
          <div className="conflict-banner">
            {scene.conflicts.map((c) => (
              <div
                key={`${c.sceneId}-${c.fieldId}`}
                className="conflict-line"
                onClick={() => onJumpScene(c.sceneId)}
              >
                <b>{c.entityName}·{c.fieldName}</b>：期望「{c.expectedVal || '空'}」，
                开拍前实际推导为「{c.actualVal || '空'}」
                <em>
                  分歧来源：
                  {c.sourceType === 'default'
                    ? '字段初始默认值'
                    : `场景 ${c.sourceSceneCode || '#' + (c.sourceSceneId ?? '')} 的结束变更`}
                </em>
                {c.first && <span className="first-badge">该对象首次分歧</span>}
              </div>
            ))}
          </div>
        )}

        <div className="state-groups">
          {[...groups.values()].map((g) => (
            <div className="state-group" key={g.name}>
              <div className="state-group-head">
                <span className={`kind-tag ${g.kind}`}>
                  {g.kind === 'character' ? '角色' : '道具'}
                </span>
                {g.name}
              </div>
              <div className="chip-wrap">
                {g.rows.map((b) => {
                  const hasExpect = expectedByField.has(b.fieldId);
                  return (
                    <span
                      key={b.fieldId}
                      className={`state-chip ${hasExpect ? (b.isExpected ? 'ok' : 'mismatch') : 'neutral'}`}
                      title={
                        b.sourceType === 'default'
                          ? '来自字段初始默认值'
                          : `来自场景 ${b.sourceSceneCode} 结束时的变更`
                      }
                    >
                      <b>{b.fieldName}</b> = {b.value || '（空）'}
                      {hasExpect && (
                        <em className={`expect ${b.isExpected ? '' : 'bad'}`}>
                          期望 {expectedByField.get(b.fieldId) || '（空）'}
                        </em>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {scene.changes.length > 0 && (
          <div className="changes-box">
            <span className="changes-label">拍完变为 →</span>
            {scene.changes.map((ch) => {
              const b = scene.before.find((x) => x.fieldId === ch.fieldId);
              return (
                <span className="change-chip" key={ch.fieldId}>
                  {b ? `${b.entityName}·${b.fieldName}` : `字段#${ch.fieldId}`}
                  ：{b?.value || '（空）'} → <b>{ch.newVal || '（空）'}</b>
                  {ch.note && <em className="chg-note">（{ch.note}）</em>}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
