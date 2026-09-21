# 场记连续性校验台（Continuity Checker）

面向短片场记的**非线性拍摄连续性校验** Web 应用。拍摄通常按场地/档期打乱顺序进行，
本工具按**故事时间**重放每场结束后登记的状态变更，逐字段核对每个场景开拍前的推导状态
与场记登记的期望快照，自动标出分歧、分歧来源场景，并在调整顺序或修改变更后立即整体重算。

技术栈：**TypeScript + React 18 + Vite + Express 4 + SQLite（better-sqlite3）**。

---

## 一键启动（Docker Compose）

需要已安装 Docker（含 Compose 插件）。在项目根目录执行：

```bash
docker compose up --build -d
```

首次启动会自动完成：安装依赖 → 构建前端 → 构建服务端 → 初始化 SQLite 数据库与表结构
→ 写入一份演示数据（可用环境变量关闭）。

启动后访问：

> **http://localhost:3000**

停止与清理：

```bash
docker compose down            # 停止（保留数据卷）
docker compose down -v         # 停止并删除数据库卷，恢复到初始演示状态
```

### 配置（可选）

均通过环境变量或 `.env` 文件配置，Docker Compose 已给出默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 宿主机映射端口（容器内固定监听 3000）。如 `PORT=8080 docker compose up --build` 后访问 http://localhost:8080 |
| `SEED_SAMPLE` | `1` | 空库首次启动是否写入演示数据，设为 `0` / `false` 得到空白系统 |
| `DB_PATH`（容器内） | `/app/data/continuity.sqlite` | SQLite 文件路径，已挂载到命名卷 `continuity-data` 持久化 |

---

## 工作模型与使用流程

1. **建立对象与状态字段**
   对象分「角色」「道具」两类；每个对象可定义若干状态字段（如 *服装、随身物、伤情、
   公文包开合*）。字段的**默认值**即故事开始前的初始状态。
2. **登记场景**
   每个场景包含：
   - `故事时间`（数值，越大越靠后）；
   - `同刻序号`：故事时间相同的多个场景，用它确定同一时刻内的先后（0 起）；
   - `拍摄序号`：实际拍摄次序，仅用于登记页展示，**不参与重放**；
   - **开拍期望快照**：本场开拍时被盯字段“应该是什么值”；
   - **场景结束后的显式变更**：本场拍完后状态变成了什么（换服装、道具易手…）。
3. **自动校验**
   系统按 `故事时间 → 同刻序号 → 拍摄序号 → ID` 排序后重放：
   - 先以“开拍前推导状态”比对期望快照，**只比对登记了期望的字段**；
   - 再应用本场结束变更，供后续场景使用（期望快照本身不写回状态）；
   - 出现分歧时记录期望值、推导值，并标注取值来源（**字段初始默认值**或**某场景的结束变更**）；
   - 每个对象在故事时间线上的**第一处分歧**单独高亮，后续为级联分歧。
4. **调整即重算**
   任意增删改、改默认值、调整故事时间/同刻序号后，服务端在同一数据库事务内整体重算并
   覆盖冲突结果，界面刷新即可看到最新结论。

### 页面

- **故事时间线**：按故事顺序排列的场景卡片（与拍摄顺序无关），含开拍前状态、结束变更、
  分歧横幅，支持按对象筛选；
- **冲突列表**：按对象分组的全部分歧，标注「首次分歧 / 级联」，可一键跳到来源或问题场景修正；
- **场景登记**：按拍摄序号管理场景、期望快照与结束变更，编辑时实时显示与推导值是否一致；
- **对象与状态字段**：管理角色/道具及其字段与初始值。

### 内置演示

首次启动自带短片《地铁站》范例：故事顺序为 S3 → S1 → S2 → S4，实际按 S1/S4（月台）、
S3/S2（棚内）的档期乱序拍摄。其中 **S2** 结束时公文包变为「被打开」，导致 **S4**
开拍前推导值与期望「在林夏手中」冲突——在「场景登记」中把 S2 的变更改回
「在林夏手中」，冲突会立即消失。

---

## 本地开发（不用 Docker）

要求 Node.js ≥ 20。

```bash
# 1. 安装全部依赖（workspaces）
npm install

# 2. 启动后端（tsx 热更新，http://localhost:3000）
npm run dev:server

# 3. 另开终端启动前端（Vite，http://localhost:5173，/api 已代理到 3000）
npm run dev:client
```

本地数据库默认位于 `./data/continuity.sqlite`（自动创建）。

生产构建并以单一服务运行（Express 同时托管前端产物）：

```bash
npm run build
npm start          # http://localhost:3000
```

---

## 目录结构

```
.
├── Dockerfile               # 多阶段构建：依赖 → 前端构建 → 服务端构建 → 运行镜像
├── docker-compose.yml       # 一键启动 + 数据卷持久化 + 健康检查
├── server/                  # Express + TypeScript + better-sqlite3
│   └── src/
│       ├── db.ts            # 连接、表结构初始化（外键级联）
│       ├── logic.ts         # 故事时间线重放引擎 + 事务内整体重算
│       ├── routes.ts        # REST API（对象/字段/场景/时间线/冲突）
│       ├── seed.ts          # 首次启动演示数据
│       ├── config.ts        # 环境变量配置
│       └── index.ts         # 入口：建表、播种、重算、托管静态资源
└── client/                  # React 18 + TypeScript + Vite
    └── src/
        ├── App.tsx
        ├── api.ts / types.ts
        └── views/           # 时间线 / 冲突列表 / 场景登记 / 对象管理
```

## REST API 摘要

| 方法与路径 | 说明 |
| --- | --- |
| `GET/POST /api/entities` | 对象列表 / 新建角色或道具 |
| `PATCH/DELETE /api/entities/:id` | 改名、改类型 / 删除（级联） |
| `POST /api/entities/:id/fields`，`PATCH/DELETE /api/fields/:id` | 状态字段增改删 |
| `GET/POST /api/scenes`，`PATCH/DELETE /api/scenes/:id` | 场景增改删；PATCH 可携带 `snapshots` / `changes` 全量替换 |
| `GET /api/timeline?entityId=` | 重放结果：每场开拍前推导状态、快照、变更、冲突 |
| `GET /api/conflicts?entityId=` | 持久化冲突列表（按故事顺序，含首次分歧标记） |
| `GET /api/health` | 健康检查 |
