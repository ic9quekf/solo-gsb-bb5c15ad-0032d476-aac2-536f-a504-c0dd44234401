import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Conflict, Entity, Scene, TimelineScene } from './types';
import EntitiesView from './views/EntitiesView';
import ScenesView from './views/ScenesView';
import TimelineView from './views/TimelineView';
import ConflictsView from './views/ConflictsView';

export type Tab = 'entities' | 'scenes' | 'timeline' | 'conflicts';

export default function App() {
  const [tab, setTab] = useState<Tab>('timeline');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [timeline, setTimeline] = useState<TimelineScene[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [highlightScene, setHighlightScene] = useState<number | null>(null);
  const [toast, setToast] = useState('');

  const refreshAll = useCallback(async () => {
    try {
      const [es, ss, tl, cf] = await Promise.all([
        api.listEntities(),
        api.listScenes(),
        api.timeline(),
        api.conflicts(),
      ]);
      setEntities(es);
      setScenes(ss);
      setTimeline(tl.scenes);
      setConflicts(cf.conflicts);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }, []);

  const jumpToScene = useCallback((sceneId: number) => {
    setHighlightScene(sceneId);
    setTab('scenes');
    window.setTimeout(() => {
      document
        .getElementById(`scene-${sceneId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, []);

  const conflictCount = conflicts.length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎬 场记连续性校验台</div>
        <nav className="tabs">
          <button
            className={tab === 'timeline' ? 'active' : ''}
            onClick={() => setTab('timeline')}
          >
            故事时间线
          </button>
          <button
            className={tab === 'conflicts' ? 'active' : ''}
            onClick={() => setTab('conflicts')}
          >
            冲突列表
            {conflictCount > 0 && <span className="badge">{conflictCount}</span>}
          </button>
          <button
            className={tab === 'scenes' ? 'active' : ''}
            onClick={() => setTab('scenes')}
          >
            场景登记
          </button>
          <button
            className={tab === 'entities' ? 'active' : ''}
            onClick={() => setTab('entities')}
          >
            对象与状态字段
          </button>
        </nav>
      </header>

      <main className="content">
        {loading && <div className="hint">正在加载…</div>}
        {error && <div className="error-banner">加载失败：{error}</div>}
        {!loading && !error && (
          <>
            {tab === 'entities' && (
              <EntitiesView
                entities={entities}
                onChange={refreshAll}
                notify={notify}
              />
            )}
            {tab === 'scenes' && (
              <ScenesView
                entities={entities}
                scenes={scenes}
                timeline={timeline}
                highlightScene={highlightScene}
                onChange={refreshAll}
                notify={notify}
              />
            )}
            {tab === 'timeline' && (
              <TimelineView
                entities={entities}
                timeline={timeline}
                onJumpScene={jumpToScene}
              />
            )}
            {tab === 'conflicts' && (
              <ConflictsView
                entities={entities}
                conflicts={conflicts}
                onJumpScene={jumpToScene}
              />
            )}
          </>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
