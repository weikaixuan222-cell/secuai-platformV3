# SecuAI 站点接入中间件

面向企业网站服务端的最小 Node.js 防护接入 helper。它不会启动反向代理，也不会把站点改造成全流量网关，只是在业务服务处理请求前调用 SecuAI 平台的防护判断接口。

## 功能

- 提取请求特征：`method`、`path`、`queryString`、`clientIp`、`userAgent`、`host`、`referer`
- 调用平台接口：`POST /api/v1/protection/check`
- 根据返回决策处理请求：
  - `allow`：继续业务处理
  - `monitor`：继续业务处理，并在决策对象里标记 `monitored = true`
  - `block`：直接写出阻断响应
- 支持异步留痕上报到 `POST /api/v1/request-logs`
  - `scope = "monitor"`：只在 monitor 命中时异步上报
  - `scope = "all"`：allow 和 monitor 都异步上报
  - `block`：永远不上报
- 平台超时或不可用时默认 fail-open：返回 `action = "allow"`、`mode = "fail-open"`，并附带 `failOpenReason`

## 构建与测试

在仓库根目录执行：

```bash
npm run build --workspace @secuai/site-middleware
npm run test --workspace @secuai/site-middleware
```

如只做类型检查：

```bash
npm run typecheck --workspace @secuai/site-middleware
```

## 原生 Node 接入示例

示例代码位于 `packages/site-middleware/examples/native-node-server.ts`。

运行前先构建包：

```bash
npm run build --workspace @secuai/site-middleware
```

如需直接运行示例服务，可参考 `packages/site-middleware/.env.example` 设置：

```bash
SECUAI_PLATFORM_URL=http://127.0.0.1:3201
SECUAI_SITE_ID=your-site-id
SECUAI_SITE_INGESTION_KEY=your-site-ingestion-key
SECUAI_REPORT_REQUEST_LOGS=true
SECUAI_REPORT_REQUEST_LOG_SCOPE=monitor
```

然后在你的企业网站服务中按以下方式调用：

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
    "Content-Type": "application/json; charset=utf-8",
    "x-secuai-protection-action": decision.action,
    "x-secuai-monitored": String(decision.monitored)
  });
  response.end(
    JSON.stringify({
      ok: true,
      protection: decision
    })
  );
});

server.listen(8080, "127.0.0.1");
```

## 配置说明

- `platformBaseUrl`：SecuAI API 地址，例如 `http://127.0.0.1:3201`
- `siteId`：站点 ID
- `siteIngestionKey`：站点专属 ingestion key，通过 `x-site-ingestion-key` 调用平台接口
- `timeoutMs`：平台防护判断超时时间，默认 `1500`
- `requestLogReporting.enabled`：是否启用异步日志上报
- `requestLogReporting.scope`：`monitor` 表示只上报 monitor 命中，`all` 表示 allow / monitor 都上报
- `requestLogReporting.timeoutMs`：异步写 `request_logs` 的请求超时时间

## 平台接口串联方式

中间件对每个站点请求先同步调用 `POST /api/v1/protection/check` 获取决策；如果结果是 `allow` 或 `monitor` 且上报策略允许，则异步调用 `POST /api/v1/request-logs` 留痕。后续平台仍通过现有主链路 `request_logs -> detection -> attack_events -> ai_risk_results` 继续分析，不在中间件里复制 detection/AI 流程。

## Fail-Open 行为

如果平台不可用、超时或返回异常响应，中间件默认 fail-open，业务请求继续放行，决策对象返回：

```json
{
  "action": "allow",
  "mode": "fail-open",
  "reasons": [],
  "monitored": false,
  "failOpen": true,
  "failOpenReason": "platform_timeout"
}
```

fail-open 场景下不会再异步上报 `request_logs`，避免对不可用平台继续追加请求。
