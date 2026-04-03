# SecuAI Web 控制台

SecuAI MVP 的 Next.js 管理控制台。

## 本地开发约定

- Web: `http://127.0.0.1:3200`
- API: `http://127.0.0.1:3201`
- AI analyzer: `http://127.0.0.1:8000`

## 运行

按以下顺序启动服务：

1. 在仓库根目录启动 PostgreSQL 和 Redis：
```bash
docker compose up -d
```
2. 在 `services/ai-analyzer` 目录启动 AI 分析服务：
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
3. 在仓库根目录启动 API：
```bash
npm run dev:api
```
4. 在仓库根目录启动 Web：
```bash
npm run dev:web
```

打开：

```text
http://127.0.0.1:3200
```

Web 开发服务器被有意固定到 `127.0.0.1:3200`。
这样可以避开 Windows 排除 TCP 端口范围导致的 `0.0.0.0:3000` 绑定风险。

## API 代理

前端代理地址由环境变量 `API_URL` 控制，默认值为：

```text
http://127.0.0.1:3201
```

如果需要覆盖该地址，请将 `.env.example` 复制为 `.env.local` 并修改 `API_URL`。
这不会改变前端开发服务器的默认监听地址；`npm run dev:web` 仍会启动在 `127.0.0.1:3200`。

## 已知本地阻塞项

- 如果 `127.0.0.1:3201` 不可用，前端代理请求会失败。
- 如果本机 `127.0.0.1:3200` 已被占用，`npm run dev:web` 会绑定失败，需要先停止冲突进程。
- 如果 PostgreSQL 不可用或 schema 缺失，API 会返回后端错误。
- 如果 AI 分析服务不可用，后端 AI 评分与相关结果展示会不完整。
