import { useCallback, useEffect, useState } from 'react';
import { api, type ContinuityReport, type Entity, type Scene } from './api';
import { EntitiesPanel } from './components/EntitiesPanel';
import { ScenesPanel } from './components/ScenesPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { ConflictsPanel } from './components/ConflictsPanel';

type Tab = 'timeline' | 'conflicts' | 'scenes' | 'entities';

const TABS: { key: Tab; label: string }[] = [
  { key: 'timeline', label: '故事时间线' },
  { key: 'conflicts', label: '冲突列表' },
  { key: 'scenes', label: '场景管理' },
  { key: 'entities', label: '对象与字段' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('timeline');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [report, setReport] = useState<ContinuityReport | null>(null);
  const [filterEntity, setFilterEntity] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // 任何新增/修改/删除后调用：服务端现算，前端整体刷新 => 自动重算
  const reload = useCallback(async () => {
    try {
      const [e, s, r] = await Promise.all([api.listEntities(), api.listScenes(), api.continuity()]);
      setEntities(e);
      setScenes(s);
      setReport(r);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reload]
  );

  const conflictCount = report?.conflicts.length ?? 0;
  const firstCount = report?.conflicts.filter((c) => c.firstDivergence).length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🎬</span>
          <div>
            <h1>短片场记 · 连续性校验</h1>
            <p className="muted">非线性拍摄 · 按故事时间重放状态变更 · 逐字段比对期望快照</p>
          </div>
        </div>
        <div className="topbar-right">
          <label className="filter">
            按对象筛选
            <select value={filterEntity} onChange={(e) => setFilterEntity(Number(e.target.value))}>
              <option value={0}>全部对象</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind === 'character' ? '👤' : '📦'} {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="stat-badges">
            <span className={`badge ${conflictCount ? 'badge-danger' : 'badge-ok'}`}>
              冲突 {conflictCount}
            </span>
            <span className={`badge ${firstCount ? 'badge-warn' : 'badge-ok'}`}>
              首次分歧 {firstCount}
            </span>
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'conflicts' && conflictCount > 0 && (
              <span className="tab-count">{conflictCount}</span>
            )}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error-bar" onClick={() => setError('')}>
          ⚠ {error}（点击关闭）
        </div>
      )}

      <main className="content">
        {loading ? (
          <p className="muted">加载中…</p>
        ) : tab === 'timeline' ? (
          <TimelinePanel report={report} filterEntity={filterEntity} />
        ) : tab === 'conflicts' ? (
          <ConflictsPanel report={report} filterEntity={filterEntity} />
        ) : tab === 'scenes' ? (
          <ScenesPanel scenes={scenes} entities={entities} run={run} />
        ) : (
          <EntitiesPanel entities={entities} run={run} />
        )}
      </main>
    </div>
  );
}
