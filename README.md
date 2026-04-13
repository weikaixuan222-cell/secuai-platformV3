# SecuAI 智能防御平台

SecuAI 是一个面向小微企业网站的安全防护平台。当前仓库采用 monorepo 组织，重点围绕以下主链路构建最小可演示、可接入、可验证的安全闭环：

- `request_logs`
- `detection`
- `attack_events`
- `ai_risk_results`
- `security_policies`
- `blocked_entities`
- `POST /api/v1/protection/check`
- `packages/site-middleware`

当前阶段仍然不是 reverse proxy、full traffic gateway 或在线 WAF。

## 仓库结构

```text
apps/
  web/                    Next.js 管理后台
  api/                    Node.js + TypeScript 后端 API
services/
  ai-analyzer/            FastAPI 风险分析服务
packages/
  shared/                 共享类型与工具
  site-middleware/        站点侧最小防护 middleware
scripts/                  仓库级启动、自检、部署脚本
deploy/                   生产部署模板（PM2 / Nginx）
docker-compose.yml        PostgreSQL + Redis
```

## 开发启动

开发联调默认继续使用统一入口：

```bash
npm install
npm run dev:demo-stack
```

该入口会依次完成：

1. 启动 `postgres` 与 `redis`
2. 执行 `npm run db:schema --workspace @secuai/api`
3. 启动 `apps/api`
4. 启动 `apps/web`

开发态自检入口：

```bash
npm run smoke:demo-stack-ready
```

开发态排查入口：

```bash
npm run doctor:demo-stack
```

标准演示入口：

```bash
npm run demo:standard
```

## Ubuntu 生产部署

当前仓库已经收口了标准 Ubuntu 生产部署主路径，推荐顺序如下：

1. 复制环境变量模板
2. 构建生产产物
3. 用 PM2 启动 API / Web
4. 用 Nginx 统一暴露 `80/443`

### 1. 准备环境变量

```bash
cp .env.example .env
```

推荐的 Ubuntu 生产部署值：

```env
HOST=127.0.0.1
API_PORT=3201
HOSTNAME=127.0.0.1
WEB_PORT=3200
DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai
API_URL=http://127.0.0.1:3201
AI_ANALYZER_URL=http://127.0.0.1:8000
```

### 2. 构建与初始化

```bash
npm run prod:prepare
```

该命令会完成：

1. `docker compose up -d postgres redis`
2. `npm run db:schema --workspace @secuai/api`
3. `npm run build --workspace @secuai/api`
4. `npm run build --workspace @secuai/web`

### 3. 启动 PM2

```bash
npm run prod:start
```

常用命令：

```bash
npm run prod:restart
npm run prod:stop
npm run prod:logs
```

PM2 配置文件：

- `deploy/pm2/ecosystem.config.cjs`

### 4. 配置 Nginx

仓库已提供模板：

- `deploy/nginx/secuai.conf`

反代约定：

- 外部访问 `/` 转发到 `127.0.0.1:3200`
- 外部访问 `/api/` 转发到 `127.0.0.1:3201`

Ubuntu 的完整步骤见：

- [DEPLOYMENT_UBUNTU.md](./DEPLOYMENT_UBUNTU.md)

## 监听与端口约定

### 应用监听

- API 默认支持 `HOST` 环境变量控制监听地址
- Web 默认支持 `HOSTNAME` 环境变量控制监听地址
- 默认端口固定：
  - Web: `3200`
  - API: `3201`

### 生产部署建议

- 外部统一通过 Nginx 暴露 `80/443`
- API / Web 建议监听在 `127.0.0.1`
- 如果是局域网调试或宿主机直连访问，可将 `HOST` / `HOSTNAME` 设为 `0.0.0.0`

## 推荐文档

- [Ubuntu 部署指南](./DEPLOYMENT_UBUNTU.md)
- [演示指南](./DEMO_GUIDE.md)
- [站点接入主链路图](./SITE_INTEGRATION_FLOW.md)
- [Web 使用说明](./apps/web/README.md)
- [API 使用说明](./apps/api/README.md)
- [Site Middleware 使用说明](./packages/site-middleware/README.md)
