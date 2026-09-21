import { useEffect, useMemo, useState } from 'react';
import { api, type ScenePayload } from '../api';
import type { Entity, Scene, TimelineScene } from '../types';
import SceneCard from './SceneCard';

interface Props {
  entities: Entity[];
  scenes: Scene[];
  timeline: TimelineScene[];
  highlightScene: number | null;
  onChange: () => Promise<void>;
  notify: (msg: string) => void;
}

export default function ScenesView({
  entities,
  scenes,
  timeline,
  highlightScene,
  onChange,
  notify,
}: Props) {
  const [openId, setOpenId] = useState<number | 'new' | null>(null);

  // 数据异步加载完成后，默认打开第一场（或从冲突跳转指定的场次）
  useEffect(() => {
    if (openId === null && scenes.length > 0) {
      setOpenId(scenes[0].id);
    }
  }, [scenes, openId]);

  const conflictCountByScene = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of timeline) m.set(s.id, s.conflicts.length);
    return m;
  }, [timeline]);

  // 列表按拍摄序号排列：场记登记页关注“实际拍了什么”
  const shotOrdered = useMemo(
    () => [...scenes].sort((a, b) => a.shotOrder - b.shotOrder || a.id - b.id),
    [scenes]
  );

  const [draft, setDraft] = useState({
    code: '',
    title: '',
    storyTime: '10',
    sameOrder: '0',
    shotOrder: String((scenes[scenes.length - 1]?.shotOrder ?? 0) + 1),
  });

  async function createScene() {
    const code = draft.code.trim();
    if (!code) return alert('请填写场景编号');
    const body: ScenePayload = {
      code,
      title: draft.title,
      storyTime: Number(draft.storyTime),
      sameOrder: Number(draft.sameOrder),
      shotOrder: Number(draft.shotOrder),
      note: '',
      snapshots: [],
      changes: [],
    };
    try {
      const { scene } = await api.createScene(body);
      await onChange();
      setDraft({
        code: '',
        title: '',
        storyTime: draft.storyTime,
        sameOrder: '0',
        shotOrder: String(Number(draft.shotOrder) + 1),
      });
      setOpenId(scene.id);
      notify('场景已创建');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeScene(scene: Scene) {
    if (!confirm(`删除场景「${scene.code} ${scene.title}」及其快照与变更？`)) return;
    try {
      await api.deleteScene(scene.id);
      await onChange();
      notify('场景已删除');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="view scenes-view">
      <aside className="panel scene-list">
        <h2>场景</h2>
        <p className="muted small">按拍摄序号排列，红点表示当前存在冲突。</p>
        <ul>
          {shotOrdered.map((s) => {
            const n = conflictCountByScene.get(s.id) ?? 0;
            return (
              <li
                key={s.id}
                className={openId === s.id ? 'selected' : ''}
                onClick={() => setOpenId(s.id)}
              >
                <span className="scene-list-code">{s.code}</span>
                <span className="scene-list-title">{s.title || '（未命名）'}</span>
                {n > 0 && <span className="dot-conflict">{n}</span>}
              </li>
            );
          })}
          {scenes.length === 0 && <li className="muted small">还没有场景</li>}
        </ul>
        <div className="new-scene">
          <div className="muted small">新建场景</div>
          <input
            placeholder="编号 S1"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          />
          <input
            placeholder="标题"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <div className="triple">
            <label>
              故事时间
              <input
                type="number"
                value={draft.storyTime}
                onChange={(e) => setDraft({ ...draft, storyTime: e.target.value })}
              />
            </label>
            <label>
              同刻序号
              <input
                type="number"
                min={0}
                value={draft.sameOrder}
                onChange={(e) => setDraft({ ...draft, sameOrder: e.target.value })}
              />
            </label>
            <label>
              拍摄序号
              <input
                type="number"
                min={0}
                value={draft.shotOrder}
                onChange={(e) => setDraft({ ...draft, shotOrder: e.target.value })}
              />
            </label>
          </div>
          <button disabled={!draft.code.trim()} onClick={createScene}>
            + 创建并登记
          </button>
          {openId === 'new' && null}
        </div>
      </aside>

      <section className="scene-detail">
        {openId && openId !== 'new' ? (
          (() => {
            const scene = scenes.find((s) => s.id === openId);
            if (!scene) return <div className="panel empty">场景不存在。</div>;
            const tlScene = timeline.find((t) => t.id === scene.id);
            return (
              <SceneCard
                key={scene.id}
                entities={entities}
                scene={scene}
                beforeStates={tlScene?.before ?? []}
                highlight={highlightScene === scene.id}
                onChange={onChange}
                notify={notify}
                onDelete={() => removeScene(scene)}
              />
            );
          })()
        ) : (
          <div className="panel empty">从左侧选择一个场景，或创建新场景后登记快照与结束变更。</div>
        )}
      </section>
    </div>
  );
}
