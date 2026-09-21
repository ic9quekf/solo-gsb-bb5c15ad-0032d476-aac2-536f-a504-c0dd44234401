import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_DIST, PORT } from './config';
import { initSchema } from './db';
import { seedSampleData } from './seed';
import { mutateAndRecompute } from './logic';
import { router } from './routes';

// 启动即完成建表、演示数据初始化与首次全量重算（依赖与数据库初始化随启动完成）
initSchema();
seedSampleData();
mutateAndRecompute(() => {});

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', router);

// 生产环境托管前端构建产物；非 /api 路由统一回退到 SPA 入口
if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`场记连续性校验服务已启动：http://localhost:${PORT}`);
});
