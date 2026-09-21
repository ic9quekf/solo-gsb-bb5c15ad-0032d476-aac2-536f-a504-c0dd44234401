import path from 'node:path';

export const PORT = Number(process.env.PORT || 3000);

/** SQLite 数据库文件位置。首次启动时自动创建并初始化表结构。 */
export const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data/continuity.sqlite');

/**
 * 空库启动时是否写入演示数据（一个含典型冲突的短片范例）。
 * 设为 "0" / "false" 可关闭，得到完全空白的系统。
 */
export const SEED_SAMPLE = !['0', 'false', 'no'].includes(
  (process.env.SEED_SAMPLE ?? '1').toLowerCase()
);

/**
 * 生产环境下构建后的前端静态资源目录。
 * 默认相对编译产物定位（server/dist → ../../client/dist），
 * 因此无论从仓库根目录还是 workspace 目录启动都能命中。
 */
export const CLIENT_DIST =
  process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');
