# SecuAI 站点侧 Middleware

`packages/site-middleware` 是面向企业站点服务端的最小 Node.js 接入 helper。
它不会把站点改造成 reverse proxy，也不是 full traffic gateway。当前只负责三件事：

1. 提取请求特征
2. 调用 `POST /api/v1/protection/check`
3. 根据返回结果执行 `allow / monitor / block`

## 它和 `protection/check` 的关系
- `site-middleware` 不自己做攻击规则判断
- 真正的 protection decision 来自平台 API：`POST /api/v1/protection/check`
- middleware 负责把站点请求上下文映射成 API 请求，并执行本地放行或阻断

当前链路：

```text
site request
-> site-middleware
-> POST /api/v1/protection/check
-> allow / monitor / block
-> if enabled and action != block: optional async POST /api/v1/request-logs
```

## 决策语义
- `allow`
  - 放行请求
- `monitor`
  - 放行请求
  - 决策对象里 `monitored = true`
  - 如启用 request log reporting，可异步写入 `request_logs`
- `block`
  - middleware 直接返回阻断响应
  - 默认写出 `403` 和 `REQUEST_BLOCKED`
- `fail-open`
  - 平台超时、不可用或返回异常时，默认放行
  - 决策对象里 `mode = fail-open`
  - 不再异步上报 `request_logs`

## site ingestion key
middleware 必须携带 site 级 ingestion key 才能调用平台：

```text
x-site-ingestion-key: YOUR_SITE_INGESTION_KEY
```

说明：
- 该 key 来自 site onboarding
- 必须与 `siteId` 一一对应
- 错误时，平台会返回 `INVALID_INGESTION_KEY`

## 最小接入示例
示例文件：
- [native-node-server.ts](E:/cursor/SecuAI智能防御系统V2.0/packages/site-middleware/examples/native-node-server.ts)
- [examples/README.md](E:/cursor/SecuAI智能防御系统V2.0/packages/site-middleware/examples/README.md)

核心调用方式：

```ts
import { createServer } from "node:http";
import {
  createSiteProtectionClient,
  enforceNodeRequestProtection
} from "@secuai/site-middleware";

const protectionClient = createSiteProtectionClient({
  platformBaseUrl: "http://127.0.0.1:3201",
  siteId: "your-site-id",
  siteIngestionKey: "your-site-ingestion-key",
  timeoutMs: 1500,
  requestLogReporting: {
    enabled: true,
    scope: "monitor",
    timeoutMs: 1500
  }
});

const server = createServer(async (request, response) => {
  const decision = await enforceNodeRequestProtection(request, response, protectionClient);

  if (decision.action === "block") {
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify({ ok: true, protection: decision }));
});
```

## 本地构建与测试
在仓库根目录执行：

```powershell
npm run typecheck --workspace @secuai/site-middleware
npm run build --workspace @secuai/site-middleware
npm run test --workspace @secuai/site-middleware
```

## 演示脚本
### 1. Monitor E2E demo

```powershell
npm run build --workspace @secuai/site-middleware
npm run demo:e2e-monitor --workspace @secuai/site-middleware
```

这个脚本更偏“主链路演示”，会走：
- monitor policy
- middleware monitor hit
- async request_logs
- detection
- attack_events
- ai_risk_results

### 2. Enforcement smoke

```powershell
npm run build --workspace @secuai/site-middleware
npm run smoke:e2e-enforcement --workspace @secuai/site-middleware
```

这个脚本更偏“最小 enforcement 验证”，会验证：
- `allow` 与 `POST /api/v1/protection/check` 一致
- `monitor` 与 `POST /api/v1/protection/check` 一致
- `protect` 模式下返回 `block`
- blocked IP 命中时 middleware 与 API 的 `reasons` / `mode` 一致
- middleware 的本地阻断响应返回 `REQUEST_BLOCKED`

## 最小演示步骤
1. 启动 PostgreSQL、Redis、API。
2. 运行 `smoke:e2e-enforcement`。
3. 观察脚本输出：
   - `allow consistency verified`
   - `monitor consistency verified`
   - `protect consistency verified`
4. 如需串到前端演示，再打开 `/dashboard/policies` 展示相同 site policy / blocked entities / simulator 行为。

## 常见失败码
| code | 来源 | 说明 |
| --- | --- | --- |
| `INGESTION_KEY_REQUIRED` | API | 缺少 `x-site-ingestion-key` |
| `INVALID_INGESTION_KEY` | API | ingestion key 错误或与 siteId 不匹配 |
| `SITE_NOT_FOUND` | API | site 不存在或不是 active |
| `VALIDATION_ERROR` | API | path、occurredAt、IP 等请求字段不合法 |
| `REQUEST_BLOCKED` | middleware | 本地阻断响应 code |
| `PROTECTION_BLOCKED` | API | `POST /api/v1/request-logs` 在 protect 模式下命中阻断 |

## 当前范围
这个包当前只服务于“日志接入平台向最小 enforcement 过渡”的阶段，不做：
- reverse proxy
- full traffic gateway
- 分布式限流基础设施
- 复杂 SDK 发布
