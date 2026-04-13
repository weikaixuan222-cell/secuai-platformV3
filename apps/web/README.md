# SecuAI Web 控制台

`apps/web` 是 SecuAI 的 Next.js 管理后台，当前负责：

- 登录 / 注册
- Dashboard
- Attack Events
- Event Detail
- Policies
- protection simulator

## 本地开发

在仓库根目录执行：

```bash
npm run dev:web
```

默认监听：

- `HOSTNAME=0.0.0.0`
- `PORT=3200`

常见联调变量：

```bash
HOSTNAME=127.0.0.1 PORT=3200 API_URL=http://127.0.0.1:3201 npm run dev:web
```

## 生产启动

当前生产启动不再建议直接手敲 `next start`，而是统一通过：

```bash
npm run prod:start
```

PM2 会调用：

```bash
npm run start --workspace @secuai/web
```

仓库内部已将 `start` 收口为带 `HOSTNAME` / `PORT` 解析的生产启动脚本。

Ubuntu 标准部署建议：

- `HOSTNAME=127.0.0.1`
- `PORT=3200`
- `API_URL=http://127.0.0.1:3201`

然后由 Nginx 将 `/` 反代到 `127.0.0.1:3200`。
