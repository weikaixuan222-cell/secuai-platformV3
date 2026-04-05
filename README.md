<<<<<<< HEAD
# SecuAI 智能防护平台

SecuAI 是一个面向中小企业网站的安全防护平台。
当前仓库采用 monorepo 结构，已经包含：
- 后端 API
- AI 风险分析服务
- 站点侧 middleware
- Web 管理控制台
- 本地 PostgreSQL / Redis 开发基础设施

当前产品阶段是：
- 以日志接入型安全分析平台为主
- 向最小防护能力平台过渡
- 不进入 reverse proxy
- 不进入 full traffic gateway

## 仓库结构

```text
apps/
  web/                    Next.js 管理控制台
  api/                    Node.js + TypeScript 后端 API
services/
  ai-analyzer/            FastAPI 风险分析服务
packages/
  shared/                 共享类型与工具
  site-middleware/        站点侧最小防护 middleware
docker-compose.yml        PostgreSQL + Redis
```

## 本地启动

### 1. 启动基础设施

```powershell
docker compose up -d
```

默认端口：
- PostgreSQL: `5432`
- Redis: `6379`

### 2. 安装 Node.js 依赖

```powershell
npm install
```

### 3. 安装 Python 依赖

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r services/ai-analyzer/requirements.txt
```

### 4. 应用数据库结构

```powershell
npm run db:schema --workspace @secuai/api
```

### 5. 启动 API

```powershell
npm run dev:api
```

健康检查：

```powershell
curl http://127.0.0.1:3201/health
```

### 6. 启动 Web

```powershell
npm run dev:web
```

打开：

[http://127.0.0.1:3200](http://127.0.0.1:3200)

### 7. 启动 AI analyzer

在 `services/ai-analyzer` 目录执行：

```powershell
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```powershell
curl http://127.0.0.1:8000/health
```

## 当前已具备的能力

- 用户注册、登录、会话
- tenant / company 管理
- site onboarding
- request log 写入与查询
- 基础攻击检测
- AI 风险评分
- Dashboard / Events / Event Detail 页面
- site 级 `security_policies`
- `blocked_entities`
- `POST /api/v1/protection/check`
- `packages/site-middleware`
- `/dashboard/policies` 策略管理与 protection simulator

## 当前主链路

```text
request_logs -> detection -> attack_events -> ai_risk_results
```

当前最小防护能力建立在主链路之外的独立构件上：
- `security_policies`
- `blocked_entities`
- `protection/check`
- `site-middleware`

## 常用文档

- [Web 使用说明](E:/cursor/SecuAI智能防御系统V2.0/apps/web/README.md)
- [API 使用说明](E:/cursor/SecuAI智能防御系统V2.0/apps/api/README.md)
- [Site Middleware 使用说明](E:/cursor/SecuAI智能防御系统V2.0/packages/site-middleware/README.md)
- [最小防护能力演示指南](E:/cursor/SecuAI智能防御系统V2.0/DEMO_GUIDE.md)

## 当前不做的范围

当前阶段明确不做：
- reverse proxy 改造
- full traffic gateway 改造
- 重型流量基础设施升级
- 大规模分布式限流体系

## 推荐验证命令

```powershell
npm run build --workspace @secuai/api
npm run build --workspace @secuai/web
npm run build --workspace @secuai/site-middleware
npm run smoke:dashboard-policies --workspace @secuai/web
npm run smoke:e2e-enforcement --workspace @secuai/site-middleware
```
=======
# secuai-platform
>>>>>>> 55d8559522b617f36081fcf0bf3ab5696e30bafb
