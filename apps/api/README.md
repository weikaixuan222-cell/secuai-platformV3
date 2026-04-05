# SecuAI API

`apps/api` 是 SecuAI 的 Node.js + TypeScript 后端 API。
当前阶段保持主链路稳定，同时补齐最小防护能力：

- `request_logs`
- `detection`
- `attack_events`
- `ai_risk_results`
- `security_policies`
- `blocked_entities`
- `protection/check`

## 启动
在仓库根目录执行：

```powershell
docker compose up -d
npm run db:schema --workspace @secuai/api
npm run dev --workspace @secuai/api
```

默认地址：

```text
http://127.0.0.1:3201
```

健康检查：

```powershell
curl http://127.0.0.1:3201/health
```

## site ingestion key
site ingestion key 是 site 级专用接入凭证，用于：
- `POST /api/v1/protection/check`
- `POST /api/v1/request-logs`

前置条件：
- 先完成 user / tenant / site 创建
- `POST /api/v1/sites` 成功时会返回一次性 `ingestionKey`
- API 后端只保存哈希值，不支持再次查询明文

## 与最小防护能力相关的接口
- `GET /api/v1/sites/:siteId/security-policy`
- `PUT /api/v1/sites/:siteId/security-policy`
- `GET /api/v1/sites/:siteId/blocked-entities`
- `POST /api/v1/sites/:siteId/blocked-entities`
- `DELETE /api/v1/blocked-entities/:id`
- `POST /api/v1/protection/check`
- `POST /api/v1/request-logs`

## `POST /api/v1/protection/check`
这个接口只做“防护判定”，不写入 `request_logs`。
它适合给：
- `/dashboard/policies` 中的 protection simulator
- `packages/site-middleware`

请求头：

```text
x-site-ingestion-key: YOUR_INGESTION_KEY
```

请求体示例：

```json
{
  "siteId": "YOUR_SITE_ID",
  "occurredAt": "2026-04-05T12:00:00.000Z",
  "method": "GET",
  "host": "example.com",
  "path": "/login",
  "queryString": "id=1 UNION SELECT password FROM users",
  "clientIp": "203.0.113.10",
  "userAgent": "sqlmap/1.8.4",
  "referer": "https://example.com"
}
```

成功响应示例：

```json
{
  "success": true,
  "data": {
    "siteId": "YOUR_SITE_ID",
    "protection": {
      "mode": "protect",
      "action": "block",
      "reasons": ["blocked_sql_injection", "blocked_suspicious_user_agent"]
    }
  }
}
```

## `POST /api/v1/request-logs` 与 `protection/check` 的关系
- `protection/check`
  - 只返回防护决策
  - 不写入 request log
- `request-logs`
  - 在写入前也会执行同一套 protection enforcement
  - 如果 policy 为 `monitor` 且命中规则：
    - 继续写入
    - 响应体里带 `protection`
    - 元数据里保留 protection 信息
  - 如果 policy 为 `protect` 且命中规则：
    - 返回 `403 PROTECTION_BLOCKED`
    - 不写入 request log

## 常见失败码
| code | 典型场景 | 说明 |
| --- | --- | --- |
| `INGESTION_KEY_REQUIRED` | 未传 `x-site-ingestion-key` | `protection/check` 和 `request-logs` 都会要求 |
| `INVALID_INGESTION_KEY` | key 错误 | 当前最常见的 simulator / middleware 失败原因 |
| `SITE_NOT_FOUND` | siteId 不存在或 site 非 active | protection 相关接口会返回 |
| `VALIDATION_ERROR` | 字段格式不合法 | 例如 path、occurredAt、IP、expiresAt、mode |
| `PROTECTION_BLOCKED` | `request-logs` 在 protect 模式下命中阻断 | 返回 403，并带 `mode` 与 `reasons` |

## `/dashboard/policies` 最小演示步骤
1. 登录并创建 tenant、site。
2. 保存 `POST /api/v1/sites` 返回的 `ingestionKey`。
3. 打开 Web 的 `/dashboard/policies?siteId=...`。
4. 读取或更新 `security policy`。
5. 新增一个 blocked IP。
6. 在 protection simulator 中：
   - 输入正确 ingestion key
   - 输入同一个 client IP
   - 查看返回 `allow / monitor / block`
7. 如需站点侧验证，再运行 `site-middleware` enforcement smoke。

## 验证
```powershell
npm run db:schema --workspace @secuai/api
npm run build --workspace @secuai/api
npm run test --workspace @secuai/api
```

如需联动验证 middleware：

```powershell
npm run build --workspace @secuai/site-middleware
npm run smoke:e2e-enforcement --workspace @secuai/site-middleware
```

## 当前范围
当前 API 仍服务于“日志接入平台向最小 enforcement 过渡”的阶段，不做：
- reverse proxy
- full traffic gateway
- 重型流量基础设施改造
