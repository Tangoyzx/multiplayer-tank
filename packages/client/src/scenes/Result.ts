import { MsgType } from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";

export class ResultScene implements Scene {
  private el!: HTMLElement;
  private unsub: (() => void) | null = null;

  enter(params?: unknown): void {
    this.el = document.getElementById("result")!;
    this.el.classList.remove("hidden");

    const textEl = this.el.querySelector<HTMLElement>("#result-text")!;
    const rematchBtn = this.el.querySelector<HTMLButtonElement>("#rematch-btn")!;
    const lobbyBtn = this.el.querySelector<HTMLButtonElement>("#result-lobby-btn")!;

    const { winnerSlot, reason } = params as { winnerSlot: 0 | 1; reason: string };
    const isWin = winnerSlot === session.slot;

    const reasonText: Record<string, string> = {
      hp: "",
      disconnect: "（对手掉线）",
      surrender: "（对手认输）",
      timeout: "（对手超时）",
    };
    textEl.textContent = isWin ? "胜利！" : "失败...";
    textEl.className = `result-text ${isWin ? "win" : "lose"}`;
    this.el.querySelector<HTMLElement>("#result-reason")!.textContent =
      reasonText[reason] ?? "";

    rematchBtn.onclick = () => {
      net.send({ t: MsgType.REMATCH });
      rematchBtn.disabled = true;
      rematchBtn.textContent = "等待对方...";
    };

    lobbyBtn.onclick = () => {
      net.send({ t: MsgType.LEAVE_ROOM });
      sceneManager.switchTo("lobby");
    };

    this.unsub = net.on((msg) => {
      if (msg.t === MsgType.PHASE && msg.phase === "SELECTING") {
        session.ready = false;
        sceneManager.switchTo("select");
      }
    });
  }

  exit(): void {
    this.unsub?.();
    this.el.classList.add("hidden");
  }
}
