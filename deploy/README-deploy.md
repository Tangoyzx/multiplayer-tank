# 联机坦克大战 — 部署手册

前后端同机部署在腾讯云轻量应用服务器，单 Node 进程同时提供静态页面（HTTP）和 WebSocket。

## 0. 架构总览

```
浏览器 ── HTTP GET /  ──▶ Node (8080) ── 静态文件 packages/client/dist
   │                          │
   └── WebSocket /ws ─────────┘ ── 游戏房间状态机 + 权威裁决
```

- 逻辑：**轻权威**——服务端算弹道/伤害/地形，客户端复算仅用于演出。
- 无数据库，房间仅存内存；无账号系统。

## 1. 服务器要求

| 项目 | 要求 |
|---|---|
| 系统 | 任意主流 Linux（Ubuntu/Debian/CentOS） |
| CPU/内存 | 2 核 2G 起（轻量实例即可） |
| Node | 20 LTS |
| 包管理 | pnpm + pm2 |

## 2. 控制台防火墙放行端口

腾讯云轻量服务器默认只放行 22/80/443/3389。**必须在控制台「防火墙」新增规则**：

| 协议 | 端口 | 来源 | 说明 |
|---|---|---|---|
| TCP | 8080 | 0.0.0.0/0 | 游戏服务 |

若实例内启用了 `firewalld`（CentOS 常见），同步放行：

```bash
sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload
```

> ⚠️ 国内地域用域名绑定 80/443 需要 ICP 备案。本方案用「公网 IP + 8080」绕开备案。

## 3. 安装环境

```bash
# Node 20（用 NodeSource 或 nvm）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs

# pnpm + pm2
npm install -g pnpm pm2

node -v   # 应显示 v20.x
```

## 4. 上传代码

```bash
# 本地打包上传（排除 node_modules）
# 或直接在服务器 git clone 你的仓库
git clone <你的仓库地址> multiplayer-tank
cd multiplayer-tank
```

## 5. 构建

```bash
pnpm install
pnpm --filter @tank/shared build
pnpm --filter @tank/server build
pnpm --filter @tank/client build
```

构建产物：
- `packages/server/dist/` — 服务端
- `packages/client/dist/` — 前端静态文件（含 `vendor/shared`）

## 6. 启动（pm2 守护）

```bash
mkdir -p logs
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示执行输出的命令，实现开机自启
```

查看状态：

```bash
pm2 status
pm2 logs multiplayer-tank
```

## 7. 验证

```bash
# 本机健康检查
curl http://127.0.0.1:8080/healthz
# 应返回 {"ok":true,"rooms":0,"players":0}

# 静态页面
curl -I http://127.0.0.1:8080/
# 应返回 200 text/html
```

**外网验证**：用手机（4G 流量，非同一 WiFi）浏览器访问：

```
http://<你的公网IP>:8080
```

应能看到大厅页面。开两台设备，一台创建房间、另一台输入房间码加入，即可对战。

## 8. 常见问题排查

### 8.1 外网连不上，但本机 curl 正常

1. 检查控制台防火墙是否放了 8080。
2. 检查实例内 `firewalld`/`ufw`：
   ```bash
   sudo ufw status   # Ubuntu
   sudo firewall-cmd --list-ports  # CentOS
   ```
3. 部分公司/校园网出站屏蔽非常规端口。改监听 80：
   ```bash
   pm2 delete multiplayer-tank
   PORT=80 pm2 start deploy/ecosystem.config.cjs
   ```
   （监听 80 需 root 或 `setcap`）

### 8.2 页面能开但 WebSocket 连不上

- 确认访问的是 `http://` 而不是 `https://`（HTTPS 页面不能连 ws://）。
- 浏览器控制台看 `ws://...` 是否 404/1006。

### 8.3 端口 80 被 Nginx 占用

轻量服务器的「应用镜像」可能预装 Nginx。检查：

```bash
sudo systemctl status nginx
sudo systemctl stop nginx && sudo systemctl disable nginx
```

或改用 Nginx 反代（见 §9）。

### 8.4 房间泄漏 / 内存增长

`/healthz` 的 `rooms` 应始终是活跃房间数。GC 每 30s 清理 CLOSED/无人/超时房间。

## 9. 后续升级到 HTTPS + WSS（可选）

备案域名解析到该 IP 后：

```bash
# 安装 Caddy（自动签证书）
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Caddyfile：

```
你的域名 {
    reverse_proxy 127.0.0.1:8080
}
```

客户端代码已用 `location.protocol` 自动推导 `ws://` / `wss://`，**无需改代码**。

## 10. 更新部署

```bash
cd multiplayer-tank
git pull
pnpm install
pnpm --filter @tank/shared build
pnpm --filter @tank/server build
pnpm --filter @tank/client build
pm2 restart multiplayer-tank
```

## 11. 配置项速查

| 配置 | 位置 | 说明 |
|---|---|---|
| 回合时长（120s） | `packages/shared/src/constants.ts` → `TURN.TURN_SECONDS` | 改后重新 build + restart |
| 重力/初速 | `constants.ts` → `PHYSICS` | 弹道手感 |
| 坦克数值 | `packages/shared/src/tanks.ts` → `TANKS` | HP/攻击/移动/角度/力度 |
| 端口 | `deploy/ecosystem.config.cjs` → `env.PORT` | |
