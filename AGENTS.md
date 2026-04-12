# AGENTS.md

## 项目
构建一个 AI 驱动的小微企业网站安全防护平台。

## 当前阶段
项目当前处于：

**日志接入型安全分析平台**
向
**带最小阻断能力的平台**
过渡阶段。

当前不是完整的 reverse proxy，也不是 full traffic gateway。

## MVP 范围
当前优先保证以下能力：

1. 用户注册与登录
2. Tenant / Site 管理
3. Request log ingestion
4. Basic attack event detection
5. AI risk scoring
6. Admin dashboard
7. Security policy 管理
8. Blocked entities 管理
9. Protection simulator
10. Site-side middleware 最小 enforcement 闭环
11. 最小接入样板与演示链路

## 技术栈
- Frontend: Next.js + TypeScript
- Backend: Node.js + TypeScript
- AI service: Python + FastAPI
- Database: PostgreSQL
- Cache: Redis
- DevOps: Docker Compose

## 目录
- `apps/web`: 管理后台
- `apps/api`: 主后端
- `services/ai-analyzer`: AI 分析服务
- `packages/shared`: 共享类型与工具
- `packages/site-middleware`: 站点侧接入中间件

## 核心方向
1. 保持主链路稳定：
   - `request_logs`
   - `detection`
   - `attack_events`
   - `ai_risk_results`
2. 当前重点：
   - policy
   - blocked entities
   - protection/check
   - site-middleware
   - 最小 enforcement 验证
3. 当前不做：
   - reverse proxy
   - full traffic gateway
   - 重型分布式限流
   - 多节点高并发一致性优化
4. 优先做：
   - 可演示
   - 可接入
   - 可验证
   - 可解释

## 工作规则
1. 每次开始前先阅读本文件。
2. 优先遵守 MVP 范围，不随意扩功能。
3. 非必要不要修改 API 契约。
4. 优先做小步、可验证迭代。
5. 能复用已有 helper、组件、脚本就不要重造。
6. 不要虚构不存在的后端字段。
7. 开发环境探针或 smoke 入口默认安全关闭，生产默认不可用，除非显式环境变量开启。

## 仓库治理规则
1. 新增文件前，先检查同目录和相邻目录是否已有职责相同或命名相近的文件；能复用就不要新建平行文件。
2. 如果确实需要新增同类文件，必须在输出中说明：为什么不能复用旧文件、两者职责边界是什么、后续由哪一份作为主入口。
3. 临时文件、实验文件、迁移中间文件、运行日志文件不得留在仓库根目录或功能目录中；任务结束前必须删除或收口到明确的忽略路径。
4. 不允许留下 `tmp_*`、`output_*`、`copy_*`、`backup_*` 这类无正式职责命名的文件作为长期残留。

## Skills 规则
1. 对于重复性、流程化、可复用的工作，Codex 优先使用已有 skills。
2. 若任务与某个 skill 的 description 匹配，Codex 应主动调用该 skill。
3. 如果多个任务共享同一流程，优先抽公共 skill 或复用已有 skill。
4. 如果本应使用 skill 但未使用，应说明原因。

## 前端分工规则
1. 前端**设计**任务优先由 Antigravity 完成。
2. 前端设计包括：
   - 页面信息层级
   - 页面结构与布局
   - 视觉风格收口
   - 交互流程设计
   - 演示展示方式设计
3. Codex 负责前端**实现与验证**，包括：
   - 页面编码
   - 状态处理
   - 表单逻辑
   - aria 语义
   - smoke / test / build 修复
   - 脚本兼容性修复
4. 如果任务同时包含设计和实现，应先由 Antigravity 完成设计，再由 Codex 实现。

## Bug 修复规则
1. 修 bug 优先做**根因修复**，不要只做表面补丁覆盖。
2. 不要用硬编码兜底、无条件吞错、跳过真实分支、只改测试不改实现来伪装修复完成。
3. 如果必须临时兼容，必须说明：
   - 根因
   - 为什么只能先临时处理
   - 剩余风险
4. 如果同一问题影响多个模块，优先抽公共修复点，不要到处打补丁。

## 文档与注释规则
1. 所有新写或修改的 Markdown 内容默认使用中文。
2. 所有新写或修改的代码注释默认使用中文。
3. 外部标准术语可保留英文，但整句说明优先中文。
4. 以下技术契约值保持原样：
   - API 路径
   - 错误码
   - 表名
   - 字段名
   - 类型名
   - 请求头名
   - 脚本名
   - 机器可读返回值

## 验证规则
1. 每次有实际改动都应尽量附带验证。
2. 优先使用：
   - `typecheck`
   - `build`
   - `test`
   - 定向 smoke
3. 不要只用“代码看起来没问题”作为完成依据。
4. 除非任务仅涉及纯文档，否则不要在没有至少一种可执行验证的情况下声称完成。
5. 如果当前环境无法完成运行验证，必须说明：
   - 本应验证哪一步
   - 为什么当前不能验证
   - 剩余风险是什么

## 运行验证优先级
1. 前端改动：优先验证页面能打开、交互能执行、关键状态可见。
2. 后端改动：优先验证服务能启动、接口能请求、关键返回符合预期。
3. 脚本或 smoke 改动：优先验证脚本本身能执行。
4. middleware 或接入样板改动：优先验证最小真实接入链路。

## PROJECT_STATE.md 规则
1. 修改 `PROJECT_STATE.md` 时必须保持精简。
2. 不写成长流水账。
3. 只保留高价值当前状态：
   - 当前阶段
   - 已确认方向
   - 当前能力
   - 最新验证
   - 当前风险
   - 下一步建议
4. 如果本轮没有新增高价值阶段状态，不要修改 `PROJECT_STATE.md`。
5. `PROJECT_STATE.md` 使用中文。

## 演示与交付规则
1. 若任务进入演示、答辩、比赛、交付阶段，优先整理：
   - 演示顺序
   - 讲解口径
   - 前置条件
   - 启动步骤
   - 预期现象
   - 常见失败点与排查
2. 演示阶段优先做材料与彩排，不要无节制扩功能。

## 输出要求
任务完成后尽量输出：
1. 设计思路
2. 修改文件清单
3. 做了什么
4. 验证命令
5. 验证结果
6. 是否需要修改 AGENTS.md
7. 是否需要修改 PROJECT_STATE.md
