# API 服务

SecuAI MVP 的 Node.js + TypeScript 后端 API。

## 运行

在仓库根目录执行：

```bash
npm install
npm run dev:api
```

默认本地监听地址：

```text
http://127.0.0.1:3201
```

健康检查：

```bash
curl http://127.0.0.1:3201/health
```

## 数据库结构

PostgreSQL 启动后，执行以下命令应用数据库结构：

```bash
npm run db:schema --workspace @secuai/api
```

数据库结构文件位于：

```text
apps/api/db/schema.sql
```

每次 SQL schema 发生变更后，都需要重新执行上述 schema 应用命令。

## 环境变量

本地开发前，请将 `.env.example` 复制为 `.env`。API 脚本会自动加载 `.env`。

## 数据层结构

- `src/config/env.ts`：环境变量校验
- `src/db/client.ts`：PostgreSQL 连接池创建
- `src/db/apply-schema.ts`：schema 初始化脚本
- `src/db/types.ts`：面向数据库行与写入输入的 TypeScript 模型
- `src/repositories/*`：核心实体的最小 repository 层

## 已实现的 MVP 接口

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/tenants`
- `POST /api/v1/sites`
- `POST /api/v1/request-logs`
- `POST /api/v1/protection/check`
- `GET /api/v1/request-logs`
- `POST /api/v1/detection/run`
- `GET /api/v1/attack-events`
- `GET /api/v1/attack-events/:id`
- `GET /api/v1/ai-risk-results`

所有成功响应都使用如下格式：

```json
{
  "success": true,
  "data": {}
}
```

所有错误响应都使用如下格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

## 本地测试流程

### 1. 启动 PostgreSQL 和 Redis

```bash
docker compose up -d
```

### 2. 准备 API 环境变量

`.env` 示例：

```bash
PORT=3201
HOST=127.0.0.1
DATABASE_URL=postgresql://secuai:secuai_dev_password@localhost:5432/secuai
REDIS_URL=redis://localhost:6379
AI_ANALYZER_URL=http://127.0.0.1:8000
AI_ANALYZER_TIMEOUT_MS=1500
AI_ANALYZER_MAX_RETRIES=1
DB_SSL_MODE=disable
DETECTION_SUSPICIOUS_UA_ALLOWLIST=
```

### 3. 应用 schema

```bash
npm run db:schema --workspace @secuai/api
```

### 4. 启动 AI 分析服务

在 `services/ai-analyzer` 目录执行：

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

### 5. 启动 API

```bash
npm run dev:api
```

### 6. 注册用户

```bash
curl -X POST http://127.0.0.1:3201/api/v1/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"owner@example.com\",\"password\":\"StrongPass123\",\"displayName\":\"Owner\"}"
```

### 7. 登录并保存返回的 token

```bash
curl -X POST http://127.0.0.1:3201/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"owner@example.com\",\"password\":\"StrongPass123\"}"
```

登录响应包含 `expiresAt`。会话会带过期时间存储，并在认证流程中自动清理已过期会话。

### 7.1 登出

```bash
curl -X POST http://127.0.0.1:3201/api/v1/auth/logout ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 8. 创建租户

```bash
curl -X POST http://127.0.0.1:3201/api/v1/tenants ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Demo Company\",\"slug\":\"demo-company\"}"
```

### 9. 创建站点

```bash
curl -X POST http://127.0.0.1:3201/api/v1/sites ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"tenantId\":\"YOUR_TENANT_ID\",\"name\":\"Main Site\",\"domain\":\"example.com\"}"
```

该接口会返回一次性的 `ingestionKey`。明文 key 不会被存储，后续也无法再次查询；系统仅保存其哈希值用于后续校验。

### 10. 提交请求日志

```bash
curl -X POST http://127.0.0.1:3201/api/v1/request-logs ^
  -H "Content-Type: application/json" ^
  -H "x-site-ingestion-key: YOUR_INGESTION_KEY" ^
  -d "{\"siteId\":\"YOUR_SITE_ID\",\"occurredAt\":\"2026-04-01T09:30:00.000Z\",\"method\":\"GET\",\"host\":\"example.com\",\"path\":\"/login\",\"statusCode\":200,\"clientIp\":\"203.0.113.10\",\"userAgent\":\"Mozilla/5.0\"}"
```

### 11. 执行检测和 AI 评分

```bash
curl -X POST http://127.0.0.1:3201/api/v1/detection/run ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"tenantId\":\"YOUR_TENANT_ID\",\"limit\":50}"
```

响应中会同时返回检测处理数量与 AI 后处理数量：

```json
{
  "success": true,
  "data": {
    "processedCount": 3,
    "eventCount": 2,
    "logsWithFindings": 2,
    "aiSuccessCount": 2,
    "aiFailureCount": 0,
    "tenantIds": ["..."]
  }
}
```

检测流程始终先落库 `attack_events`，随后再执行 AI 评分并写入 `ai_risk_results`。如果分析器调用失败，`attack_events` 仍会保留已提交状态，同时 `aiFailureCount` 会增加。

### 12. 查询请求日志

```bash
curl "http://127.0.0.1:3201/api/v1/request-logs?tenantId=YOUR_TENANT_ID" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

可选过滤条件：

```text
siteId
clientIp
method
statusCode
startAt
endAt
processedForDetection
limit
```

示例：

```bash
curl "http://127.0.0.1:3201/api/v1/request-logs?tenantId=YOUR_TENANT_ID&siteId=YOUR_SITE_ID&clientIp=203.0.113.10&method=GET&statusCode=200&startAt=2026-04-02T00:00:00.000Z&endAt=2026-04-03T00:00:00.000Z&processedForDetection=true&limit=20" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 13. 查询攻击事件

```bash
curl "http://127.0.0.1:3201/api/v1/attack-events?tenantId=YOUR_TENANT_ID" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 14. 查询攻击事件详情

```bash
curl "http://127.0.0.1:3201/api/v1/attack-events/YOUR_ATTACK_EVENT_ID" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

详情响应包含：

- `attackEvent`
- `requestLog`
- `aiRiskResult`（如果暂无分析结果则为 `null`）

### 15. 查询 AI 风险结果

```bash
curl "http://127.0.0.1:3201/api/v1/ai-risk-results?tenantId=YOUR_TENANT_ID" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

可选过滤条件：

```text
siteId
riskLevel
startAt
endAt
limit
```

示例：

```bash
curl "http://127.0.0.1:3201/api/v1/ai-risk-results?tenantId=YOUR_TENANT_ID&siteId=YOUR_SITE_ID&riskLevel=high&startAt=2026-04-02T00:00:00.000Z&endAt=2026-04-03T00:00:00.000Z&limit=20" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 触发攻击检测

针对单个租户手动触发检测：

```bash
curl -X POST http://127.0.0.1:3201/api/v1/detection/run ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"tenantId\":\"YOUR_TENANT_ID\",\"limit\":50}"
```

也可以省略 `tenantId`，处理当前用户有权限访问的所有租户。

## 如何验证攻击事件会被自动生成

1. Submit several suspicious request logs through `POST /api/v1/request-logs`
2. Call `POST /api/v1/detection/run`
3. Query `GET /api/v1/request-logs?tenantId=YOUR_TENANT_ID`
4. Query `GET /api/v1/attack-events?tenantId=YOUR_TENANT_ID`
5. Query `GET /api/v1/attack-events/YOUR_ATTACK_EVENT_ID`
6. Query `GET /api/v1/ai-risk-results?tenantId=YOUR_TENANT_ID`

SQL 注入可疑请求日志示例：

```bash
curl -X POST http://127.0.0.1:3201/api/v1/request-logs ^
  -H "Content-Type: application/json" ^
  -H "x-site-ingestion-key: YOUR_INGESTION_KEY" ^
  -d "{\"siteId\":\"YOUR_SITE_ID\",\"occurredAt\":\"2026-04-01T09:31:00.000Z\",\"method\":\"GET\",\"host\":\"example.com\",\"path\":\"/login\",\"queryString\":\"id=1 UNION SELECT password FROM users\",\"statusCode\":200,\"clientIp\":\"203.0.113.10\",\"userAgent\":\"Mozilla/5.0\"}"
```

XSS 可疑请求日志示例：

```bash
curl -X POST http://127.0.0.1:3201/api/v1/request-logs ^
  -H "Content-Type: application/json" ^
  -H "x-site-ingestion-key: YOUR_INGESTION_KEY" ^
  -d "{\"siteId\":\"YOUR_SITE_ID\",\"occurredAt\":\"2026-04-01T09:32:00.000Z\",\"method\":\"GET\",\"host\":\"example.com\",\"path\":\"/search\",\"queryString\":\"q=<script>alert(1)</script>\",\"statusCode\":200,\"clientIp\":\"203.0.113.11\",\"userAgent\":\"Mozilla/5.0\"}"
```

扫描工具 User-Agent 可疑请求日志示例：

```bash
curl -X POST http://127.0.0.1:3201/api/v1/request-logs ^
  -H "Content-Type: application/json" ^
  -H "x-site-ingestion-key: YOUR_INGESTION_KEY" ^
  -d "{\"siteId\":\"YOUR_SITE_ID\",\"occurredAt\":\"2026-04-01T09:33:00.000Z\",\"method\":\"GET\",\"host\":\"example.com\",\"path\":\"/admin\",\"statusCode\":404,\"clientIp\":\"203.0.113.12\",\"userAgent\":\"sqlmap/1.8.4\"}"
```

简化版高频访问测试示例：

在 1 分钟内对同一个 `siteId` 和 `clientIp` 提交 5 条或更多请求日志，然后触发一次检测。

## 当前检测规则

- SQL 注入关键字
- XSS 载荷片段
- 同一客户端 IP 的高频访问
- 可疑 User-Agent 字符串

`attack_events` 应通过 `POST /api/v1/detection/run` 生成。

## 站点中间件防护检查接口

`POST /api/v1/protection/check` 面向企业网站本地中间件调用，只做防护决策判断，不写入 `request_logs`，可用于站点侧先决定 allow / monitor / block。

请求头仍使用站点专属 ingestion key：

```bash
x-site-ingestion-key: YOUR_INGESTION_KEY
```

请求体示例：

```json
{
  "siteId": "YOUR_SITE_ID",
  "occurredAt": "2026-04-02T12:00:00.000Z",
  "method": "GET",
  "host": "example.com",
  "path": "/login",
  "queryString": "id=1 UNION SELECT password FROM users",
  "clientIp": "203.0.113.10",
  "userAgent": "Mozilla/5.0",
  "referer": "https://example.com"
}
```

响应示例：

```json
{
  "success": true,
  "data": {
    "siteId": "YOUR_SITE_ID",
    "protection": {
      "mode": "protect",
      "action": "block",
      "reasons": ["blocked_sql_injection"]
    }
  }
}
```

## AI 风险结果契约

`apps/api` 按如下固定契约将分析器结果持久化到 `ai_risk_results`：

- `model_name = heuristic-analyzer`
- `model_version = v1`
- `reasons` 在 `factors.reasons` 和 `raw_response.reasons` 中都保持数组语义
- `explanation` 是由 reasons 数组生成的可读说明文本
- 当前 MVP 流程中，基于检测生成的结果会写入 `attack_event_id`

## AI 失败与重试策略

当前已实现的 API 集成策略如下：

- 攻击检测与 `attack_events` 创建不能因为分析器不可用而失败
- AI 评分在检测结果落库之后执行，而不是之前
- 分析器请求使用显式超时配置
- 重试次数有上限，不会无限重试

当前环境参数：

```bash
AI_ANALYZER_TIMEOUT_MS=1500
AI_ANALYZER_MAX_RETRIES=1
```

可选的可疑 User-Agent 允许名单：

```bash
DETECTION_SUSPICIOUS_UA_ALLOWLIST=uptimerobot,pingdom
```

## 最小 AI 集成验证

执行检测后，可以通过 API 验证完整后端闭环：

```bash
curl "http://127.0.0.1:3201/api/v1/ai-risk-results?tenantId=YOUR_TENANT_ID&riskLevel=high" ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

如有需要，也可以继续用 SQL 直接验证：

```sql
SELECT
  ae.id AS attack_event_id,
  ae.event_type,
  arr.id AS ai_risk_result_id,
  arr.model_name,
  arr.model_version,
  arr.risk_score,
  arr.risk_level,
  arr.factors->'reasons' AS reasons
FROM attack_events ae
LEFT JOIN ai_risk_results arr
  ON arr.attack_event_id = ae.id
WHERE ae.tenant_id = 'YOUR_TENANT_ID'
ORDER BY ae.id DESC;
```

## 自动化测试

API 包含一组最小集成测试，覆盖：

- 认证与租户授权
- 检测处理与 `high_frequency_access` 去重
- AI 分析器写入 `ai_risk_results` 的集成流程
- `request_logs`、`ai_risk_results`、`attack_events/:id` 等核心查询接口

在仓库根目录执行：

```bash
npm run build:api
npm run test:api
```

默认测试前置条件：

- PostgreSQL 可通过 `127.0.0.1:5432` 访问，默认跟随 `apps/api/.env` 里的 `DATABASE_URL`
- `services/ai-analyzer` 的 Python 依赖已安装

可选覆盖项：

```bash
TEST_DATABASE_URL=postgresql://...
TEST_DB_SSL_MODE=disable
TEST_API_PORT=45180
TEST_AI_PORT=45280
```
