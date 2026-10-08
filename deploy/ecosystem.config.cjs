// pm2 配置：守护服务端进程 + 开机自启
module.exports = {
  apps: [
    {
      name: "multiplayer-tank",
      script: "packages/server/dist/index.js",
      cwd: __dirname + "/..",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
      // 日志
      out_file: "logs/out.log",
      error_file: "logs/err.log",
      merge_logs: true,
    },
  ],
};
