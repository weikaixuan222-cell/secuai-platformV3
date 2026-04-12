# SecuAI 智能防护平台

SecuAI 是一个面向中小企业网站的安全防护平台。当前仓库使用 monorepo，重点已经从“日志接入型安全分析平台”推进到“带最小阻断能力的平台”，但当前仍不是 reverse proxy、full traffic gateway 或在线 WAF。

## 当前推荐启动路径

进入“真实接入与演示交付主线”后，默认推荐直接使用仓库根目录统一入口：

```powershell
npm run dev:demo-stack
```

这个入口会顺序完成：

1. 启动 `postgres` 和 `redis`
2. 执行 `npm run db:schema --workspace @secuai/api`
3. 启动 `apps/api`
4. 启动 `apps/web`

默认地址：

- API: `http://127.0.0.1:3201`
- Web: `http://127.0.0.1:3200`
- PostgreSQL 主机映射端口默认使用 `55432`
- Redis 主机映射端口默认使用 `6379`

说明：

- `55432` 是为了减少本机 `5432` 被已有 PostgreSQL 占用时的冲突
- 如需覆盖端口，可在启动前设置：
  - `POSTGRES_PORT`
  - `REDIS_PORT`
  - `API_PORT`
  - `WEB_PORT`
  - `DATABASE_URL`

## 当前推荐自检路径

统一启动完成后，默认推荐直接执行仓库根目录统一自检入口：

```powershell
npm run smoke:demo-stack-ready
```

这条路径会统一完成：

1. 检查 API `http://127.0.0.1:3201/health`
2. 检查 Web `http://127.0.0.1:3200/login`
3. 执行 `smoke:acceptance`
4. 执行 `smoke:stage2-minimal-defense`
5. 执行 `smoke:dashboard-events`
6. 执行 `smoke:dashboard-policies`

最小排查路径：

- `npm run dev:demo-stack` 启动失败：
  - 默认先执行 `npm run doctor:demo-stack`
  - 如果 doctor 提示基础依赖未就绪，再看 `docker compose up -d postgres redis` 和 `npm run db:schema --workspace @secuai/api`
- `npm run smoke:demo-stack-ready` 失败：
  - 默认先执行 `npm run doctor:demo-stack`
  - doctor 会先判断基础依赖、API、Web 是否 ready
  - 如果这些都正常，再只重跑真正失败的那一个 smoke

## 分步启动路径

如果需要单独排查某一步，可以继续走分步方式：

```powershell
docker compose up -d postgres redis
npm install
npm run db:schema --workspace @secuai/api
npm run dev --workspace @secuai/api
npm run dev --workspace @secuai/web
```

健康检查：

```powershell
curl http://127.0.0.1:3201/health
```

## 当前仓库结构

```text
apps/
  web/                    Next.js 管理后台
  api/                    Node.js + TypeScript 后端 API
services/
  ai-analyzer/            FastAPI 风险分析服务
packages/
  shared/                 共享类型与工具
  site-middleware/        站点侧最小防护 middleware
docker-compose.yml        PostgreSQL + Redis
```

## 当前已具备的能力

- 用户注册、登录、会话
- tenant / site 管理
- request log 写入与查询
- 基础攻击检测
- AI 风险评分
- `security_policies`
- `blocked_entities`
- `POST /api/v1/protection/check`
- `packages/site-middleware`
- `/dashboard/events`
- `/dashboard/policies`
- 事件、处置、回看闭环
- AI 高风险自动处置闭环
- 规则型策略闭环：
  - `blocked_ip`
  - `blocked_rate_limit`
  - `blockSqlInjection`
  - `blockXss`

## 当前主链路

```text
request_logs -> detection -> attack_events -> ai_risk_results
```

最小阻断能力建立在主链路之外的独立组件上：

- `security_policies`
- `blocked_entities`
- `protection/check`
- `site-middleware`

## 推荐文档

- [演示指南](./DEMO_GUIDE.md)
- [站点接入主链路图](./SITE_INTEGRATION_FLOW.md)
- [Web 使用说明](./apps/web/README.md)
- [API 使用说明](./apps/api/README.md)
- [Site Middleware 使用说明](./packages/site-middleware/README.md)

## 推荐验收命令

```powershell
npm run smoke:demo-stack-ready
```

## 推荐标准演示入口

如果当前目标不是单项排查，而是按固定顺序完成一次完整标准演示，推荐直接执行：

```powershell
npm run demo:standard
```

这条入口会先复用 `smoke:demo-stack-ready`，然后输出固定演示顺序与收尾动作，不需要新接手的人自己再拼步骤。
