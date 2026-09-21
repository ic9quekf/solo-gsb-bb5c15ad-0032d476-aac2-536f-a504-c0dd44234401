# 短片场记 · 非线性拍摄连续性校验

面向短片拍摄的场记工具：以**故事时间 + 同刻序号**组织场景（与实际拍摄顺序无关），为角色/道具建立状态字段，录入每个场景开拍前的**期望快照**与结束后的**显式状态变更**；系统自动按故事线**重放**全部变更，逐字段比对「推导状态 vs 期望快照」，标出**首次分歧及其来源场景**，并在任何顺序/快照/变更调整后**自动重算**。

技术栈：TypeScript · React (Vite) · Express · SQLite (better-sqlite3)

## 一键启动（Docker）

```bash
docker compose up --build
```

启动完成后访问：**http://localhost:8080**

- 依赖安装、前端构建、SQLite 建库建表、演示数据写入全部随容器启动自动完成，无需任何手工步骤。
- 数据库文件持久化在命名卷 `continuity-data` 中（容器内路径 `/app/data/continuity.db`）。
- 旧版 Compose 可使用 `docker-compose up --build`。

## 配置项（均为环境变量，均有默认值）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 服务端口（Compose 已映射 `8080:8080`） |
| `DATABASE_PATH` | 容器内 `/app/data/continuity.db`；本地 `./data/continuity.db` | SQLite 数据库文件路径，启动时自动建目录、建表 |
| `SEED_DEMO` | `1` | 首次启动且库为空时写入演示数据（含两处刻意制造的冲突，便于立即看到校验效果）；置 `0` 关闭 |

修改端口示例：`docker compose up --build` 前编辑 `docker-compose.yml` 的 `ports`，或本地运行时 `PORT=9000 npm start`。

## 本地开发（可选，不用 Docker）

```bash
npm run setup   # 安装 server 与 client 依赖
npm run dev     # 同时启动后端 :8080 与前端 :5173（/api 已代理）
```

访问 http://localhost:5173 。生产模式本地运行：`npm run build && npm start`（后端直接托管前端产物，端口同 `PORT`）。

## 功能与使用流程

1. **对象与字段**：建立角色/道具，为每个对象定义状态字段（key、显示名、初始值），如「林雪 · 服装 = 蓝色风衣」。
2. **场景管理**：按 `故事时间`（可排序字符串，建议 `D01 21:00` 格式）+ `同刻序号` 录入场景；为每个场景填写：
   - **期望快照**：该场景开拍前，某对象某字段应有的值（留空表示不校验该字段）；
   - **显式状态变更**：该场景结束后生效的状态改写（如「旧怀表 · 表盖 → 打开」）。
3. **故事时间线**：系统从字段初始值出发，按 `(故事时间, 同刻序号)` 重放所有场景：每个场景开拍前逐字段比对推导状态与期望快照，随后应用该场景的显式变更。每条比对都标注推导值的**来源**（初始值或某场景的变更）。
4. **冲突列表**：汇总所有不一致，可按对象筛选、可只看每个「对象+字段」的**首次分歧**，并给出造成该推导值的**来源场景**——修复首次分歧后重算，后续连锁分歧往往随之消除。
5. **自动重算**：校验结果由服务端在每次请求时现算，任何场景顺序、快照、变更、字段的调整保存后立即反映到时间线与冲突列表。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/entities` | 对象列表 / 新建（含字段） |
| PUT/DELETE | `/api/entities/:id` | 更新（字段增删改，key 变更自动迁移历史数据）/ 删除 |
| GET/POST | `/api/scenes` | 场景列表（按故事时间排序，含快照与变更）/ 新建 |
| PUT/DELETE | `/api/scenes/:id` | 更新（含故事时间、同刻序号）/ 删除 |
| PUT | `/api/scenes/:id/snapshot` | 整体替换该场景的期望快照 |
| PUT | `/api/scenes/:id/changes` | 整体替换该场景的显式变更 |
| GET | `/api/continuity?entityId=` | 重放并返回时间线比对结果与冲突列表（可按对象过滤） |

## 项目结构

```
├── Dockerfile             # 多阶段构建：前端产物 + 后端编译 + 生产依赖
├── docker-compose.yml     # 一键启动
├── server/                # Express + better-sqlite3
│   └── src/
│       ├── db.ts          # 连接、建表、演示数据
│       ├── engine.ts      # 连续性引擎：重放、逐字段比对、首次分歧与来源
│       ├── routes.ts      # REST API
│       └── index.ts       # 启动：初始化 DB、挂载 API、托管前端
└── client/                # React + Vite
    └── src/
        ├── App.tsx        # 选项卡、对象筛选、数据加载与自动重算
        └── components/    # 时间线 / 冲突列表 / 场景管理 / 对象与字段
```
