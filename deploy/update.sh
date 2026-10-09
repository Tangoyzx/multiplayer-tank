#!/usr/bin/env bash
# 一键更新部署脚本：git pull + 安装依赖 + 构建 + 重启
# 用法：bash deploy/update.sh
set -euo pipefail

# 切到项目根目录（脚本位于 deploy/ 下，上一级即项目根）
cd "$(dirname "$0")/.."

echo "==> [1/5] git pull"
git pull

echo "==> [2/5] 安装依赖（如有新增）"
pnpm install

echo "==> [3/5] 构建 shared"
pnpm --filter @tank/shared build

echo "==> [4/5] 构建 server 与 client"
pnpm --filter @tank/server build
pnpm --filter @tank/client build

echo "==> [5/5] 重启服务"
if pm2 describe multiplayer-tank >/dev/null 2>&1; then
  pm2 restart multiplayer-tank
else
  # 首次部署：直接启动
  pm2 start deploy/ecosystem.config.cjs
  pm2 save
fi

echo "==> 完成 ✅"
pm2 status
