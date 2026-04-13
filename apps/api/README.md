# SecuAI API

`apps/api` 是 SecuAI 的 Node.js + TypeScript 后端 API。

如果你当前是要部署 Ubuntu 服务器，请先看总文档：

- [Ubuntu 单机部署操作手册](../../DEPLOYMENT_UBUNTU.md)

## 开发模式

在仓库根目录执行：

```bash
npm run db:schema --workspace @secuai/api
npm run dev --workspace @secuai/api
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=3201`

## 生产模式

Ubuntu 单机生产部署建议不要长期使用 `dev` 模式，而是统一从仓库根目录走：

```bash
npm run prod:start
```

PM2 最终会调用：

```bash
npm run start --workspace @secuai/api
```

Ubuntu 单机标准部署建议：

- `HOST=127.0.0.1`
- `PORT=3201`
- `DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai`
- `AI_ANALYZER_URL=http://127.0.0.1:8000`

然后由 Nginx 将 `/api/` 反向代理到 API。
