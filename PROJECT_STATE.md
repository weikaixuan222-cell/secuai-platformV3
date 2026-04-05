# PROJECT_STATE.md

## 项目
SecuAI 小微企业网站安全防护平台

## 当前阶段
项目仍处于 **日志接入型安全分析平台** 向 **带最小阻断能力的平台** 过渡阶段，尚未进入完整反向代理 / 全流量网关阶段。

## 已确认方向
- 保持主链路稳定：
  - `request_logs`
  - `detection`
  - `attack_events`
  - `ai_risk_results`
- 当前不做 reverse proxy / full traffic gateway 重设计
- 优先把现有 MVP 做稳、做清楚、做可验证
- 在现有日志接入架构上补齐最小防护能力的数据、接口、接入样板和 enforcement 验证基础

## 技术栈
- Frontend: Next.js + TypeScript
- Backend: Node.js + TypeScript
- AI service: Python + FastAPI
- Database: PostgreSQL
- Cache: Redis
- DevOps: Docker Compose

## 当前进度

### 前端（`apps/web`）
前端状态收口已基本完成，重点链路已具备可回归验证能力。

已完成：
- 登录页与根路由状态文案统一
- 全局 `loading.tsx` / `error.tsx` 补齐
- 全局错误边界 dev / production smoke 完成
- Dashboard / Events / Event Detail 的状态、返回链路、异常恢复、invalid-id、ARIA 语义持续收口
- `/dashboard/policies` 已具备最小可演示管理闭环：
  - `security policy` 读取与更新
  - `blocked entities` 列表 / 新增 / 删除
  - `protection simulator` 成功链路与失败链路
- `smoke:dashboard-policies` 已覆盖 policy、blocked entities、simulator 空态/成功/失败与关键 ARIA 断言

### 后端（`apps/api`）
后端已具备最小防护能力相关基础数据模型与接口，并已完成验证。

已存在并已确认：
- `security_policies`
- `blocked_entities`
- `GET /api/v1/sites/:siteId/security-policy`
- `PUT /api/v1/sites/:siteId/security-policy`
- `GET /api/v1/sites/:siteId/blocked-entities`
- `POST /api/v1/sites/:siteId/blocked-entities`
- `DELETE /api/v1/blocked-entities/:id`
- `POST /api/v1/protection/check`

### 站点中间件（`packages/site-middleware`）
已完成最小 enforcement 闭环验证，并补齐最小真实接入样板。

已确认：
- `createSiteProtectionClient()` 调用平台 `POST /api/v1/protection/check`
- `enforceNodeRequestProtection()` 按返回结果执行放行或直接写出 `403 REQUEST_BLOCKED`
- 平台不可用时默认 fail-open
- middleware 与 API 在真实 `security_policies / blocked_entities` 数据下，对以下结果保持一致：
  - `allow`
  - `monitor`
  - `block`
- `blocked_entities` 命中时，middleware 与 API 的 reasons / mode 一致
- 现有 `native-node-server.ts` 已收口为最小真实接入样板，支持：
  - `.env` 读取
  - 最小运行命令
  - `allow / monitor / block / fail-open` 可见结果
  - 阻断时真实 `403 + REQUEST_BLOCKED`
  - 与平台 `protection/check` 关系说明

### 生命周期闭环验证
已新增并通过 **blocked entity 生命周期 smoke**，验证管理动作会真实驱动 enforcement 结果变化。

已确认：
1. 初始无 blocked IP 时，同一请求得到 `allow`
2. 新增 blocked IP 且策略为 `monitor` 时，同一请求得到 `monitor`
3. 切到 `protect` 后，同一请求得到 `block`
4. 删除 blocked IP 后，同一请求恢复为 `allow`
5. 上述 4 个阶段中，API 与 middleware 的结果保持一致
6. `protect` 阶段下，站点侧真实返回 `403 + REQUEST_BLOCKED`

## 最新验证

### 前端
已通过：
- `npm run typecheck --workspace @secuai/web`
- `npm run build --workspace @secuai/web`
- `npm run smoke:global-error --workspace @secuai/web`
- `npm run smoke:global-error:start --workspace @secuai/web`
- `npm run smoke:dashboard-events --workspace @secuai/web`
- `npm run smoke:dashboard-policies --workspace @secuai/web`

### 后端
已通过：
- `npm run db:schema --workspace @secuai/api`
- `npm run build --workspace @secuai/api`
- `npm run test --workspace @secuai/api`

### 站点中间件
已通过：
- `npm run typecheck --workspace @secuai/site-middleware`
- `npm run build --workspace @secuai/site-middleware`
- `npm run smoke:e2e-enforcement --workspace @secuai/site-middleware`
- `npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware`
- `npm run test --workspace @secuai/site-middleware`

关键验证结果：
- `@secuai/api` tests: 13 / 13 通过
- `@secuai/site-middleware` tests: 5 / 5 通过
- E2E enforcement smoke：
  - allow consistency verified
  - monitor consistency verified
  - protect consistency verified
- blocked entity 生命周期 smoke：
  - initial allow verified
  - monitor after blocked entity verified
  - block in protect mode verified
  - allow after blocked entity removal verified
- native node demo：
  - 可启动
  - 可展示 protection 结果
  - 已验证 fail-open 可见结果

## 当前风险 / 说明
- 当前仍未进入真正在线代理 / 网关防护阶段
- 现阶段“防护”仍以策略、封禁数据、policy check、site-side middleware 和最小接入样板为主
- 当前剩余风险主要在：
  - 高并发场景
  - 真实 rate limit 压力
  - 多节点部署一致性
- 上述风险不在当前 MVP 阶段范围内

## 下一步建议
1. 继续补最小演示与答辩材料，把现有闭环整理成固定演示顺序
2. 若继续做验证，优先考虑更小粒度的 rate limit / reason 稳定性验证
3. 继续保持接口、smoke、README 和项目状态文档同步
4. 不进入 reverse proxy / 全流量网关重构