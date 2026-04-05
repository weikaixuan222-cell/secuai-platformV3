# Site Middleware 接入 Demo

这个目录中的 `native-node-server.ts` 现在不仅是代码示例，也可以直接作为本地演示样板使用。

## 这个样板能演示什么

它能直接演示：
- 站点侧如何接入 `site-middleware`
- 请求如何调用 `POST /api/v1/protection/check`
- `allow / monitor / block` 三种结果在站点侧的可见表现
- `block` 时如何返回 `403` 和 `REQUEST_BLOCKED`
- `requestLogReporting` 如何按配置决定是否异步写入 `request_logs`

它不负责演示：
- reverse proxy
- full traffic gateway
- 重型站点接入框架

## 使用前提

开始前，先准备好：

1. PostgreSQL 和 Redis 已启动
2. API 已运行在 `http://127.0.0.1:3201`
3. 已创建一个真实 site，并保存：
   - `siteId`
   - `ingestionKey`
4. 如需配合平台演示，建议同时打开 `/dashboard/policies?siteId=...`

## 环境变量

先把 `packages/site-middleware/.env.example` 复制为 `packages/site-middleware/.env`，再填入真实值：

```powershell
Copy-Item packages/site-middleware/.env.example packages/site-middleware/.env
```

需要重点填写：

```text
SECUAI_PLATFORM_URL=http://127.0.0.1:3201
SECUAI_SITE_ID=真实 siteId
SECUAI_SITE_INGESTION_KEY=真实 ingestionKey
SECUAI_SITE_PORT=8080
SECUAI_REPORT_REQUEST_LOGS=true
SECUAI_REPORT_REQUEST_LOG_SCOPE=monitor
```

说明：
- 样板会优先读取 `packages/site-middleware/.env`
- 如果进程环境变量里已有同名值，则不会被 `.env` 覆盖

## 最小运行命令

在仓库根目录执行：

```powershell
npm run build --workspace @secuai/site-middleware
npm run demo:native-node --workspace @secuai/site-middleware
```

启动后，终端会输出：
- 当前接入配置
- 演示地址
- 推荐的 `curl` 访问示例

## 如何看 `allow / monitor / block`

### 1. allow

直接访问一个普通请求：

```powershell
curl http://127.0.0.1:8080/
```

预期现象：
- 返回 `200`
- 返回 JSON 中包含：
  - `request`
  - `protection.action`
  - `protection.mode`
  - `protection.reasons`

### 2. monitor

先在 `/dashboard/policies` 中：
- 把当前站点策略设为 `monitor`
- 新增一个 blocked IP，例如 `203.0.113.77`

再请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：
- 返回 `200`
- `protection.action = monitor`
- `protection.mode = monitor`
- `reasons` 至少包含 `blocked_ip`

### 3. block

仍然使用同一个 blocked IP，但先在 `/dashboard/policies` 中把策略切到 `protect`。

再请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：
- 返回 `403`
- 返回 JSON 中：
  - `success = false`
  - `error.code = REQUEST_BLOCKED`
  - `error.details.mode = protect`
  - `error.details.reasons` 包含实际命中的原因

## 与平台端的关系

这个 demo 的职责很明确：

1. 从站点请求里提取特征
2. 调用平台端 `POST /api/v1/protection/check`
3. 根据平台返回结果执行：
   - 放行
   - monitor
   - 阻断

也就是说：
- 决策逻辑不在 demo 里
- demo 只是平台能力的站点侧接入样板

## 演示建议顺序

推荐这样讲：

1. 先在 `/dashboard/policies` 配好 policy 和 blocked IP
2. 再启动这个 native node demo
3. 用 `curl` 或浏览器访问 demo 地址
4. 依次展示：
   - `allow`
   - `monitor`
   - `block`
5. 最后再补一句：
   - “这个站点侧样板只是调用平台的 protection/check，不是独立规则系统”

## 常见失败点

### 未配置真实 siteId 或 ingestion key

现象：
- 启动时出现占位值警告
- 请求大概率只会得到 fail-open 或平台认证失败

处理：
- 填写真实 `SECUAI_SITE_ID`
- 填写真实 `SECUAI_SITE_INGESTION_KEY`

### API 不可用

现象：
- 站点请求返回 `failOpen = true`

处理：

```powershell
curl http://127.0.0.1:3201/health
```

### 平台策略看起来没生效

现象：
- 在 `/dashboard/policies` 已改策略，但 demo 返回的结果不符合预期

处理：
- 确认当前 demo 使用的是同一个 `siteId`
- 确认 blocked IP 填写与 `x-forwarded-for` 一致
- 确认策略已保存成功
