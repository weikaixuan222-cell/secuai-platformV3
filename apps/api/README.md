# SecuAI API

`apps/api` 是 SecuAI 的 Node.js + TypeScript 后端 API，当前核心能力包括：

- `request_logs`
- `detection`
- `attack_events`
- `ai_risk_results`
- `security_policies`
- `blocked_entities`
- `POST /api/v1/protection/check`

## 本地开发

在仓库根目录执行：

```bash
npm run db:schema --workspace @secuai/api
npm run dev --workspace @secuai/api
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=3201`

常见联调变量：

```bash
HOST=127.0.0.1 PORT=3201 DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai DB_SSL_MODE=disable AI_ANALYZER_URL=http://127.0.0.1:8000 npm run dev --workspace @secuai/api
```

## 生产启动

Ubuntu 生产部署建议不要长期使用 `dev` 模式，而是统一通过：

```bash
npm run prod:start
```

PM2 会调用：

```bash
npm run start --workspace @secuai/api
```

Ubuntu 标准部署建议：

- `HOST=127.0.0.1`
- `PORT=3201`
- `DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai`
- `AI_ANALYZER_URL=http://127.0.0.1:8000`

然后由 Nginx 将 `/api/` 反代到 `127.0.0.1:3201`。

## 健康检查

```bash
curl http://127.0.0.1:3201/health
```
