# SecuAI 智能防御平台

SecuAI 是面向小微企业网站安全防护场景的 MVP 单体仓库（monorepo）。当前版本已包含相互隔离的前后端与 AI 服务、本地基础设施配置，以及可直接运行的最小应用入口。

## Monorepo 目录结构

```text
apps/
  web/                Next.js 管理控制台
  api/                Node.js + TypeScript 后端 API
services/
  ai-analyzer/        FastAPI 风险评分服务
packages/
  shared/             共享类型与工具
docker-compose.yml    PostgreSQL + Redis
```

## 本地启动

### 1. 启动基础设施

```bash
docker compose up -d
```

该命令会启动：
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`

如果本机这些端口已被占用，请将根目录 `.env.example` 复制为 `.env`，并覆盖如下端口配置：

```bash
POSTGRES_PORT=15432
REDIS_PORT=16379
```

### 2. 安装 Node.js 依赖

在仓库根目录执行：

```bash
npm install
```

### 3. 安装 Python 依赖

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r services/ai-analyzer/requirements.txt
```

### 4. 应用 PostgreSQL 数据库结构

```bash
npm run db:schema --workspace @secuai/api
```

### 5. 启动后端 API

```bash
npm run dev:api
```

API 健康检查：

```bash
curl http://127.0.0.1:3201/health
```

### 6. 启动前端控制台

在另一个终端执行：

```bash
npm run dev:web
```

打开 [http://127.0.0.1:3200](http://127.0.0.1:3200)

### 7. 启动 AI 分析服务

在另一个终端执行：

```bash
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

请在以下目录执行该命令：

```text
services/ai-analyzer
```

AI 服务健康检查：

```bash
curl http://localhost:8000/health
```

## 环境变量文件

每个可运行模块都提供了各自的 `.env.example`：
- `apps/web/.env.example`
- `apps/api/.env.example`
- `services/ai-analyzer/.env.example`

本地开发前，请按模块需要将其复制为 `.env.local` 或 `.env`。

## 当前范围

当前后端 MVP 已不再只是骨架工程，仓库中已包含：
- 用户注册、登录、登出与租户授权
- 站点接入，以及基于哈希的 ingestion key 校验
- 请求日志写入与列表查询
- 基于规则的攻击检测，以及自动生成 `attack_events`
- 从检测流程到 `ai_risk_results` 的正式 AI 分析器集成
- 请求日志、攻击事件、攻击事件详情、AI 风险结果的后端查询 API
- 覆盖后端主链路的最小自动化集成测试

已验证的后端流程如下：

```text
request_logs -> detection -> attack_events -> ai_risk_results
```

下一步产品重点应是在现有后端 API 之上继续完善前端控制台能力，而不是重复重建后端基础链路。
