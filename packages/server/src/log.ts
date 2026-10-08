// 服务端统一日志开关。
// 通过环境变量 TANK_LOG=0 关闭，默认打开。
// 也可在运行时调用 setLogEnabled() 动态切换。

let enabled = process.env.TANK_LOG !== "0";

export function setLogEnabled(v: boolean): void {
  enabled = v;
}

export function isLogEnabled(): boolean {
  return enabled;
}

type Args = unknown[];

export const log = {
  info(...args: Args): void {
    if (enabled) console.log(...args);
  },
  warn(...args: Args): void {
    if (enabled) console.warn(...args);
  },
  error(...args: Args): void {
    if (enabled) console.error(...args);
  },
};
