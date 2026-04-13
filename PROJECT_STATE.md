# PROJECT_STATE.md

## 项目
SecuAI 小微企业网站安全防护平台

## 当前阶段
项目已完成第二阶段最小开发，并进入“真实接入与演示交付主线”的后续收口阶段。

当前结论：

**项目已接近整体完成。**

当前不应再无节制补第二阶段内部小边界、前端小文案、入口脚本或低价值文档润色。

## 已确认方向
- 保持主链路稳定：
  - `request_logs`
  - `detection`
  - `attack_events`
  - `ai_risk_results`
- 第二阶段已收束能力继续作为基础：
  - `security_policies`
  - `blocked_entities`
  - `POST /api/v1/protection/check`
  - `site-middleware`
  - 事件、处置、回看闭环
  - 自动处置闭环
  - 规则型策略闭环
- 当前统一执行路径：
  - 启动：`npm run dev:demo-stack`
  - 自检：`npm run smoke:demo-stack-ready`
  - 排查：`npm run doctor:demo-stack`
  - 标准演示：`npm run demo:standard`
  - onboarding：`npm run demo:onboard-native-site --workspace @secuai/site-middleware`
  - 最小接入验证：`npm run demo:native-node --workspace @secuai/site-middleware`
- 当前不做：
  - reverse proxy
  - full traffic gateway
  - 在线 WAF
  - 重型分布式限流
  - 多节点高并发一致性优化

## 当前能力

### 1. 第二阶段已封版能力
- detection 对同一 `request_log + event_type + rule_code` 已幂等
- `ai_risk_results` 对同一 `attack_event + model_name + model_version` 已幂等
- `matchedBlockedEntity` 已贯通到判定、留痕、事件回看
- `GET /api/v1/attack-events/:id` 已直接返回：
  - `blockedEntities`
  - `activeBlockedEntity`
  - `protectionEnforcement`
  - `dispositionSummary`
- blocked entity 返回中已有：
  - `isActive`
  - `originKind`
  - `attackEventId`
- AI 高风险自动处置完整生命周期已闭环
- 规则型策略主线已闭环：
  - `blocked_ip`
  - `blocked_rate_limit`
  - `blockSqlInjection`
  - `blockXss`

### 2. 统一启动与验收入口
- `npm run dev:demo-stack`
  可统一拉起：
  - `postgres`
  - `redis`
  - `db:schema`
  - `apps/api`
  - `apps/web`
- `npm run smoke:demo-stack-ready`
  可统一执行：
  - API `/health`
  - Web `/login`
  - `smoke:acceptance`
  - `smoke:stage2-minimal-defense`
  - `smoke:dashboard-events`
  - `smoke:dashboard-policies`

### 3. 统一排查、演示与接入样板
- `npm run doctor:demo-stack`
  已作为启动失败或 ready-check 失败后的统一排查主入口
- `npm run demo:standard`
  已作为标准演示流程入口
- `npm run demo:onboard-native-site --workspace @secuai/site-middleware`
  已可自动完成 onboarding、写入 `.env` 并拉起样板
- `npm run demo:native-node --workspace @secuai/site-middleware`
  已可完成最小真实接入验证

### 4. 文档与交付材料
- `README.md`
- `DEMO_GUIDE.md`
- `SITE_INTEGRATION_FLOW.md`
- `PRESENTATION_OUTLINE.md`

以上文档与材料已统一到当前执行路径，不再要求新接手者手工拼启动、自检、排查、演示和最小接入步骤。

### 5. 最小认证闭环补齐状态
- Web 侧已补 `/register`
- `POST /api/v1/auth/register` 注册后会自动创建默认 tenant 并绑定 `owner`
- 注册成功后可回到 `/login`，沿用现有登录链路进入 `/dashboard/events`
- 登录页已补注册成功引导、邮箱回填与登录/注册链接收口

## 最新验证

### 统一入口
- `npm run smoke:demo-stack-ready`
- `npm run doctor:demo-stack`
- `npm run demo:standard`

### 第二阶段护栏
- `npm run smoke:acceptance --workspace @secuai/api`
- `npm run smoke:stage2-minimal-defense --workspace @secuai/api`
- `npm run smoke:dashboard-events --workspace @secuai/web`
- `npm run smoke:dashboard-policies --workspace @secuai/web`

### 真实接入样板
- `npm run build --workspace @secuai/site-middleware`
- `npm run demo:onboard-native-site --workspace @secuai/site-middleware`
- 自动写入 `packages/site-middleware/.env`
- 自动拉起 `demo:native-node`
- 最小接入请求真实返回 `allow`

### 最小注册闭环
- `npm run build --workspace @secuai/api`
- `npm run build --workspace @secuai/web`
- `npm run typecheck --workspace @secuai/web`
- `TEST_DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai npm test --workspace @secuai/api -- --test-name-pattern "注册闭环：注册后登录应返回默认 tenant membership"`
- Windows 本地起 `@secuai/api` + `@secuai/web` 后执行 `node --experimental-websocket apps/web/scripts/auth-register-smoke.mjs`
- Ubuntu 24 容器 `mcr.microsoft.com/playwright:v1.55.0-noble` 内完成：
  - API `/health`
  - Web `/register`
  - `auth-register-smoke.mjs`

### 当前阶段结论
- 第二阶段后端主线已阶段性收束
- 第二阶段前端统一收口已阶段性收束
- 真实接入与演示交付主线当前这一段已阶段性收束
- 真实接入样板这一小段已阶段性收束
- 最小注册闭环已补齐并可沿用现有登录主路径
- 最小注册闭环已完成 Ubuntu 24 / Windows 双侧真实验证
- 项目已接近整体完成

## 当前风险
- 当前仍不是完整网关产品
- 高并发、压测、多节点一致性尚未展开
- 统一入口和 smoke 仍依赖本地环境稳定性
- `dashboard-events` 中 AI analyzer 相关卡片在 analyzer 未启动时仍可能走 skip 分支
- `demo:standard` 的重复执行稳定性刚完成根因修复，仍应继续以重复执行作为主要验收方式

## 下一步建议

### 1. 当前先停止无节制补点
- 不再继续补第二阶段内部小边界
- 不再继续补新的入口脚本
- 不再继续补 onboarding 小细节
- 不再继续补低价值文档润色

### 2. 当前最后一个高价值缺口已收口
- `demo:standard` 的重复执行稳定性已完成根因修复
- 最小注册闭环已完成注册、登录引导与默认 tenant 兼容
- 当前不应再无节制继续补点，应以封版与交付使用为主

### 3. 继续保持统一入口
- 启动优先走 `npm run dev:demo-stack`
- 自检优先走 `npm run smoke:demo-stack-ready`
- 排查优先走 `npm run doctor:demo-stack`
- 标准演示优先走 `npm run demo:standard`
