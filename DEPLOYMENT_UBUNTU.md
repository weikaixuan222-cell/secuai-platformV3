# SecuAI 智能防御系统 V3.0 - Ubuntu 24.04 部署指南

本指南适用于在 Ubuntu 24.04 LTS (虚拟机环境) 上从零开始部署 SecuAI 全栈平台。

---

## 1. 基础环境准备

在开始之前，请确保您的虚拟机网络正常，并建议使用 `ssh` 连接到虚拟机操作。

### 1.1 系统更新与基础工具
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget ufw
```

### 1.2 安装 Docker & Docker Compose
```bash
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $USER
# 注：执行完 usermod 后，建议重新登录 SSH 以生效权限
```

### 1.3 安装 Node.js 20 & PM2
```bash
# 安装 Node.js 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2 进程管理器
sudo npm install -g pm2
```

### 1.4 安装 Python 3.12 (系统默认) & 虚拟环境
```bash
sudo apt install -y python3-venv python3-pip
```

---

## 2. 获取代码与配置

### 2.1 克隆仓库与安装依赖
```bash
git clone https://github.com/your-repo/secuai-platform.git # 请替换为实际仓库地址
cd secuai-platform
npm install
```

### 2.2 环境变量配置
为简单起见，我们将配置环境变量以便服务能相互通信。

**获取虚拟机 IP:**
```bash
ip addr show eth0 | grep inet | awk '{ print $2 }' # 请根据实际网卡名(如 ens33)调整
```
*假设虚拟机 IP 为 `192.168.1.100`*

---

## 3. 基础设施部署 (DB & Redis)

我们使用项目根目录下的 `docker-compose.yml` 启动数据库。

```bash
# 启动容器
docker-compose up -d

# 检查容器状态
docker ps
```

---

## 4. 各服务部署流程

### 4.1 数据库初始化 (Migrations)
```bash
npm run db:schema --workspace @secuai/api
```

### 4.2 AI 分析服务 (Python)
```bash
# 进入服务目录
cd services/ai-analyzer

# 创建并激活虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装 Python 依赖
pip install -r requirements.txt

# 使用 PM2 启动服务
pm2 start "uvicorn app.main:app --host 0.0.0.0 --port 8000" --name "secuai-ai"

# 退出虚拟环境并返回根目录
deactivate
cd ../../
```

### 4.3 后端 API 服务 (Node.js)
```bash
# 构建 API
npm run build --workspace @secuai/api

# 使用 PM2 启动
# 设置必要的生产环境变量
pm2 start apps/api/dist/main.js --name "secuai-api" -- \
  --port 3201 \
  --database-url "postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai" \
  --ai-analyzer-url "http://127.0.0.1:8000"
```

### 4.4 前端 Web 控制台 (Next.js)
```bash
# 构建 Web
npm run build --workspace @secuai/web

# 使用 PM2 启动 (Next.js 标准启动命令)
# HOSTNAME=0.0.0.0 确保外部可访问
pm2 start "npm run start --workspace @secuai/web" --name "secuai-web" -- \
  --port 3200 \
  --api-url "http://127.0.0.1:3201"
```

---

## 5. 验证与运维

### 5.1 查看服务状态
```bash
pm2 list
```

### 5.2 查看日志
```bash
pm2 logs secuai-api
pm2 logs secuai-web
pm2 logs secuai-ai
```

### 5.3 健康检查
```bash
# API 健康检查
curl http://127.0.0.1:3201/health

# AI 服务检查
curl http://127.0.0.1:8000/health
```

### 5.4 外部访问
通过宿主机浏览器访问：
- **Web 控制台**: `http://<虚拟机IP>:3200`
- **默认登录**: 请参考项目中 `seeds` 或 README (通常包含 mock 账号)

---

## 6. (可选) 配置 Nginx 反向代理

如果您希望通过 80 端口直接访问：

```bash
sudo apt install -y nginx
```

创建配置 `/etc/nginx/sites-available/secuai`:
```nginx
server {
    listen 80;
    server_name _; # 或者您的域名

    location / {
        proxy_pass http://127.0.0.1:3200; # Web
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3201/; # API
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/secuai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

> [!IMPORTANT]
> **安全提醒**: 
> 1. 请务必在生产环境修改 `docker-compose.yml` 中的数据库默认密码。
> 2. 如果开启了 UFW 防火墙，请放行对应端口: `sudo ufw allow 3200/tcp && sudo ufw allow 3201/tcp && sudo ufw allow 80/tcp`。
