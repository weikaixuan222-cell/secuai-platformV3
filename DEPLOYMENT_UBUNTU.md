# SecuAI Ubuntu 24 标准部署指南

本文档对应当前仓库已经收口的 Ubuntu 生产部署主路径：

- `docker compose` 负责 PostgreSQL / Redis
- `PM2` 负责 API / Web 进程守护
- `Nginx` 负责对外暴露 `80/443`

当前目标是提供统一、稳定、可重复的 Ubuntu 部署方式，而不是继续使用 `npm run dev:demo-stack` 对外服务。

## 1. 安装基础依赖

```bash
sudo apt update
sudo apt install -y git curl wget ufw nginx docker.io docker-compose
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

如果当前用户尚未加入 `docker` 用户组：

```bash
sudo usermod -aG docker "$USER"
```

执行后重新登录一次 shell。

## 2. 获取代码并安装依赖

```bash
git clone <你的仓库地址> secuai-platform
cd secuai-platform
npm install
```

## 3. 准备环境变量

复制模板：

```bash
cp .env.example .env
```

生产部署推荐值：

```env
POSTGRES_PORT=55432
REDIS_PORT=6379
HOST=127.0.0.1
API_PORT=3201
HOSTNAME=127.0.0.1
WEB_PORT=3200
DATABASE_URL=postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai
DB_SSL_MODE=disable
API_URL=http://127.0.0.1:3201
AI_ANALYZER_URL=http://127.0.0.1:8000
AI_ANALYZER_TIMEOUT_MS=1500
AI_ANALYZER_MAX_RETRIES=1
```

说明：

- `HOST` / `HOSTNAME` 设为 `127.0.0.1`，用于配合 Nginx 反向代理
- 如果只是临时局域网联调，也可以改成 `0.0.0.0`
- 如果 PostgreSQL 端口与宿主机已有服务冲突，可仅修改 `POSTGRES_PORT`

## 4. 启动基础设施并构建生产产物

```bash
npm run prod:prepare
```

该命令会自动完成：

1. 启动 `postgres` 与 `redis`
2. 执行数据库 schema
3. 构建 API
4. 构建 Web

## 5. 启动应用进程

```bash
npm run prod:start
```

常用 PM2 命令：

```bash
npm run prod:restart
npm run prod:stop
npm run prod:logs
pm2 list
```

仓库中的 PM2 模板：

- `deploy/pm2/ecosystem.config.cjs`

## 6. 配置 Nginx

复制仓库内模板：

```bash
sudo cp deploy/nginx/secuai.conf /etc/nginx/sites-available/secuai
sudo ln -sf /etc/nginx/sites-available/secuai /etc/nginx/sites-enabled/secuai
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

模板文件：

- `deploy/nginx/secuai.conf`

反代约定：

- `/` -> `127.0.0.1:3200`
- `/api/` -> `127.0.0.1:3201`

如果需要 HTTPS，建议后续再接 `certbot`；本轮仓库先收口 HTTP 标准入口。

## 7. 放行防火墙

推荐只放行 `80/443`，不直接暴露 `3200/3201`：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 8. 验证方式

### 8.1 验证内部服务

```bash
npm run doctor:prod
curl http://127.0.0.1:3201/health
curl -I http://127.0.0.1:3200/login
```

### 8.2 验证 Nginx

```bash
sudo nginx -t
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/login
curl http://127.0.0.1/api/v1/health || curl http://127.0.0.1/health
```

说明：

- 当前 API 健康检查路径仍为 `http://127.0.0.1:3201/health`
- 如果 Nginx 只转发 `/api/`，则外部访问 API 应走 `/api/...`
- 如果当前站点只演示 Web 页面，可优先验证 `/login`

### 8.3 验证外部访问

在宿主机或同网段机器访问：

```text
http://<Ubuntu_IP>/
http://<Ubuntu_IP>/login
```

## 9. 故障排查顺序

1. `npm run doctor:prod`
2. `pm2 list`
3. `pm2 logs secuai-api`
4. `pm2 logs secuai-web`
5. `sudo nginx -t`
6. `sudo systemctl status nginx`
7. `ss -lntp | grep -E '3200|3201|80|443'`

## 10. 当前边界

这套 Ubuntu 生产部署主路径已经适合：

- 单机部署
- 演示环境
- 比赛 / 答辩环境
- 小规模真实接入验证

当前还没有覆盖：

- HTTPS 自动签发与续期
- 多节点部署
- 高并发压测与容量规划
- 完整网关化能力
