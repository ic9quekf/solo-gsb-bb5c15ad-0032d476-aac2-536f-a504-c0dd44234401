import { db } from './db';
import { SEED_SAMPLE } from './config';

/**
 * 演示数据：短片《地铁站》。
 *
 * 故事顺序：S3 深夜筹备 → S1 月台相遇（故事时刻 10，同刻 1）
 *          → S2 列车跟踪（故事时刻 10，同刻 2）→ S4 清晨结局
 * 拍摄顺序（shot_order）按场地/档期打乱：S1、S4 在月台连拍，S3、S2 在棚内连拍。
 *
 * 范例中故意保留一处典型场记错误：
 *   S2 结束后“公文包状态”从“在林夏手中”变为“被打开”，
 *   于是 S4 开拍前推导值 = “被打开”，与期望“在林夏手中”冲突，
 *   来源场景指向 S2。
 * 在界面上把 S2 的变更改回“在林夏手中”（或调整顺序/快照），冲突会立刻消失。
 */
export function seedSampleData(): void {
  if (!SEED_SAMPLE) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number };
  if (count.n > 0) return;

  db.transaction(() => {
    const addEntity = (kind: 'character' | 'prop', name: string, note: string): number => {
      const info = db
        .prepare(`INSERT INTO entities (kind, name, note) VALUES (?, ?, ?)`)
        .run(kind, name, note);
      return Number(info.lastInsertRowid);
    };
    const addField = (
      entityId: number,
      name: string,
      defaultVal: string,
      sortOrder = 0
    ): number => {
      const info = db
        .prepare(
          `INSERT INTO fields (entity_id, name, default_val, sort_order)
           VALUES (?, ?, ?, ?)`
        )
        .run(entityId, name, defaultVal, sortOrder);
      return Number(info.lastInsertRowid);
    };
    const addScene = (
      code: string,
      title: string,
      storyTime: number,
      sameOrder: number,
      shotOrder: number,
      note: string
    ): number => {
      const info = db
        .prepare(
          `INSERT INTO scenes (code, title, story_time, same_order, shot_order, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(code, title, storyTime, sameOrder, shotOrder, note);
      return Number(info.lastInsertRowid);
    };

    const lin = addEntity('character', '林夏', '女主角');
    const linClothes = addField(lin, '服装', '白色T恤', 0);
    const linBag = addField(lin, '随身物', '背着黑色双肩包', 1);

    const zhou = addEntity('character', '周远', '跟踪者');
    addField(zhou, '服装', '深色风衣', 0);

    const briefcase = addEntity('prop', '公文包', '关键道具');
    const bagState = addField(briefcase, '状态', '未出现', 0);

    // S3：闪回，先在棚内拍摄；S1/S4 月台同档期；S2 最后拍
    const s1 = addScene('S1', '月台相遇', 10, 1, 1, '故事开场（实际第 1 个拍）');
    const s2 = addScene('S2', '列车跟踪', 10, 2, 4, '与 S1 同一故事时刻稍后（实际最后拍）');
    const s3 = addScene('S3', '深夜筹备', 2, 0, 3, '闪回，先在棚内拍摄');
    const s4 = addScene('S4', '清晨结局', 18, 0, 2, '月台日戏，与 S1 同档期拍摄');

    const snap = db.prepare(
      `INSERT INTO snapshots (scene_id, field_id, expected) VALUES (?, ?, ?)`
    );
    const change = db.prepare(
      `INSERT INTO changes (scene_id, field_id, new_val, note) VALUES (?, ?, ?, ?)`
    );

    // —— S3：筹备结束，周远带走公文包 ——
    snap.run(s3, bagState, '未出现');
    change.run(s3, bagState, '在周远手中', '筹备结束，周远带走公文包');

    // —— S1：月台相遇；周远把公文包交给林夏 ——
    snap.run(s1, linClothes, '白色T恤');
    snap.run(s1, bagState, '在周远手中');
    change.run(s1, bagState, '在林夏手中', '周远递出公文包');

    // —— S2：同一故事时刻稍后，开拍时包仍在林夏手中 ——
    snap.run(s2, bagState, '在林夏手中');
    // 场记误记（实际拍法是包被打开）：
    change.run(s2, bagState, '被打开', '拉扯中包被打开');

    // —— S4：结局清晨，包应已合上回到林夏手中 ——
    // 与推导值“被打开”冲突，来源场景指向 S2。
    snap.run(s4, linClothes, '白色T恤');
    snap.run(s4, bagState, '在林夏手中');
    change.run(s4, linBag, '仅拿着公文包', '双肩包遗失在车站');
  })();
}
