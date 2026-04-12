# SecuAI 演示指南

本指南面向“真实接入与演示交付主线”。目标不是继续扩功能，而是让拿到仓库的人可以按统一路径完成一次真实、可解释、可排错的最小演示。

## 推荐统一启动路径

默认推荐在仓库根目录执行：

```powershell
npm run dev:demo-stack
```

这条路径会统一完成：

- `docker compose up -d postgres redis`
- `npm run db:schema --workspace @secuai/api`
- `npm run dev --workspace @secuai/api`
- `npm run dev --workspace @secuai/web`

推荐把它作为：

- 演示前默认启动入口
- 联调时默认启动入口
- 排查前的第一条标准路径

## 演示前最小检查

统一启动完成后，默认先执行：

```powershell
npm run smoke:demo-stack-ready
```

这条自检入口会统一完成：

- API `/health`
- Web `/login`
- `smoke:acceptance`
- `smoke:stage2-minimal-defense`
- `smoke:dashboard-events`
- `smoke:dashboard-policies`

如果只想看最小 ready 信号，再确认：

```powershell
curl http://127.0.0.1:3201/health
```

然后在浏览器打开：

- `http://127.0.0.1:3200/dashboard/policies`
- `http://127.0.0.1:3200/dashboard/events`

## 推荐演示顺序

### 1. 先讲清项目边界

推荐口径：

- 当前项目已经具备最小阻断能力，但不是完整网关产品
- 当前重点是“可管理、可判定、可执行、可验证、可演示”

### 2. 打开 `/dashboard/policies`

重点说明：

- 这里是当前最小阻断能力的统一运营入口
- 可以管理 `security_policies`
- 可以管理 `blocked_entities`
- 可以通过 `protection simulator` 直接调用真实 `POST /api/v1/protection/check`

### 3. 展示 `monitor -> protect`

推荐顺序：

1. 选择演示站点
2. 查看当前策略
3. 在 `monitor` 下运行 simulator
4. 切到 `protect`
5. 对同一输入再次运行 simulator

预期现象：

- `monitor` 下相同请求是 `monitor`
- `protect` 下相同请求变成 `block`

### 4. 展示事件与处置回看

打开 `/dashboard/events` 的事件详情页，重点说明：

- 当前处置对象
- 当前防护轨迹
- 关联事件归属
- 查看当前站点封禁名单

再跳到 `/dashboard/policies`，重点说明：

- `originKind`
- `isActive`
- `attackEventId`

### 5. 展示站点侧最小 enforcement

执行：

```powershell
npm run smoke:stage2-minimal-defense --workspace @secuai/api
```

重点说明：

- `allow / monitor / protect` 一致性
- `blocked_ip` 生命周期
- `blocked_rate_limit` 生命周期
- `blockSqlInjection`
- `blockXss`

## 常见失败点与排查

### 1. API 起不来

默认先执行：

```powershell
npm run doctor:demo-stack
```

如果 doctor 已明确提示 API 未就绪，再看：

```powershell
curl http://127.0.0.1:3201/health
```

如果失败，优先重跑：

```powershell
npm run db:schema --workspace @secuai/api
```

如果还是失败，再回到统一入口：

```powershell
npm run dev:demo-stack
```

### 2. Web 能打开但数据报错

先执行：

```powershell
npm run doctor:demo-stack
```

如果 `API /health` 已通过，但 Web 页面数据报错，再确认 `npm run dev:demo-stack` 的 API 和 Web 都没有提前退出，以及 Web 启动时的 `API_URL` 是否还是 `http://127.0.0.1:3201`。

### 3. 本机 `5432` 被占用

统一入口默认使用 `POSTGRES_PORT=55432`，这是正常行为，不需要手工改 compose 文件。

### 4. AI analyzer 没启动

这不会阻塞最小阻断链路演示。当前阶段只要：

- `smoke:demo-stack-ready`

都通过，就足以完成第二阶段封版后的主线演示。

## 推荐彩排命令

```powershell
npm run smoke:demo-stack-ready
```

如果你不是要单独彩排某一项，而是要直接按仓库标准顺序完成一次完整演示，推荐执行：

```powershell
npm run demo:standard
```

如果这条命令失败，再只重跑其中失败的那一个子 smoke，不要直接把所有命令重新手工跑一遍。

如果你不确定失败点在哪，先跑：

```powershell
npm run doctor:demo-stack
```

这条排查入口只负责先确认：

- postgres / redis 是否可用
- API `/health` 是否可用
- Web `/login` 是否可用

如果这些都正常，再只重跑真正失败的那一个子 smoke。

## 收尾口径

推荐最后用一句话收束：

> 当前项目已经不是单纯日志分析平台，而是具备最小阻断能力、真实事件回看、站点侧 enforcement 和统一管理入口的可演示平台；下一阶段重点应放在真实接入、统一启动、彩排和交付，而不是继续在第二阶段内部打补丁。
