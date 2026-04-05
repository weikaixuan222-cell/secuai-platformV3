# SecuAI Web 控制台

`apps/web` 是 SecuAI 的 Next.js 管理控制台。
当前 MVP 已包含：
- 登录
- Dashboard
- Attack Events
- Event Detail
- Policies
- 与最小防护能力相关的策略管理和 protection simulator

## 本地地址
- Web: `http://127.0.0.1:3200`
- API: `http://127.0.0.1:3201`
- AI analyzer: `http://127.0.0.1:8000`

## 启动
在仓库根目录执行：

```powershell
docker compose up -d
npm run dev:api
npm run dev:web
```

如需验证 `recent-high-risk-events` 严格链路，再单独启动 AI analyzer。

## `/dashboard/policies` 最小使用流程
`/dashboard/policies` 是当前最小可用的策略与封禁管理入口，不新增独立重型页面。

最小操作流程：
1. 登录 Web 控制台。
2. 确认当前账号下已经有 tenant 和 site。
3. 进入 `/dashboard/policies`。
4. 通过页面顶部的站点筛选选择一个 site。
5. 在“策略配置”区读取并更新当前 site 的 `security policy`。
6. 在“封禁名单”区查看、新增、删除 `blocked entities`。
7. 在“防护判定模拟器”区输入请求特征，查看当前策略下会得到 `allow / monitor / block` 中哪一种结果。

## site ingestion key
`site ingestion key` 是 site 级别的专用接入密钥，用于：
- 调用 `POST /api/v1/protection/check`
- 调用 `POST /api/v1/request-logs`
- 供 `/dashboard/policies` 内的 protection simulator 使用
- 供 `packages/site-middleware` 在站点侧接入时使用

前置条件和限制：
- 它会在创建 site 时由后端返回一次明文
- 后端只保存其哈希值，之后无法再次查询原始明文
- 如果丢失，需要重新走站点接入或后续补专门的轮换能力
- simulator 和 middleware 都必须使用与当前 `siteId` 对应的 ingestion key

## protection simulator
`/dashboard/policies` 内已经集成最小可用的 protection simulator，复用真实后端接口：

`POST /api/v1/protection/check`

### 输入要求
- `siteId`
  - 由当前站点筛选决定
- `ingestionKey`
  - 需要输入当前 site 的真实 ingestion key
- `path`
  - 必填
- `queryString`
  - 可选
- `clientIp`
  - 可选，但如果要验证 `blocked_entities` 或 rate limit，建议填写
- `userAgent`
  - 可选，但如果要验证 suspicious UA，建议填写
- `referer`
  - 可选

页面内部会自动补齐：
- `occurredAt`
  - 使用当前时间
- `method`
  - 当前固定为 `GET`
- `host`
  - 使用当前 site 的 `siteDomain`

### 典型输出
返回结果包含：
- `mode`
  - `monitor` 或 `protect`
- `action`
  - `allow` / `monitor` / `block`
- `reasons`
  - 例如 `blocked_ip`、`blocked_sql_injection`、`blocked_xss`

典型场景：
- 未命中任何规则：`action = allow`
- 命中规则且 policy 为 `monitor`：`action = monitor`
- 命中规则且 policy 为 `protect`：`action = block`

## 常见失败码
当前与 simulator / middleware 最相关的失败码如下：

| code | 场景 | 说明 |
| --- | --- | --- |
| `INGESTION_KEY_REQUIRED` | 未传 `x-site-ingestion-key` | protection/check 和 request-logs 都要求 site ingestion key |
| `INVALID_INGESTION_KEY` | ingestion key 错误 | 最常见的 simulator 失败原因 |
| `SITE_NOT_FOUND` | siteId 不存在或 site 非 active | site 不可用时返回 |
| `VALIDATION_ERROR` | 请求体字段不合法 | 常见于 path、occurredAt、IP、expiresAt 等格式错误 |
| `PROTECTION_BLOCKED` | `POST /api/v1/request-logs` 在 `protect` 模式下命中规则 | API 会直接拒绝写入 request log |

补充说明：
- middleware 本地阻断响应使用的是 `REQUEST_BLOCKED`
- Web simulator 当前重点覆盖的是 `INVALID_INGESTION_KEY` 失败链路

## `/dashboard/policies` 与后端接口关系
当前页面会调用这些真实接口：
- `GET /api/v1/sites/:siteId/security-policy`
- `PUT /api/v1/sites/:siteId/security-policy`
- `GET /api/v1/sites/:siteId/blocked-entities`
- `POST /api/v1/sites/:siteId/blocked-entities`
- `DELETE /api/v1/blocked-entities/:id`
- `POST /api/v1/protection/check`

当前不在前端接入的能力：
- 批量封禁
- CIDR 管理
- 审计版本
- 自动封禁执行器
- reverse proxy / full traffic gateway

## 最小演示链路
推荐按下面顺序做演示：

1. 创建 tenant 和 site，保存 site ingestion key。
2. 打开 `/dashboard/policies?siteId=...`。
3. 把 policy mode 设为 `monitor`，保存策略。
4. 新增一个 blocked IP。
5. 在 protection simulator 中：
   - 使用正确 ingestion key
   - 填入同一个 blocked IP
   - 查看返回 `action = monitor`
6. 把 policy mode 切到 `protect`。
7. 再次用同样输入执行 simulator，确认返回 `action = block`
8. 如需验证站点侧链路，再运行 `site-middleware` enforcement smoke

这条演示链路已经覆盖：
- policy 读取/更新
- blocked entities 列表/新增/删除
- simulator 成功链路
- simulator 失败链路
- middleware 与 protection/check 一致性

## Smoke
### Policies smoke

```powershell
npm run smoke:dashboard-policies --workspace @secuai/web
```

覆盖：
- `security policy` 读取/更新
- `blocked entities` 列表/新增/删除
- simulator 成功链路
- simulator `INVALID_INGESTION_KEY` 失败链路
- busy / disabled / `role` / `aria-live` / `aria-busy` / `aria-disabled`

### Dashboard / Events smoke

```powershell
npm run smoke:dashboard-events --workspace @secuai/web
```

### Global error boundary smoke

```powershell
npm run smoke:global-error --workspace @secuai/web
npm run smoke:global-error:start --workspace @secuai/web
```

## 备注
- 当前 Web 控制台的策略与模拟能力服务于“最小防护能力演示”，不是完整网关配置台。
- 现阶段仍以日志接入、事件检测和 AI 风险分析主链路为核心。
