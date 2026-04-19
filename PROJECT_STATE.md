# PROJECT_STATE.md

## 项目
SecuAI 小微企业网站安全防护平台

## 当前阶段
项目当前处于“真实接入与演示交付主线”的部署收口阶段。

当前新增结论：

- 开发联调入口继续保留 `npm run dev:demo-stack`
- Ubuntu 生产部署主路径已经收口为：
  - `npm run prod:prepare`
  - `npm run prod:start`
  - `npm run doctor:prod`
  - `deploy/pm2/ecosystem.config.cjs`
  - `deploy/nginx/secuai.conf`

## 已确认方向
- 保持主链路稳定：
  - `request_logs`
  - `detection`
  - `attack_events`
  - `ai_risk_results`
- 当前继续围绕最小防护能力收口：
  - `security_policies`
  - `blocked_entities`
  - `POST /api/v1/protection/check`
  - `site-middleware`
- 当前不做：
  - reverse proxy
  - full traffic gateway
  - 在线 WAF
  - 重型分布式限流
  - 多节点高并发一致性优化

## 当前能力

### 1. 第二阶段与最小防护主线
- detection 幂等
- `ai_risk_results` 幂等
- `matchedBlockedEntity` 已贯通到判定、留痕、事件回看
- `security_policies` / `blocked_entities` / `protection/check` 已闭环
- 站点管理已具备最小可用闭环：
  - 站点列表
  - 新增站点
  - 修改站点
  - 删除站点
  - 创建后下一步引导
- `site-middleware` 已具备最小 enforcement 验证能力

### 2. 开发联调统一入口
- `npm run dev:demo-stack`
- `npm run smoke:demo-stack-ready`
- `npm run doctor:demo-stack`
- `npm run demo:standard`

### 3. Ubuntu 生产部署统一入口
- `npm run prod:prepare`
  - 启动 `postgres` / `redis`
  - 执行 `db:schema`
  - 构建 API / Web
- `npm run prod:start`
  - 使用 PM2 启动 API / Web
- `npm run doctor:prod`
  - 检查 PostgreSQL / Redis / API / Web 是否 ready
- `deploy/pm2/ecosystem.config.cjs`
  - 作为 Ubuntu 标准 PM2 启动模板
- `deploy/nginx/secuai.conf`
  - 作为 Ubuntu 标准 Nginx 反向代理模板

### 4. 监听与端口约定
- API 监听地址由 `HOST` 控制
- Web 监听地址由 `HOSTNAME` 控制
- 固定内部端口：
  - API: `3201`
  - Web: `3200`
- Ubuntu 生产部署建议配合 Nginx 使用 `127.0.0.1`
- 局域网调试可切到 `0.0.0.0`

## 最新验证

### 本轮已完成
- `npm test --workspace @secuai/api -- --test-name-pattern "站点管理闭环：可列出、修改并删除站点"`
- `node --test apps/web/scripts/start-next-dev-config.test.mjs scripts/production-config.test.mjs`
- `npm run build --workspace @secuai/api`
- `npm run build --workspace @secuai/web`
- `npm run typecheck --workspace @secuai/web`
- Windows 本地真实联调：
  - `/dashboard/sites` 可打开
  - 新增站点可提交
  - 编辑站点可保存
  - 删除站点可确认并生效
  - 成功反馈、字段错误和创建后下一步可见

### 本轮验证覆盖
- Web 默认监听配置已改为环境变量可控并完成测试
- 生产部署配置解析脚本已完成测试
- API / Web 生产构建仍可通过
- 站点管理最小闭环已在 Windows 本地完成真实 smoke

## 当前风险
- 本轮未在真实 Ubuntu 主机上完成 `npm run prod:start` + `nginx` 联动实机验证
- 本轮未在 Ubuntu 24 用户态环境中完成站点管理 smoke 实机复跑
- AI analyzer 仍需单独按部署文档启动
- HTTPS 证书、续期与多节点方案尚未收口
- 当前标准部署仍以单机 Ubuntu 为边界

## 下一步建议
- 在一台真实 Ubuntu 24 机器上按 `DEPLOYMENT_UBUNTU.md` 完整彩排一次
- 完成 `pm2` + `nginx` + 外部访问的真实验证闭环
- 若后续进入长期运行环境，再补 `systemd`、证书与备份策略
