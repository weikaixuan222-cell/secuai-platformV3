# SecuAI 完整项目演示步骤

本指南面向中文读者，目标是让拿到项目的人可以直接照着操作，完成一轮完整、真实、可解释的最小防护闭环演示。

本指南只建立在当前已经完成并验证通过的真实能力之上，不包含任何虚构页面、虚构接口或未来能力。

当前演示主线固定围绕以下最小闭环展开：
- `/dashboard/policies`
- `security policy`
- `blocked entities`
- `protection simulator`
- `packages/site-middleware` 接入样板
- `blocked entity lifecycle smoke`

本轮演示不进入以下范围：
- reverse proxy
- full traffic gateway
- 重型基础设施改造

## 1. 演示目标

这轮演示要让观众清楚看到 6 件事：

1. 平台已经具备站点级 `security policy` 管理能力
2. 平台已经具备 `blocked entities` 管理能力
3. 平台可以通过 `POST /api/v1/protection/check` 给出真实的 `allow / monitor / block`
4. `/dashboard/policies` 里的 `protection simulator` 调用的是后端真实判定接口
5. `site-middleware` 可以在站点侧执行同一套判定结果
6. 管理动作变化会真实影响 enforcement 结果，而不是页面上的假效果

如果整轮演示顺利完成，最后要让观众形成一个明确结论：

- 这个项目当前还不是完整流量网关
- 但它已经具备“可管理、可判定、可执行、可验证”的最小防护闭环

## 2. 演示前置条件

开始前请确认以下条件已经满足。

### 基础环境

- 已安装 Node.js 与 npm
- 已安装 Docker Desktop 或可运行 Docker Compose 的环境
- 当前仓库可以正常执行 monorepo workspace 命令

### 必须启动的服务

- PostgreSQL
- Redis
- `apps/api`
- `apps/web`

### 本轮不强依赖的服务

- `services/ai-analyzer`

说明：
- 本轮演示聚焦最小防护闭环，不依赖 AI analyzer 才能完成
- 如果你同时想展示高风险事件和 AI 风险结果，那是额外演示内容，不属于本指南主线

## 3. 环境准备

在仓库根目录执行。

### 第 1 步：启动基础设施

```powershell
docker compose up -d
```

预期现象：
- PostgreSQL 容器启动
- Redis 容器启动

如果失败：
- 先检查 Docker 是否已启动
- 再检查端口是否冲突

### 第 2 步：初始化数据库 schema

```powershell
npm run db:schema --workspace @secuai/api
```

预期现象：
- 终端输出 schema 已成功应用

### 第 3 步：启动 API

```powershell
npm run dev --workspace @secuai/api
```

预期现象：
- 终端出现 API 启动日志
- 能访问 `http://127.0.0.1:3201/health`

建议立即验证：

```powershell
curl http://127.0.0.1:3201/health
```

预期现象：
- 返回 `success: true`

### 第 4 步：启动 Web

```powershell
npm run dev --workspace @secuai/web
```

预期现象：
- Web 成功启动
- 浏览器可访问 `http://127.0.0.1:3200`

### 第 5 步：构建 site-middleware

```powershell
npm run build --workspace @secuai/site-middleware
```

预期现象：
- `packages/site-middleware` build 成功

说明：
- 后续 native demo 和 lifecycle smoke 都会依赖这一步

## 4. 账号、站点和 ingestion key 的准备要求

正式演示前，必须准备好一组真实账号和真实站点数据。

### 账号要求

至少要有一个可以登录后台的账号，用于进入 `/dashboard/policies`。

### 站点要求

至少要有一个已经创建成功的站点，并且你知道：

- 该站点的 `siteId`
- 该站点的 `ingestionKey`
- 该站点的域名

### `ingestionKey` 要求

后续这两个地方都会用到真实 `ingestionKey`：

1. `/dashboard/policies` 内的 `protection simulator`
2. `packages/site-middleware` 的 native node demo

注意：
- `ingestionKey` 必须和当前站点的 `siteId` 对应
- 如果错用别的站点的 key，后端会返回 `INVALID_INGESTION_KEY`

## 5. 正式演示前的准备动作

正式面对观众之前，建议先把演示状态准备好，避免现场临时找数据。

### 建议提前准备的内容

1. 登录后台并进入 `/dashboard/policies`
2. 确认页面能看到目标站点
3. 记下：
   - 当前站点名称
   - 当前站点域名
   - 当前站点 `siteId`
   - 当前站点 `ingestionKey`
4. 确保 blocked entities 列表当前可编辑
5. 确保 terminal 中可以执行：
   - `npm run demo:native-node --workspace @secuai/site-middleware`
   - `npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware`

## 6. 正式演示的完整操作顺序

下面是建议的正式演示主线。  
这一部分按“点哪里、输入什么、预期看到什么、推荐怎么讲”来写。

### 第 1 步：先讲项目边界

推荐讲解话术：

- “SecuAI 当前不是完整流量网关，而是在现有日志接入平台上补最小防护闭环。”
- “这次展示的重点不是重型基础设施，而是策略、封禁、判定和站点侧执行的真实联动。”

预期现象：
- 观众先理解演示边界，不会误以为你在展示完整 WAF 网关

### 第 2 步：打开 `/dashboard/policies`

浏览器访问：

- `http://127.0.0.1:3200/dashboard/policies`

操作：

1. 登录后台
2. 进入 dashboard
3. 打开策略页 `/dashboard/policies`

预期现象：
- 页面正常加载
- 页面上可以看到 3 个核心区域：
  - policy 区块
  - blocked entities 区块
  - protection simulator 区块

推荐讲解话术：

- “这是当前最小防护能力的统一运营入口。”
- “同一页里可以完成站点 policy 管理、封禁对象管理，以及 protection 判断模拟。”

### 第 3 步：选择演示站点

操作：

1. 在页面顶部站点筛选器中选择你的演示站点
2. 等待页面刷新当前站点上下文

预期现象：
- 页面进入该站点的策略视图
- policy、blocked entities、simulator 都绑定到同一个站点

推荐讲解话术：

- “当前所有操作都是站点级的，不是全局策略。”

### 第 4 步：展示当前 `security policy`

操作：

1. 查看 policy 区块
2. 观察当前模式和开关

当前页面实际会展示的内容包括：
- `mode`
- SQL 注入相关开关
- XSS 相关开关
- 可疑 `User-Agent` 相关开关
- rate limit 相关配置
- 高风险自动封禁相关配置

预期现象：
- policy 可以正常读取
- 页面上能看到当前模式是 `monitor` 或 `protect`

推荐讲解话术：

- “这里展示的是当前站点的真实 policy，不是演示假数据。”
- “我们当前只保留最小需要的策略能力，不做过重的规则系统。”

### 第 5 步：把当前模式设为 `monitor`

操作：

1. 在 policy 区块中选择 `monitor`
2. 点击保存策略按钮

预期现象：
- 页面出现保存成功反馈
- 当前模式显示为 `monitor`

推荐讲解话术：

- “`monitor` 的含义是系统识别到风险，但不直接阻断请求。”
- “这个模式更适合先观察和验证规则效果。”

### 第 6 步：新增一个 blocked IP

操作：

1. 在 blocked entities 区块中找到新增表单
2. 在 IP 输入框中输入一个演示 IP，例如：
   - `203.0.113.77`
3. 在原因输入框中输入：
   - `演示用 blocked IP`
4. 如无特殊需要，过期时间留空
5. 点击新增按钮

预期现象：
- 页面出现新增成功反馈
- blocked entities 列表中出现新记录
- 新记录应能看到：
  - `entityType`
  - `entityValue`
  - `reason`
  - `source`
  - `expiresAt`
  - `createdAt`

推荐讲解话术：

- “我们先用 blocked IP 做演示，因为它是最直观、最稳定的显式防护输入。”
- “这样更容易清楚地证明管理动作变化会真实影响 enforcement 结果。”

### 第 7 步：运行 protection simulator，展示 `monitor`

这是演示中最关键的页面步骤之一。

操作：

1. 滚动到 protection simulator 区块
2. 在 `ingestionKey` 输入框中填入当前演示站点的真实 `ingestionKey`
3. 输入以下推荐参数：
   - `path`：`/login`
   - `queryString`：留空
   - `clientIp`：`203.0.113.77`
   - `userAgent`：`Mozilla/5.0`
   - `referer`：可留空
4. 点击执行判定按钮

预期现象：
- 返回一条真实 protection 结果
- 页面应显示：
  - `mode = monitor`
  - `action = monitor`
  - `reasons` 包含 `blocked_ip`

推荐讲解话术：

- “这里不是前端自己拼结果，调用的是真实 `POST /api/v1/protection/check`。”
- “同一个站点、同一个请求特征、同一个 blocked IP，在 `monitor` 下只会标记和放行。”

### 第 8 步：把当前模式切换到 `protect`

操作：

1. 回到 policy 区块
2. 把当前模式从 `monitor` 改为 `protect`
3. 再次点击保存策略按钮

预期现象：
- 页面出现保存成功反馈
- 当前模式显示为 `protect`

推荐讲解话术：

- “现在我不改 blocked IP，不改请求输入，只改 policy mode。”
- “这是为了证明最终动作的变化，来自策略变化，而不是输入变化。”

### 第 9 步：再次运行 protection simulator，展示 `block`

操作：

1. 回到 protection simulator 区块
2. 保持与上一步完全相同的输入：
   - 同一个 `ingestionKey`
   - 同一个 `path`
   - 同一个 `clientIp`
   - 同一个 `userAgent`
3. 再次点击执行判定按钮

预期现象：
- 页面应显示：
  - `mode = protect`
  - `action = block`
  - `reasons` 仍包含 `blocked_ip`

推荐讲解话术：

- “这一步说明相同请求在不同 policy mode 下会得到不同 enforcement 动作。”
- “这条链路已经具备真实、可解释的最小策略执行价值。”

## 7. Protection Simulator 专项演示步骤

如果你想单独演示 simulator，可以按下面方式执行。

### 演示输入模板

- `ingestionKey`：当前站点真实 `ingestionKey`
- `path`：`/login`
- `queryString`：留空
- `clientIp`：`203.0.113.77`
- `userAgent`：`Mozilla/5.0`
- `referer`：留空

### 观察点

重点看 3 个字段：
- `mode`
- `action`
- `reasons`

### 推荐演示方式

1. 先在 `monitor` 下跑一次
2. 再切到 `protect` 跑同样输入
3. 对比 `action` 是否从 `monitor` 变成 `block`

### 推荐讲解话术

- “simulator 不是页面上的伪结果，而是平台真实判定接口的可视化入口。”
- “它的作用是让策略效果在后台管理页里可以直接被演示和验证。”

## 8. Site Middleware Demo 演示步骤

这一段用于说明站点侧如何最小接入平台，而不是让观众误以为平台已经变成完整网关。

### 第 1 步：准备 `.env`

先复制环境变量示例文件：

```powershell
Copy-Item packages/site-middleware/.env.example packages/site-middleware/.env
```

然后填写真实值：

```text
SECUAI_PLATFORM_URL=http://127.0.0.1:3201
SECUAI_SITE_ID=你的真实 siteId
SECUAI_SITE_INGESTION_KEY=你的真实 ingestionKey
SECUAI_SITE_PORT=8080
SECUAI_REPORT_REQUEST_LOGS=true
SECUAI_REPORT_REQUEST_LOG_SCOPE=monitor
```

### 第 2 步：启动 native node demo

```powershell
npm run demo:native-node --workspace @secuai/site-middleware
```

预期现象：
- 终端打印当前配置
- 终端提示演示地址
- 终端提示示例 `curl` 命令

### 第 3 步：演示 `allow`

操作：

```powershell
curl http://127.0.0.1:8080/
```

预期现象：
- 返回 `200`
- 响应 JSON 中能看到：
  - `request`
  - `protection.action`
  - `protection.mode`
  - `protection.reasons`

### 第 4 步：演示 `monitor`

前提：
- 页面中的 policy 已是 `monitor`
- blocked entities 中已存在 `203.0.113.77`

操作：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：
- 返回 `200`
- JSON 中：
  - `protection.action = monitor`
  - `protection.mode = monitor`
  - `reasons` 包含 `blocked_ip`

### 第 5 步：演示 `block`

前提：
- 页面中的 policy 已切到 `protect`
- 仍使用同一个 blocked IP

操作：

```powershell
curl "http://127.0.0.1:8080/login?id=1" -H "x-forwarded-for: 203.0.113.77"
```

预期现象：
- 返回 `403`
- JSON 中：
  - `success = false`
  - `error.code = REQUEST_BLOCKED`
  - `error.details.mode = protect`
  - `error.details.reasons` 包含 `blocked_ip`

### 推荐讲解话术

- “站点侧 middleware 不自己维护规则，它调用的是平台真实 `POST /api/v1/protection/check`。”
- “所以页面上的 simulator 和站点侧 demo，本质上验证的是同一套判定逻辑。”

## 9. Blocked Entity 生命周期 Smoke 演示步骤

这一段用于说明：不是只有页面能操作，而是管理动作变化真的会驱动 enforcement 变化。

### 第 1 步：执行命令

```powershell
npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware
```

### 第 2 步：观察输出

预期输出应包含：

- `initial allow verified`
- `monitor after blocked entity verified`
- `block in protect mode verified`
- `allow after blocked entity removal verified`

### 第 3 步：解释每一行的含义

- `initial allow verified`
  - 初始没有 blocked IP，同一请求是 `allow`
- `monitor after blocked entity verified`
  - 新增 blocked IP 后，在 `monitor` 下结果变成 `monitor`
- `block in protect mode verified`
  - 切到 `protect` 后，同一请求变成 `block`
- `allow after blocked entity removal verified`
  - 删除 blocked IP 后，同一请求恢复为 `allow`

### 第 4 步：强调一致性

推荐讲解话术：

- “这条 smoke 不只验证页面操作成功，更验证 API 与 middleware 的结果在整个生命周期里是一致的。”
- “这说明管理动作变化会真实影响 enforcement，而不是页面层面的演示效果。”

## 10. 每一步的预期现象汇总

| 步骤 | 预期现象 |
| --- | --- |
| 打开 `/dashboard/policies` | 页面正常加载 |
| 选择站点 | policy、blocked entities、simulator 全部绑定到同一站点 |
| 保存 `monitor` | 页面出现成功反馈，模式显示为 `monitor` |
| 新增 blocked IP | 列表出现新记录 |
| simulator in `monitor` | `action = monitor`，`reasons` 包含 `blocked_ip` |
| 保存 `protect` | 页面出现成功反馈，模式显示为 `protect` |
| simulator in `protect` | `action = block`，`reasons` 仍包含 `blocked_ip` |
| native demo 普通请求 | 返回 `200` |
| native demo 被阻断请求 | 返回 `403 + REQUEST_BLOCKED` |
| lifecycle smoke | 输出 `allow -> monitor -> block -> allow` |

## 11. 演示时推荐讲解话术

下面是一套可直接照着讲的表达。

### 开场

- “SecuAI 当前不是完整流量网关，而是在现有日志接入平台上补最小防护闭环。”
- “这次演示重点是站点级 policy、blocked entities、真实 protection 判断，以及站点侧 middleware 执行。”

### 展示 `/dashboard/policies`

- “这是当前最小防护能力的统一运营入口。”
- “同一页里可以完成 policy 管理、封禁管理和 protection 判断模拟。”

### 展示 `monitor`

- “我先把模式设置成 `monitor`。”
- “在这个模式下，系统识别到风险，但不直接阻断请求。”

### 展示 blocked IP

- “这里新增一个 blocked IP，用最稳定、最容易解释的方式来展示策略生效。”

### 展示 simulator

- “这里调用的不是假接口，而是后端真实 `POST /api/v1/protection/check`。”
- “同一个输入在 `monitor` 下得到 `monitor`，切到 `protect` 后得到 `block`。”

### 展示 middleware

- “站点侧 demo 也调用同一个真实判定入口。”
- “所以页面和站点端验证的是同一套规则，不是两套逻辑。”

### 展示 lifecycle smoke

- “最后这条 smoke 用来证明管理动作变化会真实影响 enforcement 结果。”
- “也就是说，我们现在不只是能演示，还能稳定回归验证。”

## 12. 常见失败点与排查方式

### 1. API 不可用

现象：
- `/dashboard/policies` 加载失败
- simulator 无法提交
- middleware demo 无法返回正常结果

检查：

```powershell
curl http://127.0.0.1:3201/health
```

处理：
- 启动 API
- 检查 PostgreSQL 是否已启动
- 重新执行：

```powershell
npm run db:schema --workspace @secuai/api
```

### 2. Web 不可用

现象：
- 浏览器无法打开 `/dashboard/policies`

处理：
- 检查是否已执行：

```powershell
npm run dev --workspace @secuai/web
```

- 检查 `3200` 端口是否被占用

### 3. `INVALID_INGESTION_KEY`

现象：
- simulator 提交失败
- middleware demo 无法得到有效结果

处理：
- 确认输入的是当前站点的真实 `ingestionKey`
- 确认 `ingestionKey` 与当前 `siteId` 是一一对应的

### 4. `INGESTION_KEY_REQUIRED`

现象：
- simulator 或直接接口调用在判定前就失败

处理：
- 确保已提供 `x-site-ingestion-key`

### 5. `SITE_NOT_FOUND`

现象：
- simulator 或 middleware demo 无法得到合法判定

处理：
- 确认站点存在
- 确认站点状态为 active

### 6. 页面里看起来已经改了 policy，但结果没变化

现象：
- `/dashboard/policies` 已显示新 policy
- 但 simulator 或 middleware 返回不符合预期

处理：
- 确认当前使用的是同一个站点
- 确认 blocked IP 与 `clientIp` 或 `x-forwarded-for` 一致
- 确认 policy 已保存成功

### 7. lifecycle smoke 失败

现象：
- lifecycle smoke 某一步没有通过

处理：

```powershell
npm run db:schema --workspace @secuai/api
npm run build --workspace @secuai/api
npm run build --workspace @secuai/site-middleware
npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware
```

## 13. 3 分钟精简版演示顺序

如果时间只有 3 分钟，建议按下面顺序：

1. 打开 `/dashboard/policies`
2. 选择站点
3. 展示当前 `policy`
4. 新增一个 blocked IP
5. 在 `monitor` 下运行 simulator，展示 `action = monitor`
6. 切到 `protect`
7. 再运行 simulator，展示 `action = block`
8. 最后运行：

```powershell
npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware
```

结尾一句话：

- “这说明同一套策略和 blocked entity 管理动作，会真实驱动 enforcement 变化，而且站点侧 middleware 与平台判断一致。”

## 14. 8 到 10 分钟完整版演示顺序

如果你有更完整的时间，建议按下面节奏：

### 第 1 分钟

- 讲项目定位
- 讲当前边界

### 第 2 分钟

- 讲最小闭环结构：
  - `security_policies`
  - `blocked_entities`
  - `POST /api/v1/protection/check`
  - `site-middleware`

### 第 3 到 4 分钟

- 打开 `/dashboard/policies`
- 选择站点
- 展示 policy
- 切到 `monitor`

### 第 4 到 5 分钟

- 新增 blocked IP
- 运行 simulator
- 展示 `action = monitor`

### 第 5 到 6 分钟

- 切到 `protect`
- 再跑 simulator
- 展示 `action = block`

### 第 6 到 7 分钟

- 运行 native node demo
- 展示 `allow`
- 展示 `monitor`
- 展示 `403 + REQUEST_BLOCKED`

### 第 7 到 8 分钟

- 运行 lifecycle smoke
- 解释 `allow -> monitor -> block -> allow`

### 第 8 到 10 分钟

- 总结当前价值
- 说明当前边界与风险
- 说明下一步方向

## 15. 推荐收尾总结

演示最后建议用这段话收尾：

- “SecuAI 当前已经不只是日志分析平台。”
- “它已经具备站点级 policy 管理、blocked entities 管理、真实 protection 判定、site-side middleware 执行，以及生命周期回归验证能力。”
- “虽然当前还不是完整流量网关，但最小防护闭环已经真实可演示、可验证、可回归。”
