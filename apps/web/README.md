# SecuAI Web 控制台

`apps/web` 是 SecuAI 的 Next.js 管理后台。

如果你当前是要部署 Ubuntu 服务器，请先看总文档：

- [Ubuntu 单机部署操作手册](../../DEPLOYMENT_UBUNTU.md)

## 开发模式

在仓库根目录执行：

```bash
npm run dev:web
```

默认监听：

- `HOSTNAME=0.0.0.0`
- `PORT=3200`

## 生产模式

当前生产启动不建议手动直接敲 `next start`，而是统一从仓库根目录走：

```bash
npm run prod:start
```

PM2 最终会调用：

```bash
npm run start --workspace @secuai/web
```

Ubuntu 单机标准部署建议：

- `HOSTNAME=127.0.0.1`
- `PORT=3200`
- `API_URL=http://127.0.0.1:3201`

然后由 Nginx 将 `/` 与 `/_next/` 反向代理到 Web。
