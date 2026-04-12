# SecuAI 真实接入与交付材料骨架

本文件不再服务第二阶段内部能力答辩，而是服务当前阶段：

**真实接入与演示交付主线**

目标很单一：
- 让新接手的人知道先跑什么
- 让现场主讲知道先讲什么
- 让联调同学知道失败后回到哪一条路径

它不是大而全手册，也不是新的业务设计文档。

## 1. 适用场景

- 第一次把仓库交给新同学
- 现场演示前统一彩排
- 对外汇报前整理讲解顺序
- 真实站点联调前同步口径

## 2. 当前统一主入口

默认只围绕这四条入口组织材料，不再手工拼命令：

```powershell
npm run dev:demo-stack
npm run smoke:demo-stack-ready
npm run doctor:demo-stack
npm run demo:standard
```

职责边界：

- `dev:demo-stack`
  - 统一启动最小演示栈
- `smoke:demo-stack-ready`
  - 统一确认整套演示栈 ready
- `doctor:demo-stack`
  - 启动失败或 ready-check 失败后的统一排查入口
- `demo:standard`
  - 标准演示流程入口

## 3. 一页式交付口径

如果只能讲一分钟，只讲这四句话：

1. 当前项目已经完成第二阶段最小阻断闭环，不再继续补第二阶段内部能力。
2. 当前阶段重点是让项目更容易启动、联调、演示和排错。
3. 默认不手工拼命令，统一使用四条入口：启动、自检、排查、标准演示。
4. 如果要做真实站点接入，优先复用 `packages/site-middleware/examples/native-node-server.ts` 这套最小样板。

## 4. 新接手者的最小执行顺序

### 第一步：启动

```powershell
npm run dev:demo-stack
```

确认：
- API `/health` 可用
- Web `/login` 可用

### 第二步：自检

```powershell
npm run smoke:demo-stack-ready
```

确认：
- `smoke:acceptance` 通过
- `smoke:stage2-minimal-defense` 通过
- `smoke:dashboard-events` 通过
- `smoke:dashboard-policies` 通过

### 第三步：标准演示

```powershell
npm run demo:standard
```

确认：
- 已输出固定演示顺序
- 已给出演示后回收方式
- 已给出失败时回退到 `doctor:demo-stack` 的路径

### 第四步：失败再排查

```powershell
npm run doctor:demo-stack
```

要求：
- 不确定失败点时，先跑 doctor
- 不要上来把所有 smoke 手工重新跑一遍

## 5. 标准演示讲解顺序

默认按 `demo:standard` 的顺序讲，不自己重排：

### 1. 先打开策略页

地址：

- `http://127.0.0.1:3200/dashboard/policies`

重点只讲三件事：
- 当前站点安全总览
- `monitor -> protect`
- `protection simulator`

### 2. 再讲事件与处置回看

地址：

- `http://127.0.0.1:3200/dashboard/events`

重点只讲三件事：
- 当前处置对象
- 当前防护轨迹
- 关联事件归属与回看关系

### 3. 最后讲站点侧最小 enforcement

命令：

```powershell
npm run smoke:stage2-minimal-defense --workspace @secuai/api
```

重点只讲四类闭环：
- `blocked_ip`
- `blocked_rate_limit`
- `blockSqlInjection`
- `blockXss`

## 6. 真实站点接入样板的最小交付口径

如果这次不是只做仓库演示，而是要把一个真实站点接进来，默认交给接入方的最小材料只有三项：

1. [packages/site-middleware/examples/native-node-server.ts](E:/cursor/SecuAI智能防御系统V2.0/packages/site-middleware/examples/native-node-server.ts)
2. [packages/site-middleware/examples/README.md](E:/cursor/SecuAI智能防御系统V2.0/packages/site-middleware/examples/README.md)
3. 当前这份材料骨架

交付时只要求对方先准备：
- `siteId`
- `site ingestion key`
- 目标站点域名
- 可用于演示的测试 IP / 测试请求

不要一开始就把整套仓库内部实现细节都交给接入方。

## 7. 现场角色分工

如果现场至少有两个人，建议固定成这两个角色：

### 主讲

负责：
- 讲边界
- 讲固定顺序
- 解释当前结果为什么成立

不负责：
- 现场排查底层错误
- 临时改命令

### 操作

负责：
- 执行 `dev:demo-stack`
- 执行 `smoke:demo-stack-ready`
- 执行 `demo:standard`
- 如失败时执行 `doctor:demo-stack`

不负责：
- 临时改讲稿结构
- 在现场即兴发明新演示路线

## 8. 演示前准备清单

- [ ] `npm run dev:demo-stack` 已成功启动
- [ ] `npm run smoke:demo-stack-ready` 已成功通过
- [ ] `/dashboard/policies` 可打开
- [ ] `/dashboard/events` 可打开
- [ ] `npm run demo:standard` 已至少彩排过一次
- [ ] 已确认谁负责主讲、谁负责操作
- [ ] 已准备好需要展示的站点、事件和 blocked entity

## 9. 演示后回收动作

演示结束后默认只做一件事：

- 回到 `dev:demo-stack` 所在终端按 `Ctrl+C`

如果需要强制回收，再按当前终端里输出的根进程 PID 做进程树回收。

## 10. 失败后的最短回退路径

只保留这一条：

```powershell
npm run doctor:demo-stack
```

口径要求：
- 先 doctor
- 再只重跑失败项
- 不盲目整套重启

## 11. 不再继续做什么

当前这份骨架明确不再覆盖：
- 第二阶段内部能力扩展
- reverse proxy
- full traffic gateway
- 在线 WAF
- 大而全答辩稿
- 大而全 troubleshooting 手册

## 12. 一句话收尾

> 当前项目已经从“完成第二阶段能力”转到“如何把现有能力稳定交给别人启动、联调、演示和接入”，所以交付材料必须围绕统一入口、固定顺序和最短排查路径，而不是继续堆内部细节。
