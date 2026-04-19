# SecuAI Ubuntu 单机部署操作手册

本文档基于当前仓库中已经存在并接入的真实脚本、真实模板和真实入口编写，目标是让你在 Ubuntu 几乎“空白机器”的前提下，也能按步骤自己完成部署。

当前仓库中与 Ubuntu 生产部署直接相关的真实入口如下：

- 生产准备：`npm run prod:prepare`
- 生产启动：`npm run prod:start`
- 生产重启：`npm run prod:restart`
- 生产停止：`npm run prod:stop`
- 生产排查：`npm run doctor:prod`
- PM2 模板：`deploy/pm2/ecosystem.config.cjs`
- Nginx 模板：`deploy/nginx/secuai.conf`

如果后续仓库脚本发生变化，应以仓库当前文件为准，再回看本手册。

---

## 1. 部署目标与适用范围

### 1.1 适用范围

本教程适用于：

- Ubuntu 24.04 LTS
- 单机部署
- 演示环境
- 答辩 / 比赛环境
- 小规模真实接入验证环境

本教程不是：

- 多节点部署手册
- 完整网关部署手册
- 完整 WAF 运维手册

### 1.2 当前推荐部署结构

当前仓库推荐的 Ubuntu 对外访问结构如下：

```text
浏览器 / 外部访问
        ↓
      Nginx
        ↓
  127.0.0.1:3200 (Web)
  127.0.0.1:3201 (API)
        ↓
docker compose 或 docker-compose 提供 PostgreSQL / Redis
```

说明：

- Nginx 负责对外暴露 `80/443`
- Web 和 API 建议只监听本机地址
- PostgreSQL / Redis 由 Docker Compose 启动
- 当前 `prod:start` 不会自动启动 AI analyzer

### 1.3 开发模式和生产模式的区别

开发联调入口：

```bash
npm run dev:demo-stack
```

适用：

- 本地开发
- 联调
- 演示前快速验证

不适用：

- 长期对外服务
- Ubuntu 标准生产部署

Ubuntu 生产部署入口：

```bash
npm run prod:prepare
npm run prod:start
```

适用：

- 单机 Ubuntu 标准部署
- 借助 PM2 做进程守护
- 借助 Nginx 做统一外部入口

---

## 2. 最短执行路径

如果你已经有一台可联网、带 sudo 权限的 Ubuntu 24 机器，并且只是想先把最短路径跑起来，顺序就是：

1. 完成“第 3 节 裸机 Ubuntu 初始准备”
2. 完成“第 4 节 前置条件”和“第 5 节 仓库获取与目录准备”
3. 执行“第 6 节 安装依赖”
4. 按“第 7 节 环境变量配置”写好 `.env`
5. 执行：

```bash
npm install
npm run prod:prepare
npm run prod:start
```

6. 按“第 10 节 Nginx 配置”启用反向代理
7. 按“第 12 节 验证部署成功”检查是否 ready

如果你当前是完全空白的 Ubuntu，直接从第 3 节开始看。

---

## 3. 裸机 Ubuntu 初始准备

如果你的 Ubuntu 现在什么都没准备，请先做这一节。  
不要一上来就执行仓库里的命令，因为你很可能会先遇到这些问题：

- `git: command not found`
- `curl: command not found`
- `docker: command not found`
- `docker compose: command not found`
- `docker-compose: command not found`
- `pm2: command not found`
- `node: command not found`

### 3.1 确认你当前有 sudo 权限

```bash
whoami
sudo -v
```

### 3.2 更新软件源索引

```bash
sudo apt update
```

### 3.3 如果下载速度很慢，先切换 apt 软件源（可选）

如果你执行 `apt update`、`apt install` 很慢，或者长时间卡在官方源，可以先换国内镜像源，再继续后面的安装步骤。

当前更常见的是 Ubuntu 24.04，优先检查这个文件是否存在：

```bash
ls /etc/apt/sources.list.d/ubuntu.sources
```

如果文件存在，先看当前真实内容，不要直接假设它一定是 `archive.ubuntu.com`：

```bash
cat /etc/apt/sources.list.d/ubuntu.sources
```

很多机器里实际看到的可能是：

- `http://archive.ubuntu.com/ubuntu/`
- `http://us.archive.ubuntu.com/ubuntu/`
- `https://archive.ubuntu.com/ubuntu/`
- `http://security.ubuntu.com/ubuntu/`

所以这里不要只替换单一地址，直接统一替换所有常见 Ubuntu 官方源域名。

如果你想切到中科大源，按下面执行：

```bash
sudo cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
sudo sed -i 's|https\?://[a-zA-Z0-9.-]*archive.ubuntu.com/ubuntu/|https://mirrors.ustc.edu.cn/ubuntu/|g; s|https\?://security.ubuntu.com/ubuntu/|https://mirrors.ustc.edu.cn/ubuntu/|g' /etc/apt/sources.list.d/ubuntu.sources
sudo apt clean
sudo apt update
```

检查是否已生效：

```bash
cat /etc/apt/sources.list.d/ubuntu.sources
```

你应该看到 `URIs:` 已经统一变成：

```text
https://mirrors.ustc.edu.cn/ubuntu/
```

如果你更想用清华源，把上面命令中的地址替换成：

```text
https://mirrors.tuna.tsinghua.edu.cn/ubuntu/
```

注意：

- 你在 `apt update` 里仍然看到一些 `us` 或其他国外地址，不一定代表 Ubuntu 系统源没改成功
- 很多时候那是第三方源，例如 Docker、NodeSource 或其他额外仓库
- Ubuntu 系统源是否改成功，优先看 `/etc/apt/sources.list.d/ubuntu.sources` 的 `URIs:` 内容

如果你的机器没有 `/etc/apt/sources.list.d/ubuntu.sources`，而是旧格式的 `/etc/apt/sources.list`，先备份：

```bash
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
```

然后手动编辑 `/etc/apt/sources.list`，把其中的 Ubuntu 官方源替换成你要使用的镜像源，再执行：

```bash
sudo apt clean
sudo apt update
```

说明：

- 这一步是可选分支，只有当你发现官方源明显过慢时再做
- 如果你已经能稳定下载软件包，可以跳过这一步
- 换源只影响系统包下载，不影响仓库代码本身
- 换 Ubuntu 系统源不会自动修改 Docker、NodeSource 等第三方源

### 3.4 安装最基础的系统组件

```bash
sudo apt install -y ca-certificates gnupg lsb-release apt-transport-https software-properties-common
```

### 3.5 安装基础命令行工具

```bash
sudo apt install -y git curl wget unzip ufw
```

安装后检查：

```bash
git --version
curl --version
wget --version
ufw version
```

### 3.6 建议补充排查工具

```bash
sudo apt install -y net-tools iproute2 dnsutils
```

### 3.7 建议确认系统时间

```bash
timedatectl
```

---

## 4. 前置条件

### 4.1 服务器要求

建议至少：

- 2 vCPU
- 4 GB 内存
- 20 GB 以上可用磁盘

### 4.2 操作系统要求

推荐：

- Ubuntu 24.04 LTS

### 4.3 软件版本要求

建议版本：

- Node.js 20
- npm：随 Node.js 20 一起安装
- Docker
- Docker Compose
- PM2
- Nginx

### 4.4 PostgreSQL / Redis 的角色

当前仓库标准部署路径里：

- PostgreSQL：业务数据存储
- Redis：缓存 / 运行辅助

### 4.5 域名、端口、防火墙要求

对外推荐只放行：

- `80`
- `443`

不建议直接对公网暴露：

- `3200`
- `3201`
- `55432`
- `6379`

---

## 5. 仓库获取与目录准备

### 5.1 推荐部署目录

```bash
mkdir -p /srv
cd /srv
git clone https://github.com/weikaixuan222-cell/secuai-platformV3 secuai-platform
cd /srv/secuai-platform
```

### 5.2 首次进入项目后的检查

```bash
pwd
ls
cat package.json
```

---

## 6. 安装依赖

### 6.1 安装系统依赖

这一节只保留一条 Docker 主路径：

- Ubuntu 24 统一优先使用 Docker 官方软件源
- 统一安装 Compose V2，也就是 `docker compose`
- 不再把旧版 `docker-compose` 1.x 作为正常安装路径

先安装基础依赖：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx git wget ufw
```

再配置 Docker 官方软件源并安装 Docker Engine + Compose V2：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

安装后检查：

```bash
git --version
curl --version
nginx -v
docker version
docker compose version
```

### 6.2 如果提示 `无法定位软件包 docker-compose-plugin`

有些 Ubuntu 环境里，即使你已经配置了 Docker 官方仓库，仍然可能遇到下面两类报错：

```text
E: 无法定位软件包 docker-compose-plugin
软件包 docker-ce 没有可安装候选
```

说明当前机器没有正确识别 Docker 官方仓库，不要再退回旧版 `docker-compose` 1.x。

先检查：

```bash
cat /etc/os-release
cat /etc/apt/sources.list.d/docker.sources
apt-cache policy docker-ce docker-compose-plugin
sudo apt update
```

如果 `apt-cache policy` 看不到 `docker-ce` 和 `docker-compose-plugin` 的候选版本，直接切成传统的 `docker.list` 写法：

```bash
sudo rm -f /etc/apt/sources.list.d/docker.sources
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable
EOF

sudo apt update
apt-cache policy docker-ce docker-compose-plugin
```

看到候选版本后，再安装：

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker version
docker compose version
```

### 6.3 如果 `docker-compose --version` 报 `No module named distutils`

如果你看到类似报错：

```text
ModuleNotFoundError: No module named 'distutils'
```

这通常说明你装到了旧版 `docker-compose` 1.x。

根因是 Ubuntu 24.04 默认使用 Python 3.12，而 Python 3.12 已移除 `distutils`，所以旧版 `docker-compose` 1.x 经常直接失效。

处理方式是统一改回 Compose V2：

```bash
sudo apt remove -y docker-compose
docker compose version
```

如果这时 `docker compose version` 仍然提示 `unknown command`，回到上一节，按 Docker 官方软件源重新安装 Compose V2。

### 6.4 Docker Compose 当前推荐理解

- Ubuntu 24 生产部署优先使用 `docker compose`
- 当前仓库脚本虽然兼容 `docker-compose`
- 但文档主路径不再引导你安装旧版 `docker-compose` 1.x
- 你只需要保证 `docker compose version` 正常即可

### 6.5 安装 Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

检查：

```bash
node -v
npm -v
```

### 6.6 安装 PM2

```bash
sudo npm install -g pm2
```

检查：

```bash
pm2 -v
```

### 6.7 让当前用户可直接使用 Docker

```bash
sudo usermod -aG docker "$USER"
```

执行后必须重新登录一次 shell。重新登录后检查：

```bash
docker ps
docker compose version
```

### 6.8 安装 Node 依赖

在仓库根目录执行：

```bash
npm install
```

---

## 7. 环境变量配置

### 7.1 从模板复制

```bash
cp .env.example .env
```

### 7.2 推荐的生产环境写法

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

### 7.3 关键环境变量说明

- `POSTGRES_PORT`
  - PostgreSQL 映射到宿主机的端口
  - 默认 `55432`

- `REDIS_PORT`
  - Redis 映射到宿主机的端口
  - 默认 `6379`

- `HOST`
  - API 监听地址
  - 生产建议 `127.0.0.1`

- `API_PORT`
  - API 监听端口
  - 当前标准值 `3201`

- `HOSTNAME`
  - Web 监听地址
  - 生产建议 `127.0.0.1`

- `WEB_PORT`
  - Web 监听端口
  - 当前标准值 `3200`

- `DATABASE_URL`
  - API 连接 PostgreSQL 的地址
  - 必须与 `POSTGRES_PORT` 保持一致

- `DB_SSL_MODE`
  - 当前默认 `disable`

- `API_URL`
  - Web 调 API 时使用的内部地址
  - 当前标准写法是 `http://127.0.0.1:3201`

- `AI_ANALYZER_URL`
  - API 调 AI analyzer 时使用的地址
  - 当前生产入口不会自动启动 analyzer

### 7.4 哪些值必须确认

至少确认这些值：

- `DATABASE_URL`
- `HOST`
- `HOSTNAME`
- `API_URL`
- `AI_ANALYZER_URL`

### 7.5 生产环境下 HOST / HOSTNAME 的推荐写法

```env
HOST=127.0.0.1
HOSTNAME=127.0.0.1
```

### 7.6 什么时候可以改成 0.0.0.0

适合：

- 局域网联调
- 虚拟机与宿主机联调
- 临时排查网络问题

风险：

- 3200 / 3201 会直接绑定外网卡

### 7.7 Web、API、数据库、Redis、AI analyzer 的关系

```text
Web -> API_URL -> API
API -> DATABASE_URL -> PostgreSQL
API -> AI_ANALYZER_URL -> AI analyzer
docker compose / docker-compose -> PostgreSQL / Redis
Nginx -> Web / API
```

### 7.8 AI analyzer 的边界

当前标准部署主路径没有把 AI analyzer 自动纳入：

- `prod:prepare` 不会启动 AI analyzer
- `prod:start` 不会启动 AI analyzer
- `doctor:prod` 不会检查 AI analyzer

---

## 8. 构建与生产准备

### 8.1 执行命令

```bash
npm run prod:prepare
```

### 8.2 这个命令会做什么

当前脚本会依次执行：

1. 启动 `postgres` 和 `redis`
2. 执行 `npm run db:schema --workspace @secuai/api`
3. 构建 API
4. 构建 Web

### 8.3 成功标志

```bash
docker ps
ls apps/api/dist
ls apps/web/.next
```

### 8.4 如果失败，先看哪里

```bash
docker ps
cat .env
npm run db:schema --workspace @secuai/api
npm run build --workspace @secuai/api
npm run build --workspace @secuai/web
```

---

## 9. 生产启动

### 9.1 启动命令

```bash
npm run prod:start
```

底层实际调用：

```bash
pm2 start deploy/pm2/ecosystem.config.cjs
```

### 9.2 PM2 当前负责什么

PM2 模板当前会启动：

- `secuai-api`
- `secuai-web`

### 9.3 查看启动结果

```bash
pm2 list
```

### 9.4 查看日志

```bash
npm run prod:logs
pm2 logs secuai-api
pm2 logs secuai-web
```

### 9.5 重启与停止

```bash
npm run prod:restart
npm run prod:stop
```

### 9.6 确认端口监听

```bash
ss -lntp | grep -E '3200|3201'
```

### 9.7 PM2 开机自启

```bash
pm2 startup
pm2 save
```

---

## 10. Nginx 配置

### 10.1 复制并启用模板

```bash
sudo cp deploy/nginx/secuai.conf /etc/nginx/sites-available/secuai
sudo ln -sf /etc/nginx/sites-available/secuai /etc/nginx/sites-enabled/secuai
```

### 10.2 禁用默认站点

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

### 10.3 测试配置

```bash
sudo nginx -t
```

### 10.4 重载 Nginx

```bash
sudo systemctl reload nginx
```

如果 Nginx 还没启动：

```bash
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 10.5 当前反向代理规则

- `/api/` -> `127.0.0.1:3201`
- `/` -> `127.0.0.1:3200`
- `/_next/` -> `127.0.0.1:3200`

### 10.6 如果要配域名

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

然后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 10.7 HTTPS 当前覆盖边界

当前仓库已覆盖：

- HTTP 反向代理模板
- Web / API 本机监听方案

当前尚未覆盖：

- HTTPS 证书签发
- 自动续期
- HTTP -> HTTPS 跳转

---

## 11. 防火墙与安全建议

### 11.1 推荐只放行的端口

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 11.2 不建议直接暴露的端口

- `3200`
- `3201`
- `55432`
- `6379`

### 11.3 为什么生产建议监听 127.0.0.1

```env
HOST=127.0.0.1
HOSTNAME=127.0.0.1
```

### 11.4 什么时候允许 0.0.0.0

适合：

- 临时排查
- 虚拟机和宿主机联调
- 不走 Nginx 的短时验证

---

## 12. 验证部署成功

### 12.1 本机先验证内部服务

```bash
npm run doctor:prod
curl http://127.0.0.1:3201/health
curl -I http://127.0.0.1:3200/login
```

### 12.2 验证 PM2 进程

```bash
pm2 list
```

### 12.3 验证 Nginx 反代

```bash
sudo nginx -t
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/login
```

### 12.4 验证外部访问

```text
http://<Ubuntu_IP>/
http://<Ubuntu_IP>/login
```

### 12.5 什么情况算成功

至少满足：

1. `npm run prod:prepare` 成功
2. `npm run prod:start` 成功
3. `pm2 list` 中 API / Web 为 `online`
4. `npm run doctor:prod` 通过
5. `sudo nginx -t` 通过
6. 浏览器能打开 `/login`

---

## 13. 常见问题排查

### 13.1 `prod:prepare` 失败

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
- `docker compose` 未安装
- `docker-compose` 未安装
- 当前用户没有 Docker 权限
- 机器还是裸机状态，缺少必要组件

### 13.2 `prod:start` 失败

```bash
pm2 list
pm2 logs secuai-api
pm2 logs secuai-web
cat .env
```

### 13.3 PM2 启动失败

```bash
pm2 -v
node -v
npm -v
node -e "const config=require('./deploy/pm2/ecosystem.config.cjs'); console.log(config.apps.map((app)=>app.name))"
```

### 13.4 Nginx 配置错误

```bash
sudo nginx -t
sudo systemctl status nginx
```

### 13.5 80/443 无法访问

```bash
sudo ufw status
ss -lntp | grep -E '80|443'
sudo systemctl status nginx
```

### 13.6 3200/3201 监听异常

```bash
ss -lntp | grep -E '3200|3201'
cat .env
pm2 logs secuai-api
pm2 logs secuai-web
```

### 13.7 环境变量没生效

```bash
pwd
ls -a
cat .env
npm run prod:restart
```

### 13.8 数据库或 Redis 未就绪

```bash
docker ps
docker compose ps || docker-compose ps
ss -lntp | grep -E '55432|6379'
```

### 13.9 `doctor:prod` 报错

当前按顺序检查：

1. PostgreSQL
2. Redis
3. API `/health`
4. Web `/login`

### 13.10 页面能打开但 API 不通

```bash
curl http://127.0.0.1:3201/health
cat .env | grep API_URL
pm2 logs secuai-api
pm2 logs secuai-web
```

### 13.11 `docker-compose` 报 `No module named distutils`

如果你执行：

```bash
docker-compose --version
```

看到类似报错：

```text
ModuleNotFoundError: No module named 'distutils'
```

说明你装到了旧版 `docker-compose` 1.x。

在 Ubuntu 24 上，不建议继续修这个旧版本，而是直接改成 Compose V2：

```bash
sudo apt remove -y docker-compose
docker compose version
```

如果这里仍然提示：

```text
docker: unknown command: docker compose
```

说明你的机器还没有 Compose V2 插件。
回到第 `6.2` 节，切换到 Docker 官方软件源并安装：

- `docker-ce`
- `docker-ce-cli`
- `containerd.io`
- `docker-buildx-plugin`
- `docker-compose-plugin`

### 13.12 `docker-ce` 没有可安装候选

如果你执行：

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

看到类似报错：

```text
没有可用的软件包 docker-ce
软件包 docker-ce 没有可安装候选
无法定位软件包 docker-compose-plugin
```

说明 Docker 官方仓库没有被当前机器正确识别。

先检查：

```bash
cat /etc/os-release
cat /etc/apt/sources.list.d/docker.sources
apt-cache policy docker-ce docker-compose-plugin
sudo apt update
```

如果 `apt-cache policy` 看不到候选版本，改用传统 `docker.list`：

```bash
sudo rm -f /etc/apt/sources.list.d/docker.sources
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable
EOF

sudo apt update
apt-cache policy docker-ce docker-compose-plugin
```

确认已经看到候选版本后，再执行安装：

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker version
docker compose version
```

---

## 14. 更新与维护

### 14.1 代码更新后的标准流程

```bash
git pull
npm install
npm run prod:prepare
npm run prod:restart
```

如果 Nginx 模板也改了：

```bash
sudo cp deploy/nginx/secuai.conf /etc/nginx/sites-available/secuai
sudo nginx -t
sudo systemctl reload nginx
```

### 14.2 重新构建

```bash
npm run prod:prepare
```

### 14.3 平滑重启

```bash
npm run prod:restart
```

### 14.4 查看运行状态

```bash
pm2 list
npm run doctor:prod
```

### 14.5 回滚边界

当前仓库没有一键回滚脚本。

最小回滚方式通常是：

```bash
git log --oneline -n 5
git checkout <最近可用提交>
npm install
npm run prod:prepare
npm run prod:restart
```

---

## 15. 已被脚本覆盖的步骤

当前脚本已覆盖：

- `docker compose` 或 `docker-compose` 启动 PostgreSQL / Redis
- 数据库 schema 执行
- API / Web 构建
- PM2 启动与重启
- API / Web ready 检查

入口：

- `npm run prod:prepare`
- `npm run prod:start`
- `npm run prod:restart`
- `npm run doctor:prod`

## 16. 仍需人工执行的步骤

当前仍需手工完成：

- 裸机 Ubuntu 基础组件安装
- Node.js / Docker / PM2 / Nginx 安装
- 复制并编辑 `.env`
- 复制并启用 Nginx 配置
- 配置域名
- 放行防火墙
- 配置 HTTPS
- 配置 PM2 开机自启
- 真实外部访问验证

## 17. 尚未实机验证的边界

以下内容已按仓库真实脚本编写，但尚未在真实 Ubuntu 24 服务器上完成整套实机验证：

- `prod:start` + Nginx + 外部浏览器访问闭环
- 域名场景下的 Nginx 使用
- HTTPS 接入流程
- AI analyzer 与当前标准生产入口的联动

因此这份文档是：

- 基于仓库真实入口的详细操作手册

但不是：

- “已完成 Ubuntu 24 全链路实机验证”的最终发布手册
