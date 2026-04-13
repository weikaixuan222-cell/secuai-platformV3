# SecuAI Ubuntu 单机部署操作手册

本文档基于当前仓库中已经存在并已接入的真实文件、真实脚本和真实模板编写，目标是让你在不依赖我代为操作的情况下，自己按步骤完成一台 Ubuntu 服务器上的标准部署。

当前教程对应的仓库主路径如下：

- 生产准备：`npm run prod:prepare`
- 生产启动：`npm run prod:start`
- 生产重启：`npm run prod:restart`
- 生产停止：`npm run prod:stop`
- 生产排查：`npm run doctor:prod`
- PM2 模板：`deploy/pm2/ecosystem.config.cjs`
- Nginx 模板：`deploy/nginx/secuai.conf`

如果后续脚本有变化，应以仓库当前文件为准，再回看本手册。

---

## 1. 部署目标与适用范围

### 1.1 本教程适用范围

本教程适用于：

- Ubuntu 24 系列服务器
- 单机部署
- 演示环境
- 比赛 / 答辩环境
- 小规模真实接入验证环境

本教程**不是**多节点部署手册，也不是完整网关或完整 WAF 的生产级运维手册。

### 1.2 当前标准部署结构

当前仓库推荐的 Ubuntu 对外访问方式是：

```text
浏览器 / 外部访问
        ↓
      Nginx
        ↓
  127.0.0.1:3200 (Web)
  127.0.0.1:3201 (API)
        ↓
docker compose 提供 PostgreSQL / Redis
```

说明：

- Nginx 负责对外暴露 `80/443`
- Web 与 API 进程本身建议只监听本机地址
- PostgreSQL / Redis 由 `docker compose` 提供
- 当前 `prod:start` **不会自动启动 AI analyzer**

### 1.3 开发模式与生产模式的区别

开发联调入口：

```bash
npm run dev:demo-stack
```

它适合：

- 本地开发
- 联调
- 演示前快速验证

它**不适合**长期作为 Ubuntu 对外服务入口。

Ubuntu 生产部署入口：

```bash
npm run prod:prepare
npm run prod:start
```

它适合：

- 单机 Ubuntu 标准部署
- 借助 PM2 做进程守护
- 借助 Nginx 做统一外部入口

---

## 2. 前置条件

### 2.1 服务器要求

建议至少准备：

- 2 vCPU
- 4 GB 内存
- 20 GB 以上可用磁盘

如果只是演示用途，配置可以更低；如果需要长期稳定运行，建议再留出日志、构建缓存和 Docker 数据卷空间。

### 2.2 操作系统要求

推荐：

- Ubuntu 24.04 LTS

本教程按 Ubuntu 24 写；如果你使用其他发行版，请自行调整包管理命令。

### 2.3 软件版本要求

建议版本：

- Node.js 20
- npm：随 Node.js 20 一起安装
- Docker
- Docker Compose
- PM2
- Nginx

### 2.4 PostgreSQL / Redis 的角色说明

当前仓库的标准路径里：

- PostgreSQL：存储业务数据
- Redis：提供缓存 / 辅助运行能力

这两个服务默认由仓库根目录的 `docker-compose.yml` 启动。

### 2.5 域名、端口、防火墙要求

对外推荐只放行：

- `80`
- `443`

不建议直接对公网暴露：

- `3200`
- `3201`
- `55432`
- `6379`

如果你有域名，可在 Nginx 里把 `server_name _;` 改成你的域名；如果当前只是 IP 访问，也可以先保留 `_`。

---

## 3. 仓库获取与目录准备

### 3.1 推荐部署目录

建议在固定目录部署，例如：

```bash
mkdir -p /srv
cd /srv
git clone <你的仓库地址> secuai-platform
cd /srv/secuai-platform
```

你也可以放到其他目录，但后续所有命令都要在仓库根目录执行。

### 3.2 首次进入项目后的检查步骤

进入项目后，先做这几步：

```bash
pwd
ls
cat package.json
```

你应该至少能看到：

- `apps/`
- `deploy/`
- `scripts/`
- `docker-compose.yml`
- `package.json`
- `DEPLOYMENT_UBUNTU.md`

如果这些文件不在，说明你当前不在仓库根目录。

---

## 4. 环境变量配置

### 4.1 从模板复制

```bash
cp .env.example .env
```

### 4.2 推荐的生产环境写法

当前 Ubuntu 单机标准部署，建议 `.env` 先按下面这组写：

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

### 4.3 每个关键环境变量的作用

- `POSTGRES_PORT`
  - Docker 映射到宿主机的 PostgreSQL 端口
  - 默认 `55432`
  - 如果宿主机已有 PostgreSQL，占用冲突时可以改

- `REDIS_PORT`
  - Docker 映射到宿主机的 Redis 端口
  - 默认 `6379`

- `HOST`
  - API 服务监听地址
  - 生产配合 Nginx 时建议 `127.0.0.1`

- `API_PORT`
  - API 服务监听端口
  - 当前固定标准值是 `3201`

- `HOSTNAME`
  - Web 服务监听地址
  - 生产配合 Nginx 时建议 `127.0.0.1`

- `WEB_PORT`
  - Web 服务监听端口
  - 当前固定标准值是 `3200`

- `DATABASE_URL`
  - API 连接 PostgreSQL 的地址
  - 必须与你的 `POSTGRES_PORT` 保持一致

- `DB_SSL_MODE`
  - 当前默认 `disable`
  - 如果你后续改为外部数据库并要求 SSL，再按实际环境调整

- `API_URL`
  - Web 访问 API 时使用的内部地址
  - 当前标准写法为 `http://127.0.0.1:3201`

- `AI_ANALYZER_URL`
  - API 调 AI analyzer 的地址
  - 当前 `prod:start` 不负责把 analyzer 启起来

### 4.4 哪些值必须改，哪些值可以先不改

通常必须确认的值：

- `DATABASE_URL`
- `HOST`
- `HOSTNAME`
- `API_URL`
- `AI_ANALYZER_URL`

通常可以保持默认的值：

- `API_PORT=3201`
- `WEB_PORT=3200`
- `POSTGRES_PORT=55432`
- `REDIS_PORT=6379`

### 4.5 生产环境下 HOST / HOSTNAME 的推荐写法

推荐生产写法：

```env
HOST=127.0.0.1
HOSTNAME=127.0.0.1
```

原因：

- Web / API 只对本机监听
- 外部流量统一走 Nginx
- 能减少服务直接裸露在公网的风险

### 4.6 什么时候可以用 0.0.0.0

适用场景：

- 临时局域网联调
- 宿主机直接访问虚拟机应用
- 暂时不用 Nginx，只想先确认服务能起来

风险：

- Web / API 会直接对外网卡监听
- 如果服务器安全组、防火墙配置不严，可能导致 `3200/3201` 被直接访问

### 4.7 Web、API、数据库、Redis、AI analyzer 的配置关系

关系如下：

```text
Web -> API_URL -> API
API -> DATABASE_URL -> PostgreSQL
API -> AI_ANALYZER_URL -> AI analyzer（可选依赖）
docker compose -> PostgreSQL / Redis
Nginx -> Web / API
```

### 4.8 AI analyzer 的边界

这轮标准部署主路径**没有**把 AI analyzer 自动纳入 `prod:start`。

这意味着：

- `npm run prod:prepare` 不会启动 AI analyzer
- `npm run prod:start` 不会启动 AI analyzer
- `doctor:prod` 当前也不检查 AI analyzer

如果你当前目标只是把 Web / API / Nginx 标准部署跑通，可以先不启动 analyzer。  
如果后续你要验证 AI 风险分析链路，再单独补 analyzer 的启动与健康检查。

---

## 5. 安装依赖

### 5.1 安装系统依赖

```bash
sudo apt update
sudo apt install -y git curl wget ufw nginx docker.io docker-compose
```

执行成功后，你可以用下面命令确认：

```bash
git --version
curl --version
docker --version
docker-compose --version
nginx -v
```

### 5.2 安装 Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

检查版本：

```bash
node -v
npm -v
```

预期：

- `node -v` 应该是 `v20.x`

### 5.3 安装 PM2

```bash
sudo npm install -g pm2
```

检查：

```bash
pm2 -v
```

### 5.4 让当前用户可直接执行 Docker

```bash
sudo usermod -aG docker "$USER"
```

执行后重新登录 shell，再检查：

```bash
docker ps
```

如果这里提示权限错误，说明当前 shell 还没重新登录。

### 5.5 安装 Node 依赖

在仓库根目录执行：

```bash
npm install
```

成功后，通常会看到依赖安装完成，没有 `npm ERR!` 即可。

---

## 6. 构建与生产准备

### 6.1 执行命令

```bash
npm run prod:prepare
```

### 6.2 这个命令会做什么

当前脚本 `scripts/prepare-production-stack.mjs` 会按顺序执行：

1. 启动 `postgres` 与 `redis`
2. 执行 `npm run db:schema --workspace @secuai/api`
3. 构建 API
4. 构建 Web

### 6.3 成功标志

你应该能看到类似输出：

- `启动 PostgreSQL 与 Redis`
- `执行数据库 schema`
- `构建 API`
- `构建 Web`
- `生产构建准备完成`

另外你还可以手动检查：

```bash
docker ps
ls apps/api/dist
ls apps/web/.next
```

预期：

- `docker ps` 中应有 `postgres`、`redis`
- `apps/api/dist` 应存在
- `apps/web/.next` 应存在

### 6.4 如果失败，先看哪里

先按下面顺序看：

1. `docker ps`
2. `cat .env`
3. `npm run db:schema --workspace @secuai/api`
4. `npm run build --workspace @secuai/api`
5. `npm run build --workspace @secuai/web`

常见原因：

- Docker 没启动
- `DATABASE_URL` 不匹配
- 端口冲突
- 依赖没装全

---

## 7. 生产启动

### 7.1 启动命令

```bash
npm run prod:start
```

当前根 `package.json` 实际调用的是：

```bash
pm2 start deploy/pm2/ecosystem.config.cjs
```

### 7.2 PM2 当前负责什么

PM2 模板 `deploy/pm2/ecosystem.config.cjs` 当前会启动：

- `secuai-api`
- `secuai-web`

不会启动：

- AI analyzer
- Nginx
- Docker 本身

### 7.3 查看启动结果

```bash
pm2 list
```

预期：

- 能看到 `secuai-api`
- 能看到 `secuai-web`
- 状态应为 `online`

### 7.4 查看日志

全部日志：

```bash
npm run prod:logs
```

单独查看 API：

```bash
pm2 logs secuai-api
```

单独查看 Web：

```bash
pm2 logs secuai-web
```

### 7.5 重启与停止

```bash
npm run prod:restart
npm run prod:stop
```

### 7.6 确认端口监听

```bash
ss -lntp | grep -E '3200|3201'
```

生产推荐预期：

- `127.0.0.1:3200`
- `127.0.0.1:3201`

如果你用了 `0.0.0.0`，则可能显示：

- `0.0.0.0:3200`
- `0.0.0.0:3201`

### 7.7 可选：让 PM2 开机自启

如果你希望重启服务器后自动恢复 PM2 进程，可以执行：

```bash
pm2 startup
pm2 save
```

`pm2 startup` 会输出一条需要你复制执行的命令，按提示执行即可。

说明：

- 这一步是 PM2 通用能力
- 当前仓库没有额外封装这一步
- 这一步属于人工操作

---

## 8. Nginx 配置

### 8.1 复制并启用模板

```bash
sudo cp deploy/nginx/secuai.conf /etc/nginx/sites-available/secuai
sudo ln -sf /etc/nginx/sites-available/secuai /etc/nginx/sites-enabled/secuai
```

### 8.2 禁用默认站点

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

### 8.3 测试配置

```bash
sudo nginx -t
```

预期：

```text
syntax is ok
test is successful
```

### 8.4 重载 Nginx

```bash
sudo systemctl reload nginx
```

如果 Nginx 还没启动：

```bash
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 8.5 当前反向代理规则

当前模板 `deploy/nginx/secuai.conf` 的关键约定是：

- `/api/` -> `127.0.0.1:3201`
- `/` -> `127.0.0.1:3200`
- `/_next/` -> `127.0.0.1:3200`

### 8.6 如果你要绑定域名

编辑：

```bash
sudo nano /etc/nginx/sites-available/secuai
```

把：

```nginx
server_name _;
```

改成：

```nginx
server_name your-domain.com www.your-domain.com;
```

然后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 8.7 如果你要走 HTTPS

当前仓库已覆盖：

- HTTP 反向代理模板
- Web / API 的本机监听方案

当前**尚未收口**：

- HTTPS 证书签发
- 自动续期
- 强制 HTTP -> HTTPS 跳转

如果你现在要上 HTTPS，建议后续单独接 `certbot`。这不属于当前仓库脚本已覆盖的部分。

---

## 9. 防火墙与安全建议

### 9.1 推荐只放行的端口

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 9.2 不建议直接暴露的端口

不建议直接对公网放行：

- `3200`
- `3201`
- `55432`
- `6379`

### 9.3 为什么生产建议监听 127.0.0.1

生产建议：

```env
HOST=127.0.0.1
HOSTNAME=127.0.0.1
```

原因：

- Web / API 只接受本机流量
- 外部流量统一经 Nginx
- 可以减少直接暴露内部服务的风险

### 9.4 允许 0.0.0.0 的场景与风险

适合：

- 临时排查
- 虚拟机与宿主机联调
- 不走 Nginx 的短时验证

风险：

- 应用直接绑定外网卡
- 3200/3201 可能被外部直接访问
- 更依赖安全组和防火墙配置正确

---

## 10. 验证部署成功

### 10.1 本机先验证内部服务

```bash
npm run doctor:prod
curl http://127.0.0.1:3201/health
curl -I http://127.0.0.1:3200/login
```

如果成功，通常应看到：

- `doctor:prod` 提示 API 与 Web ready
- `curl http://127.0.0.1:3201/health` 返回 JSON
- `curl -I http://127.0.0.1:3200/login` 返回 `200` 或 `307/308`

### 10.2 验证 PM2 进程

```bash
pm2 list
```

应看到：

- `secuai-api` 为 `online`
- `secuai-web` 为 `online`

### 10.3 验证 Nginx 反代

```bash
sudo nginx -t
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/login
```

预期：

- Nginx 配置校验成功
- `/` 与 `/login` 能返回正常响应头

### 10.4 验证外部访问

在同网段机器或宿主机访问：

```text
http://<Ubuntu_IP>/
http://<Ubuntu_IP>/login
```

如果你已经配置了域名：

```text
http://your-domain.com/
http://your-domain.com/login
```

### 10.5 什么情况算部署成功

至少满足以下条件：

1. `npm run prod:prepare` 成功
2. `npm run prod:start` 成功
3. `pm2 list` 里 `secuai-api` / `secuai-web` 为 `online`
4. `npm run doctor:prod` 通过
5. `sudo nginx -t` 通过
6. 浏览器能打开 `/login`

---

## 11. 常见问题排查

### 11.1 `prod:prepare` 失败

先查：

```bash
docker ps
npm run db:schema --workspace @secuai/api
npm run build --workspace @secuai/api
npm run build --workspace @secuai/web
```

常见原因：

- Docker 未启动
- `.env` 中 `DATABASE_URL` 错误
- PostgreSQL 端口冲突
- 依赖未安装完成

### 11.2 `prod:start` 失败

先查：

```bash
pm2 list
pm2 logs secuai-api
pm2 logs secuai-web
cat .env
```

重点看：

- `HOST` / `HOSTNAME`
- `PORT`
- `API_URL`
- `DATABASE_URL`

### 11.3 PM2 启动失败

先确认：

```bash
pm2 -v
node -v
npm -v
```

再确认 PM2 模板是否能正常加载：

```bash
node -e "const config=require('./deploy/pm2/ecosystem.config.cjs'); console.log(config.apps.map((app)=>app.name))"
```

### 11.4 Nginx 配置错误

先执行：

```bash
sudo nginx -t
```

再看：

```bash
sudo systemctl status nginx
```

如果是域名或模板修改后出错，先把 `/etc/nginx/sites-available/secuai` 与仓库模板对照检查。

### 11.5 `80/443` 无法访问

按顺序查：

```bash
sudo ufw status
ss -lntp | grep -E '80|443'
sudo systemctl status nginx
```

再确认：

- 云服务器安全组是否放行 `80/443`
- 你访问的 IP / 域名是否正确

### 11.6 `3200/3201` 监听异常

执行：

```bash
ss -lntp | grep -E '3200|3201'
cat .env
pm2 logs secuai-api
pm2 logs secuai-web
```

常见原因：

- 端口被旧进程占用
- `HOST` / `HOSTNAME` 设置不符合预期
- Web / API 构建未完成

### 11.7 环境变量没生效

先确认 `.env` 是否真的在仓库根目录：

```bash
pwd
ls -a
cat .env
```

再执行：

```bash
npm run prod:restart
```

原因：

- PM2 进程已存在时，仅修改 `.env` 不会自动刷新旧环境变量
- 需要执行 `prod:restart`，其底层会带 `--update-env`

### 11.8 数据库或 Redis 未就绪

执行：

```bash
docker ps
docker compose ps
```

再检查：

```bash
ss -lntp | grep -E '55432|6379'
```

必要时重跑：

```bash
npm run prod:prepare
```

### 11.9 `doctor:prod` 报错

先看报错提示，它已经按以下顺序检查：

1. PostgreSQL
2. Redis
3. API `/health`
4. Web `/login`

处理顺序建议：

```bash
docker ps
pm2 list
pm2 logs secuai-api
pm2 logs secuai-web
cat .env
```

### 11.10 页面能打开但 API 不通

先查：

```bash
curl http://127.0.0.1:3201/health
cat .env | grep API_URL
pm2 logs secuai-api
pm2 logs secuai-web
```

再确认：

- Web 的 `API_URL` 是否仍指向 `http://127.0.0.1:3201`
- Nginx `/api/` 规则是否存在
- 你访问的是 Web 页面还是直接打 API 路径

---

## 12. 更新与维护

### 12.1 代码更新后的标准流程

在仓库根目录执行：

```bash
git pull
npm install
npm run prod:prepare
npm run prod:restart
```

如果改动涉及 Nginx 模板，也要同步：

```bash
sudo cp deploy/nginx/secuai.conf /etc/nginx/sites-available/secuai
sudo nginx -t
sudo systemctl reload nginx
```

### 12.2 重新构建

```bash
npm run prod:prepare
```

### 12.3 平滑重启

```bash
npm run prod:restart
```

### 12.4 查看运行状态

```bash
pm2 list
npm run doctor:prod
```

### 12.5 回滚边界说明

当前仓库**没有**提供一键自动回滚脚本。

当前可行的最小回滚方式通常是：

1. 切回最近可用提交
2. 重新安装依赖
3. 重新构建
4. 重启 PM2

例如：

```bash
git log --oneline -n 5
git checkout <最近可用提交>
npm install
npm run prod:prepare
npm run prod:restart
```

注意：

- 这只是代码层回滚
- 数据库结构如果已经发生变化，当前仓库没有单独提供完整数据库回滚方案
- 所以真正上线前，仍建议你自己做代码版本与数据库备份

---

## 13. 哪些步骤已经被脚本覆盖

当前仓库脚本已覆盖：

- `docker compose` 启动 PostgreSQL / Redis
- 数据库 schema 执行
- API / Web 构建
- PM2 启动与重启
- API / Web ready 检查

具体脚本入口：

- `npm run prod:prepare`
- `npm run prod:start`
- `npm run prod:restart`
- `npm run doctor:prod`

## 14. 哪些步骤仍需要人工执行

当前仍需要你手工完成：

- 安装系统依赖
- 安装 Node.js / PM2 / Docker / Nginx
- 复制并编辑 `.env`
- 复制并启用 Nginx 配置
- 配置域名
- 放行防火墙
- 配置 HTTPS
- 配置 PM2 开机自启
- 真实外部访问验证

## 15. 尚未实机验证的边界

以下内容当前文档已按仓库真实脚本编写，但**尚未在真实 Ubuntu 24 服务器上完成整套实机验证**：

- `npm run prod:start` + `Nginx` + 外部浏览器访问的完整闭环
- 域名场景下的 Nginx 使用
- HTTPS 接入流程
- AI analyzer 与当前标准生产入口的联动

因此：

- 本文档当前是“基于仓库真实文件的详细可执行手册”
- 但不应声称“已完成 Ubuntu 24 全链路实机验证”

如果你准备实机部署，建议严格按本手册跑一遍，并记录你机器上的实际差异。
