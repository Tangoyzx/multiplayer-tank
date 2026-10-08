// 客户端统一日志开关。
// 通过 URL 参数 ?log=0 或 localStorage 控制；默认打开。
// 也可在运行时调用 setLogEnabled() 动态切换。

let enabled = true;

// 启动时读取 URL 参数和 localStorage（localStorage 优先）
try {
  const stored = localStorage.getItem("tank_log_enabled");
  if (stored !== null) {
    enabled = stored !== "0";
  } else {
    const q = new URLSearchParams(location.search).get("log");
    if (q !== null) enabled = q !== "0";
  }
} catch {
  // localStorage 不可用时保持默认
}

export function setLogEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem("tank_log_enabled", v ? "1" : "0");
  } catch {
    /* ignore */
  }
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
