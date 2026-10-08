import { MsgType } from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";

// 等待对手场景（创建房间后等待加入）
export class WaitingScene implements Scene {
  private el!: HTMLElement;
  private unsub: (() => void) | null = null;

  enter(): void {
    this.el = document.getElementById("waiting")!;
    this.el.classList.remove("hidden");
    const codeEl = this.el.querySelector<HTMLElement>("#waiting-code")!;
    codeEl.textContent = session.roomCode;

    this.unsub = net.on((msg) => {
      if (msg.t === MsgType.PLAYER_JOINED) {
        sceneManager.switchTo("select");
      } else if (msg.t === MsgType.PHASE && msg.phase === "SELECTING") {
        sceneManager.switchTo("select");
      }
    });
  }

  exit(): void {
    this.unsub?.();
    this.el.classList.add("hidden");
  }
}
