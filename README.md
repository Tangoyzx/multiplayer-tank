# 联机坦克大战（回合制炮战）

双人联机、回合制「角度/力度」炮战游戏。双方轮流控制坦克移动、瞄准、发射炮弹，炮弹抛物线飞行、炸出地形坑、造成伤害，直到一方 HP 归零。

## 技术栈

- TypeScript（前后端共享确定性算法）
- 前端：原生 TS + Canvas 2D，无引擎
- 后端：Node 20 + `ws` + 原生 `node:http`
- 构建：`tsc`（无 bundler，浏览器 `<script type="module">` + importmap）

## 目录结构

```
packages/
├─ shared/     # 前后端共享：协议类型、地形生成、弹道模拟、坦克数值、规则常量
├─ server/     # 服务端：HTTP 静态服务 + WebSocket + 房间状态机 + 权威裁决
└─ client/     # 前端：大厅/选坦克/战斗/结算 + Canvas 渲染 + 演出编排
scripts/
├─ selftest.cjs          # 纯函数自测（不依赖 vitest，见下）
└─ integration-test.cjs  # 双玩家端到端联调测试
deploy/
├─ ecosystem.config.cjs  # pm2 配置
└─ README-deploy.md      # 腾讯云部署手册
```

## 本地开发

```bash
pnpm install

# 1. 构建 shared + server + client
pnpm --filter @tank/shared build
pnpm --filter @tank/server build
pnpm --filter @tank/client build

# 2. 启动服务端（监听 8080）
node packages/server/dist/index.js

# 3. 浏览器打开（两个标签页/两台设备）
# http://127.0.0.1:8080
```

## 测试

```bash
# 纯函数自测（地形/弹道/伤害/随机数）
node scripts/selftest.cjs

# 端到端联调（需先启动服务端）
node scripts/integration-test.cjs
```

> **为什么不用 vitest**：vitest 需要 fork worker 进程 + esbuild native service，在受限沙箱环境（禁止子进程 spawn）下无法运行。`selftest.cjs` 是等价的单进程断言脚本，覆盖同样的纯函数测试点；在完整 Linux 环境（如腾讯云服务器）上，`pnpm --filter @tank/shared test` 仍会走 vitest。

## 游戏规则

- 场地 2400×900，单层高度图（中点位移法生成，seed 决定）
- 5 台坦克（战马/堡垒/游骑/重炮/狙击），属性差异化
- 每回合 120 秒：移动（消耗移动力）→ 瞄准（角度+力度）→ 发射
- 炮弹抛物线飞行，命中地形挖坑、命中坦克掉血，坠落也有伤害
- 一方 HP 归零或超时两次判负

## 关键设计

- **轻权威**：服务端算弹道/伤害/地形，客户端复算仅用于演出，杜绝作弊
- **确定性**：地形/弹道全由 seed + 固定步长模拟，两端演出一致
- **回合时长可配置**：`packages/shared/src/constants.ts` → `TURN.TURN_SECONDS`（当前 120s）

## 部署

见 [deploy/README-deploy.md](deploy/README-deploy.md)。
