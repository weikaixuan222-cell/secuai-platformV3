# SecuAI 演示与答辩材料骨架

本文件用于正式展示时的讲解提纲、PPT 目录建议、截图准备清单和时间版讲稿骨架。

适用场景：
- 比赛答辩
- 项目汇报
- 路演演示

当前材料只围绕已经完成并验证通过的最小闭环：
- `policy`
- `blocked entities`
- `protection simulator`
- `site-middleware`
- `blocked entity lifecycle smoke`

不覆盖以下范围：
- reverse proxy
- full traffic gateway
- 重型基础设施改造

## 1. 建议的答辩 / PPT 目录结构

建议控制在 8 到 10 页，避免过多背景页稀释主线。

### 第 1 页：项目定位

建议标题：

- `SecuAI：面向中小网站的 AI 安全分析与最小防护平台`

建议展示内容：

- 项目一句话介绍
- 当前阶段定位
- 本轮演示边界

这一页要讲的重点：

- 当前不是完整流量网关
- 当前目标是把“可分析”推进到“可做最小防护决策与执行”

### 第 2 页：当前问题与目标

建议展示内容：

- 小微企业网站普遍缺少低成本安全能力
- 纯日志平台价值不够直观
- 需要最小可验证的防护闭环

这一页要讲的重点：

- 为什么要从日志分析平台继续往最小 enforcement 能力推进
- 为什么当前选择小步、可验证、可演示，而不是重做网关

### 第 3 页：当前最小闭环结构

建议展示内容：

- 一张简单流程图：
  - `/dashboard/policies`
  - `security_policies`
  - `blocked_entities`
  - `POST /api/v1/protection/check`
  - `site-middleware`

这一页要讲的重点：

- 平台负责策略与判断
- 站点侧 middleware 负责执行结果
- 页面、接口、middleware 是同一条链路，不是三套逻辑

### 第 4 页：Policy 管理页

建议展示内容：

- `/dashboard/policies` 的完整截图
- 标出 3 个区域：
  - policy 表单
  - blocked entities
  - protection simulator

这一页要讲的重点：

- 一个页面承载最小管理闭环
- `mode` 只分 `monitor / protect`
- 便于运营、演示和回归

### 第 5 页：Blocked Entities 管理

建议展示内容：

- blocked entities 列表截图
- 新增表单截图
- 一条 blocked IP 的示例

这一页要讲的重点：

- blocked entity 是最直观、最稳定的显式防护输入
- 支持列表、新增、删除
- 是驱动 enforcement 变化的核心演示点

### 第 6 页：Protection Simulator

建议展示内容：

- simulator 表单截图
- `monitor` 结果截图
- `protect` 结果截图

这一页要讲的重点：

- simulator 调用的是真实 `POST /api/v1/protection/check`
- 相同输入在 `monitor` 和 `protect` 下会得到不同动作
- 结果是可解释的，包含 `mode / action / reasons`

### 第 7 页：Site Middleware 接入样板

建议展示内容：

- `native-node-server.ts` 或其 README 的关键片段截图
- 启动后的终端输出截图
- `200` 和 `403 + REQUEST_BLOCKED` 响应示例

这一页要讲的重点：

- 站点侧如何以最小成本接入平台
- middleware 不自己做规则判断
- 它只是调用平台 `POST /api/v1/protection/check` 并执行结果

### 第 8 页：生命周期 Smoke 与验证能力

建议展示内容：

- `smoke:blocked-entity-lifecycle` 输出截图
- 4 步变化：
  - `allow`
  - `monitor`
  - `block`
  - `allow`

这一页要讲的重点：

- 管理动作变化会真实驱动 enforcement 变化
- API 与 middleware 结果一致
- 不只是“页面能操作”，而是“链路已可验证”

### 第 9 页：当前边界与风险

建议展示内容：

- 当前不做的能力
- 当前保留风险

这一页要讲的重点：

- 没有把问题说大
- 当前仍不是完整网关
- 尚未覆盖高并发、真实 rate limit 压测、多节点一致性

### 第 10 页：下一步

建议展示内容：

- 下一步 1 到 2 个最合理方向

建议讲法：

- 继续补小步、可验证的 enforcement 验证
- 继续把接入样板和回归链路做稳

## 2. 建议提前准备的截图清单

建议至少准备以下截图，避免现场切换过多页面导致节奏混乱。

### 页面截图

1. `/dashboard/policies` 全页截图
2. policy 区块截图
3. blocked entities 列表截图
4. blocked entity 新增成功后的截图
5. simulator 在 `monitor` 下返回结果截图
6. simulator 在 `protect` 下返回结果截图
7. simulator 错误输入 `ingestionKey` 时的失败截图

### 终端截图

8. `site-middleware` native demo 启动输出截图
9. native demo 普通请求 `200` 返回截图
10. native demo 被阻断时 `403 + REQUEST_BLOCKED` 截图
11. `smoke:e2e-enforcement` 通过截图
12. `smoke:blocked-entity-lifecycle` 通过截图

### 文档或结构截图

13. 最小闭环结构图或流程图
14. `DEMO_GUIDE.md` 中的演示顺序摘录

## 3. 每页建议展示的内容与讲法

### 开场页

建议只回答两个问题：

- 这个项目做什么
- 这次展示的范围是什么

不要一开始就堆技术细节。

### 问题页

建议突出：

- 中小网站通常没有专业安全团队
- 纯日志分析价值不够直观
- 我们要把“看到风险”推进到“能执行最小策略动作”

### 闭环结构页

建议让听众看懂 3 件事：

- 平台哪里做策略管理
- 平台哪里做判断
- 站点哪里执行结果

### 页面演示页

建议遵循这个固定顺序：

1. 看 policy
2. 看 blocked entities
3. 看 simulator

避免页面上来回跳。

### middleware 页

建议突出：

- 站点侧接入不复杂
- 不需要把网站改造成网关
- 可以用最小 Node.js 接入样板完成联调和演示

### 验证页

建议强调：

- 我们不仅能演示页面
- 还补了可重复执行的 smoke
- 管理动作变化能真实影响 enforcement 结果

## 4. 3 分钟精简版讲稿骨架

### 第 0 分钟到第 0.5 分钟：讲定位

建议讲法：

- SecuAI 当前不是完整流量网关，而是在现有日志安全平台上补最小防护闭环
- 这次重点展示站点级 policy、blocked entities、simulator 和 middleware 的联动

### 第 0.5 分钟到第 1.5 分钟：讲页面闭环

建议讲法：

- 这是 `/dashboard/policies`
- 在这里可以管理站点 policy 和 blocked entities
- 我先把 policy 设成 `monitor`，再加一个 blocked IP
- 用 simulator 调用真实 `POST /api/v1/protection/check`
- 此时结果是 `action = monitor`

### 第 1.5 分钟到第 2.2 分钟：讲 mode 切换

建议讲法：

- 现在我不改请求输入，只把 mode 从 `monitor` 切到 `protect`
- 再跑同样的 simulator
- 结果从 `monitor` 变成 `block`

### 第 2.2 分钟到第 3 分钟：讲 middleware 与验证

建议讲法：

- 同一套判断也能被 site-middleware 执行
- 我们还补了一条生命周期 smoke，验证 `allow -> monitor -> block -> allow`
- 这说明管理动作变化会真实影响 enforcement，而不是页面层假效果

## 5. 8 分钟完整版讲稿骨架

### 第 1 分钟：项目定位

讲清：

- 项目目标
- 当前阶段
- 为什么不直接做 full traffic gateway

### 第 2 分钟：最小闭环结构

讲清：

- `security_policies`
- `blocked_entities`
- `POST /api/v1/protection/check`
- `site-middleware`

强调：

- 这是一个最小但完整的策略管理与执行链路

### 第 3 到 4 分钟：展示 `/dashboard/policies`

讲清：

- 这是当前最小防护能力的运营入口
- 页面能读取和更新 policy
- 页面能新增和删除 blocked entities

### 第 4 到 5 分钟：展示 simulator

演示步骤：

1. 在 `monitor` 下输入真实 `ingestionKey` 和 blocked IP
2. 展示 `action = monitor`
3. 切到 `protect`
4. 再展示 `action = block`

强调：

- simulator 调用的是后端真实契约
- 输出是可解释的

### 第 5 到 6 分钟：展示 middleware 接入样板

讲清：

- `native-node-server.ts` 是站点侧最小接入样板
- 它从 `.env` 读取配置
- 对请求返回 `allow / monitor / block` 的可见结果
- 被阻断时真实返回 `403 + REQUEST_BLOCKED`

### 第 6 到 7 分钟：展示生命周期 smoke

讲清：

- 我们补的不是单点 smoke，而是生命周期 smoke
- 它验证 blocked entity 的新增、mode 的切换、blocked entity 的删除，都会真实影响 enforcement

可直接展示的关键输出：

- `initial allow verified`
- `monitor after blocked entity verified`
- `block in protect mode verified`
- `allow after blocked entity removal verified`

### 第 7 到 8 分钟：讲边界、风险与下一步

建议讲法：

- 当前没有进入 reverse proxy / full traffic gateway
- 当前仍未覆盖高并发、真实 rate limit 压测、多节点一致性
- 下一步继续补小步、可验证、可演示的 enforcement 能力

## 6. 答辩时最值得强调的 5 句话

1. “我们当前不是完整流量网关，而是在现有日志平台上补最小防护闭环。”
2. “平台端和站点端不是两套逻辑，二者共享同一个 `POST /api/v1/protection/check` 判定入口。”
3. “在 `monitor` 和 `protect` 下，相同输入会产生不同 enforcement 动作。”
4. “blocked entity 的管理动作会真实影响 middleware enforcement 结果。”
5. “我们不只做了页面，还补了生命周期 smoke，保证这条闭环可回归、可验证、可演示。”

## 7. 现场答疑准备点

如果被问到“为什么不直接做网关”，建议回答：

- 当前阶段优先验证 MVP 价值
- 最小策略能力和 site-side middleware 更适合快速接入与本地验证
- 这样能先把策略、判定、执行和验证链路做稳

如果被问到“现在到底能防什么”，建议回答：

- 当前能演示并验证的是站点级最小防护能力
- 包括 policy、blocked entities、`allow / monitor / block` 判定和 site-side 执行
- 这不是最终形态，但已经具备真实、可验证的最小防护闭环

如果被问到“怎么证明不是假效果”，建议回答：

- 前端 simulator 调用的是真实后端接口
- site-middleware 也是调用同一个真实判定入口
- 生命周期 smoke 证明管理动作变化会真实驱动 enforcement 变化
