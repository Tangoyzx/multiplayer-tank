import { log } from "./log.js";

// UI 工具：toast 提示
export function toast(message: string): void {
  log.info("[toast]", message);
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
