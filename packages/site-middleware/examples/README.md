# Site Middleware 接入 Demo

这个目录中的 `native-node-server.ts` 不只是代码片段，它现在承担一个更明确的角色：

- 企业站点接入平台时的最小 Node.js 接入样板
- 平台端、`site-middleware`、`POST /api/v1/protection/check` 关系的演示入口
- 接入后“怎样验证已经打通”的验收模板

## 第一次接手的最短路径

如果你第一次要把一个真实站点按标准方式接进来，默认先走这一条：

```powershell
npm run dev:demo-stack
npm run build --workspace @secuai/site-middleware
npm run demo:onboard-native-site --workspace @secuai/site-middleware
```

然后按固定顺序确认三件事：

1. 复用统一入口拉起平台栈
2. 先用 `demo:onboard-native-site` 自动拿到真实：
   - `email / password`
   - `tenantId`
   - `siteId`
   - `ingestionKey`
   - 并自动写入 `packages/site-middleware/.env`
   - 然后直接拉起 `demo:native-node`
3. 启动后的最小接入样板验证：
   - 普通请求返回 `allow`
   - 同一 blocked IP 在 `monitor` 下返回 `monitor`
   - 只把 policy mode 切到 `protect` 后返回 `403 + REQUEST_BLOCKED`

这条路径通过后，你至少已经确认了三件事：

- 平台 API 是可用的
- `site-middleware` 能真实调用 `POST /api/v1/protection/check`
- 真实站点接入样板已经具备最小可验证的 enforcement 闭环

如果你现在还没有真实 `siteId` / `ingestionKey`，不要硬跑 `demo:native-node`。它现在会直接拒绝占位配置启动，避免把“假启动”误当成“已接通”。
如果你还没有真实站点配置，也不要自己手工摸平台注册流程；优先先跑 `demo:onboard-native-site`，它现在会直接完成 onboarding、写入 `.env`，并继续拉起最小接入样板。

## 想先看整条链路能否自己跑通

如果你此刻还没有真实 site 配置，只是想先确认“平台 + middleware + 留痕分析”整条链路能不能自己跑通，再使用：

```powershell
npm run dev:demo-stack
npm run build --workspace @secuai/site-middleware
npm run demo:e2e-monitor --workspace @secuai/site-middleware
```

这条路径会自动建演示用户、tenant 和 site，更适合：

- 第一次熟悉仓库
- 演示 middleware 到主分析链路的贯通
- 先确认这套能力在本机环境里可跑

它不是“真实站点第一次接入”的默认路径；真实接入仍以上面的 `.env + demo:native-node` 为准。

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

## 四个角色分别负责什么

把这个样板看成四层会更容易理解：

| 角色 | 职责 | 本轮是否改造 |
| --- | --- | --- |
| 平台管理端(`/dashboard/policies`) | 配置 site 级 `security policy` 和 `blocked entities` | 否 |
| 平台判定接口(`POST /api/v1/protection/check`) | 给出真实 `allow / monitor / block` 结果 | 否 |
| `site-middleware` | 提取站点请求特征，调用平台判定接口，并在本地执行放行或阻断 | 否 |
| `native-node-server.ts` | 演示企业站点如何最小接入 `site-middleware`，以及接入后的可见结果 | 是，本轮只增强理解与验收体验 |

对应链路如下：

```text
企业站点请求
-> native-node demo
-> site-middleware
-> POST /api/v1/protection/check
-> 返回 allow / monitor / block
-> demo 继续返回 200，或直接返回 403 + REQUEST_BLOCKED
```

理解重点：
- 真正的决策来自平台 API，不在 demo 本地硬编码
- demo 和 `/dashboard/policies` 验证的是同一套 site policy / blocked entities
- 本轮不是把站点改造成网关，而是让现有站点能最小接入平台判定能力

## 使用前提

开始前，先准备好：

1. PostgreSQL 和 Redis 已启动
2. API 已运行在 `http://127.0.0.1:3201`
3. 已创建一个真实 site，并保存：
   - `siteId`
   - `ingestionKey`
4. 如需配合平台演示，建议同时打开 `/dashboard/policies?siteId=...`

补充说明：

- 如果你的目标是把自己的真实站点接进来，优先走上面的 `.env + demo:native-node`
- 如果你的目标只是第一次确认“这套东西到底能不能跑通”，再走 `demo:e2e-monitor`

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
- 一组“接入验收顺序”和预期现象

## 接入成功确认 Checklist

如果你不是项目作者，只想确认“企业网站是否已经顺利接上平台”，按这份 checklist 执行即可。

### A. 接入前准备

- [ ] PostgreSQL 和 Redis 已启动
- [ ] API 已运行在 `http://127.0.0.1:3201`
- [ ] 已有一个真实 site，并拿到：
  - `siteId`
  - `ingestionKey`
  - 站点域名
- [ ] 已把 `packages/site-middleware/.env.example` 复制为 `packages/site-middleware/.env`
- [ ] 已填入真实：
  - `SECUAI_PLATFORM_URL`
  - `SECUAI_SITE_ID`
  - `SECUAI_SITE_INGESTION_KEY`
  - `SECUAI_SITE_PORT`

### B. 接入后先检查什么

先确认平台和 demo 都处于“可验证”状态：

- [ ] `curl http://127.0.0.1:3201/health` 返回 `success: true`
- [ ] `npm run demo:native-node --workspace @secuai/site-middleware` 能正常启动
- [ ] demo 启动后终端能看到：
  - 当前接入配置
  - 演示地址
  - 接入链路
  - 最小接入验收顺序

如果这一步还没通过，不要急着看 `allow / monitor / block`，先把 API 连通性和 `.env` 填写问题排干净。

### C. 怎样确认 `protection/check` 已接通

目标不是先看阻断，而是先确认平台判定接口已经真实参与了决策。

- [ ] 用普通请求访问 demo：

```powershell
curl http://127.0.0.1:8080/
```

- [ ] 返回 `200`
- [ ] 响应头 `x-secuai-protection-action = allow`
- [ ] 响应 JSON 中 `protection.action = allow`

满足这几条，说明：
- demo 已经把请求交给 `site-middleware`
- `site-middleware` 已经能调用平台
- 平台 `POST /api/v1/protection/check` 已经返回可执行的判定结果

### D. 怎样确认 middleware 已接通

确认 middleware 已接通，关键看两件事：

1. 它不是自己私下做规则判断
2. 它能把平台判定结果真实执行成站点侧响应

执行方式：

- [ ] 在 `/dashboard/policies` 中，把当前站点策略设为 `monitor`
- [ ] 给同一站点新增 blocked IP，例如 `203.0.113.77`
- [ ] 再请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

- [ ] 返回 `200`
- [ ] 响应头 `x-secuai-protection-action = monitor`
- [ ] 响应 JSON 中：
  - `protection.action = monitor`
  - `protection.mode = monitor`
  - `protection.reasons` 包含 `blocked_ip`

满足这几条，说明 middleware 不只是“能调用 API”，而是已经在真实执行平台返回的 `monitor` 结果。

### E. 怎样确认 policy mode 变化会真实影响结果

这是“接入成功”里最关键的一步，因为它能证明平台端 policy 变化会真正驱动站点侧行为变化。

- [ ] 保持同一个 blocked IP
- [ ] 保持同一个请求
- [ ] 只把同一站点的 policy mode 从 `monitor` 切到 `protect`
- [ ] 再执行同一条请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

- [ ] 返回 `403`
- [ ] 返回 JSON 中：
  - `success = false`
  - `error.code = REQUEST_BLOCKED`
  - `error.details.mode = protect`
  - `error.details.reasons` 包含 `blocked_ip`

如果这一步成立，就说明：
- policy mode 变化不是页面假效果
- 平台 `protection/check` 判定已经真实影响 middleware 行为
- 站点侧已经具备最小可验证的 enforcement 闭环

### F. 接入成功的最小结论

当下面三条同时成立时，就可以认为“企业网站已经最小接上平台”：

- [ ] 普通请求返回 `allow`
- [ ] 同一 blocked IP 在 `monitor` 下返回 `monitor`
- [ ] 不改请求、只改 policy mode 到 `protect` 后返回 `403 + REQUEST_BLOCKED`

这三条缺一不可。

## 两类基础规则验收 Runbook

如果你已经完成最小接入，下一步最值得确认的不是继续堆更多规则，而是先把两类基础规则跑通：

1. `blocked_ip`
2. `blocked_rate_limit`

这两类规则都跑通，接入方通常就能确认三件事：

- 平台 `POST /api/v1/protection/check` 已经在真实参与判定
- `site-middleware` 执行的是平台返回结果，而不是本地私有规则
- `monitor / protect` 两种 mode 都会真实影响站点侧表现

### 1. 先确认什么算“平台判定与 middleware 已一致”

不管你验证的是 `blocked_ip` 还是 `blocked_rate_limit`，一致性的判定口径都相同：

- 平台端直接调用 `POST /api/v1/protection/check` 得到的 `action / mode / reasons`
- native demo 返回的 `protection.action / protection.mode / protection.reasons`
- native demo 被阻断时返回的 `403 + REQUEST_BLOCKED` 里的 `error.details.mode / error.details.reasons`

这三处如果能对上，就可以认为“平台判定与 middleware 已一致”。

### 2. 怎样验证 `blocked_ip` 已生效

这是最直观、最适合第一次接入时使用的规则验收。

#### 前置准备

- 在 `/dashboard/policies` 中选择当前站点
- 把 policy mode 设为 `monitor`
- 给当前站点新增 blocked IP，例如 `203.0.113.77`
- 确认 native demo 已启动

#### monitor 下应该看到什么

请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：

- 返回 `200`
- 响应头 `x-secuai-protection-action = monitor`
- 响应 JSON 中：
  - `protection.action = monitor`
  - `protection.mode = monitor`
  - `protection.reasons` 包含 `blocked_ip`

#### protect 下应该看到什么

保持同一个 blocked IP、同一条请求，只把 policy mode 从 `monitor` 切到 `protect`，再请求一次：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：

- 返回 `403`
- 返回 JSON 中：
  - `success = false`
  - `error.code = REQUEST_BLOCKED`
  - `error.details.mode = protect`
  - `error.details.reasons` 包含 `blocked_ip`

#### 用 smoke 怎样收口

```powershell
npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware
```

预期输出：

- `initial allow verified`
- `monitor after blocked entity verified`
- `block in protect mode verified`
- `allow after blocked entity removal verified`

这条 smoke 更适合回答：

- blocked IP 在 `monitor / protect` 下是否真的会改变结果
- 删除 blocked IP 后结果是否能恢复
- API 与 middleware 在整个生命周期里是否保持一致

### 3. 怎样验证 `blocked_rate_limit` 已生效

这类规则更接近“平台按请求行为判定”，它不是靠手工加 blocked IP，而是靠同一 IP 的近期请求数达到阈值后触发。

#### 前置准备

- 在 `/dashboard/policies` 中选择当前站点
- 确认 `enableRateLimit = true`
- 把 `rateLimitThreshold` 调到一个便于验证的值，例如 `2`
- 先把 policy mode 设为 `monitor`
- 确认 native demo 已启动

#### monitor 下应该看到什么

rate limit 的最小验证，不是先看第一次请求，而是先让同一 IP 的近期请求数达到阈值，再看下一次判定。

推荐直接用 smoke 收口：

```powershell
npm run smoke:rate-limit-lifecycle --workspace @secuai/site-middleware
```

在 `monitor` 阶段，预期现象是：

- 脚本先输出 `initial allow before rate limit verified`
- 当同一 IP 达到阈值后，输出 `monitor after rate limit threshold verified`
- 对应结果里：
  - `action = monitor`
  - `mode = monitor`
  - `reasons = ["blocked_rate_limit"]`

#### protect 下应该看到什么

仍然保持同一个站点、同一个请求特征、同一个触发 rate limit 的 IP，只把 policy mode 切到 `protect`。

预期现象：

- smoke 输出 `block in protect mode after rate limit threshold verified`
- 对应结果里：
  - `action = block`
  - `mode = protect`
  - `reasons = ["blocked_rate_limit"]`
- native demo 返回 `403 + REQUEST_BLOCKED`

#### 这类规则特别要看什么

验证 `blocked_rate_limit` 时，最值得看的不是“是不是拦住了”，而是下面两点：

- `reasons` 是否稳定为 `blocked_rate_limit`
- 同一类请求在 `monitor` 下是 `monitor`，在 `protect` 下才变成 `block`

只有这样，接入方才能确认这不是随机现象，而是平台 policy mode 在真实驱动 middleware 结果。

### 4. 两类规则各自适合证明什么

`blocked_ip` 更适合证明：

- 管理动作变更会立刻影响判定
- `blocked entities` 与 middleware 的联动已打通
- 最小站点接入链路已经可解释

`blocked_rate_limit` 更适合证明：

- 平台不只支持手工封禁，还能对基础请求行为做真实判定
- 判定原因 `blocked_rate_limit` 是稳定、可解释的
- 第二类基础规则同样能驱动 `monitor / protect` 两种结果

### 5. 给接入方的最小结论

如果下面两类规则都已经跑通：

- `blocked_ip` 能从 `monitor` 走到 `block`
- `blocked_rate_limit` 也能从 `monitor` 走到 `block`

并且每一步里 API 与 middleware 的 `action / mode / reasons` 都一致，就可以认为：

- 站点已经不只是“接上平台”
- 而是已经具备“两类基础规则可验证生效”的最小产品接入状态

## 常见错误与最小排查

### 1. API 不可用

现象：
- demo 启动后请求表现为 `fail-open`
- 或请求根本拿不到有效 protection 结果

最小排查：

```powershell
curl http://127.0.0.1:3201/health
```

如果失败，先启动 API，再继续后面的接入确认。

### 2. `INVALID_INGESTION_KEY`

现象：
- protection 判断失败
- simulator 或 middleware 拿不到合法结果

最小排查：
- 确认 `SECUAI_SITE_INGESTION_KEY` 是当前 site 的真实 key
- 确认它和 `SECUAI_SITE_ID` 是同一个 site 对应的一组数据

### 3. `INGESTION_KEY_REQUIRED`

现象：
- 直接判定请求在进入 protection 逻辑前就失败

最小排查：
- 确认 middleware 使用的 client 已带上 `x-site-ingestion-key`
- 确认 demo 读取到的不是占位值

### 4. policy 看起来改了，但结果没变

现象：
- `/dashboard/policies` 上已经显示新 mode
- 但 demo 结果没有变化

最小排查：
- 确认当前操作的是同一个 `siteId`
- 确认 blocked IP 与请求头 `x-forwarded-for` 一致
- 确认你重复请求的是同一条请求，而不是换了输入

### 5. demo 能启动，但还不能说明接入成功

现象：
- 服务能起
- 但只做了普通请求验证

最小排查：
- 不要只看 demo 是否启动
- 必须继续验证 `monitor`
- 必须继续验证只切 policy mode 后是否变成 `403 + REQUEST_BLOCKED`

## Checklist 对应的详细说明

如果你已经看过上面的 checklist，这一节是对应三步确认动作的展开说明。

### 验收前置条件

1. API 已可用：

```powershell
curl http://127.0.0.1:3201/health
```

预期现象：
- 返回 `success: true`

2. 当前站点已准备好真实：
- `siteId`
- `ingestionKey`

3. `packages/site-middleware/.env` 中已经填入真实 `SECUAI_SITE_ID` 与 `SECUAI_SITE_INGESTION_KEY`

### 第 1 步: 验证基础 allow

```powershell
curl http://127.0.0.1:8080/
```

验收标准：
- 返回 `200`
- 响应头 `x-secuai-protection-action` 为 `allow`
- 响应 JSON 中 `protection.action = allow`

这一步证明：
- demo 能正常接收站点请求
- middleware 能正常调用平台
- 在未命中风险时，平台会返回可执行的 allow 结果

### 第 2 步: 验证 monitor 联动

先在 `/dashboard/policies` 中对同一站点做两件事：
- 把策略设为 `monitor`
- 新增 blocked IP，例如 `203.0.113.77`

再请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

验收标准：
- 返回 `200`
- `x-secuai-protection-action = monitor`
- 响应 JSON 中：
  - `protection.action = monitor`
  - `protection.mode = monitor`
  - `protection.reasons` 包含 `blocked_ip`

这一步证明：
- 平台端 policy / blocked entities 的改动已经联动到站点侧
- middleware 没有自己私下做规则判断，而是在执行平台返回的 `monitor`

### 第 3 步: 验证 protect 联动

仍然使用同一个 blocked IP，不改请求，只把同一站点策略从 `monitor` 切到 `protect`。

再请求：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

验收标准：
- 返回 `403`
- 返回 JSON 中：
  - `success = false`
  - `error.code = REQUEST_BLOCKED`
  - `error.details.mode = protect`
  - `error.details.reasons` 包含 `blocked_ip`

这一步证明：
- 同一个站点、同一个请求特征、同一个 blocked IP
- 只因平台 policy mode 变化，站点侧动作就从 `monitor` 变成 `block`
- 说明真正的判定源头是平台 `POST /api/v1/protection/check`

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

如果你需要一句最短的话向接入方解释：

> 平台负责判定，middleware 负责执行，native demo 负责把这条链路演示清楚。

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

## 接入成功的最小结论

当你同时看到下面三件事时，就可以认为“企业站点已经最小接上平台”：

1. 普通请求返回 `allow`
2. 同一 blocked IP 在 `monitor` 下返回 `monitor`
3. 不改请求、只改 policy mode 到 `protect` 后返回 `403 + REQUEST_BLOCKED`

这说明：
- 平台端配置生效
- `site-middleware` 与 `POST /api/v1/protection/check` 已打通
- 站点侧已经具备最小可验证的 enforcement 闭环
