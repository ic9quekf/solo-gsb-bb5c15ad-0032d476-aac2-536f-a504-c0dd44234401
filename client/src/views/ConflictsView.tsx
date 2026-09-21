import { useMemo, useState } from 'react';
import type { Conflict, Entity } from '../types';

interface Props {
  entities: Entity[];
  conflicts: Conflict[];
  onJumpScene: (sceneId: number) => void;
}

export default function ConflictsView({ entities, conflicts, onJumpScene }: Props) {
  const [entityId, setEntityId] = useState<number | ''>('');
  const filtered = useMemo(
    () => (entityId === '' ? conflicts : conflicts.filter((c) => c.entityId === entityId)),
    [conflicts, entityId]
  );

  // 按对象分组，保持故事顺序
  const groups = new Map<number, { entity: Entity; rows: Conflict[] }>();
  for (const c of filtered) {
    const entity = entities.find((e) => e.id === c.entityId);
    if (!entity) continue;
    if (!groups.has(entity.id)) groups.set(entity.id, { entity, rows: [] });
    groups.get(entity.id)!.rows.push(c);
  }

  return (
    <div className="view">
      <section className="panel">
        <h2>连续性冲突列表</h2>
        <p className="muted">
          冲突由系统在每次增删改或调整顺序后整体重算得出。「首次分歧」标出每个对象在故事时间线上最早出错的场次；
          其后续场次的级联分歧也一并列出，便于判断真正该改哪一条。
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
          <span className={filtered.length ? 'conflict-count' : 'ok-count'}>
            {filtered.length > 0 ? `${filtered.length} 处分歧` : '全部连续，无分歧'}
          </span>
        </div>
      </section>

      {[...groups.values()].map(({ entity, rows }) => (
        <section className="panel conflict-group" key={entity.id}>
          <h3>
            <span className={`kind-tag ${entity.kind}`}>
              {entity.kind === 'character' ? '角色' : '道具'}
            </span>
            {entity.name}
            <span className="muted small">（{rows.length} 处分歧）</span>
          </h3>
          <table className="conflict-table">
            <thead>
              <tr>
                <th>标记</th>
                <th>发现分歧的场景</th>
                <th>字段</th>
                <th>期望快照</th>
                <th>开拍前推导值</th>
                <th>分歧来源</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={`${c.sceneId}-${c.fieldId}`} className={c.first ? 'first-row' : ''}>
                  <td>
                    {c.first && <span className="first-badge">首次分歧</span>}
                    {!c.first && <span className="cascade-tag">级联 #{i + 1}</span>}
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => onJumpScene(c.sceneId)}>
                      {c.sceneCode}
                    </button>
                    {c.sceneTitle ? ` ${c.sceneTitle}` : ''}
                    <div className="muted small">
                      故事时间 {c.storyTime}
                      {c.sameOrder ? ` · 同刻 #${c.sameOrder}` : ''}
                    </div>
                  </td>
                  <td>{c.fieldName}</td>
                  <td className="val-expect">{c.expectedVal || '（空）'}</td>
                  <td className="val-actual">{c.actualVal || '（空）'}</td>
                  <td>
                    {c.sourceType === 'default' ? (
                      '字段初始默认值'
                    ) : (
                      <button
                        className="link-btn"
                        onClick={() => c.sourceSceneId && onJumpScene(c.sourceSceneId)}
                      >
                        {c.sourceSceneCode || `#${c.sourceSceneId}`} 的结束变更
                      </button>
                    )}
                  </td>
                  <td>
                    <button className="ghost" onClick={() => onJumpScene(c.sceneId)}>
                      修正
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {filtered.length === 0 && (
        <div className="panel empty ok-empty">
          ✓ 当前筛选下没有连续性冲突。调整顺序或修改变更后，系统会立即重新核对。
        </div>
      )}
    </div>
  );
}
