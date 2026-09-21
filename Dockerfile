# syntax=docker/dockerfile:1

########## 依赖安装（利用层缓存）##########
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json ./server/package.json
COPY server/.npmrc ./server/.npmrc
COPY client/package.json ./client/package.json
# better-sqlite3 在 Linux x64 / Node 20 上有预编译二进制；保留构建工具作为兜底
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN (cd server && npm install) \
    && (cd client && npm install)

########## 前端构建 ##########
FROM node:20-bookworm-slim AS client-build
WORKDIR /app
COPY client/package.json ./client/package.json
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY client ./client
RUN npm --prefix client run build

########## 服务端构建 ##########
FROM node:20-bookworm-slim AS server-build
WORKDIR /app
COPY server/package.json ./server/package.json
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
RUN npm --prefix server run build

########## 运行镜像 ##########
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json ./server/package.json
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
