import { MsgType, TANKS } from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";

export class SelectScene implements Scene {
  private el!: HTMLElement;
  private unsub: (() => void) | null = null;
  private selectedId = "";

  enter(): void {
    this.el = document.getElementById("select")!;
    this.el.classList.remove("hidden");
    this.selectedId = "";

    const grid = this.el.querySelector<HTMLElement>(".tank-grid")!;
    grid.innerHTML = "";
    const readyBtn = this.el.querySelector<HTMLButtonElement>("#ready-btn")!;
    const oppStatus = this.el.querySelector<HTMLElement>("#opp-status")!;
    const roomCodeEl = this.el.querySelector<HTMLElement>("#select-room-code")!;
    roomCodeEl.textContent = session.roomCode;
    oppStatus.textContent = "等待对手选择...";
    readyBtn.disabled = true;

    for (const tank of TANKS) {
      const card = document.createElement("div");
      card.className = "tank-card";
      card.dataset.id = tank.id;
      card.innerHTML = `
        <div class="tank-name">${tank.name}</div>
        <div class="tank-desc">${tank.desc}</div>
        <div class="tank-stats">
          HP: ${tank.hp} &nbsp; 攻击: ${tank.atk}<br/>
          移动: ${tank.move} 步<br/>
          角度: ${tank.angle[0]}°~${tank.angle[1]}°<br/>
          力度: ${tank.power[0]}~${tank.power[1]}
        </div>
      `;
      card.onclick = () => {
        if (session.ready) return;
        this.selectedId = tank.id;
        grid.querySelectorAll(".tank-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        readyBtn.disabled = false;
      };
      grid.appendChild(card);
    }

    readyBtn.onclick = () => {
      if (!this.selectedId) return;
      session.selectedTankId = this.selectedId;
      session.ready = true;
      readyBtn.disabled = true;
      net.send({ t: MsgType.SELECT_TANK, tankId: this.selectedId });
      net.send({ t: MsgType.READY });
    };

    // 对手选择监听
    this.unsub = net.on((msg) => {
      if (msg.t === MsgType.TANK_SELECTED) {
        if (msg.slot !== session.slot) {
          session.oppTankId = msg.tankId;
          const opp = TANKS.find((t) => t.id === msg.tankId);
          oppStatus.textContent = `对手已选择：${opp?.name ?? msg.tankId}`;
        }
      } else if (msg.t === MsgType.BATTLE_START) {
        session.seed = msg.seed;
        session.firstSlot = msg.firstSlot;
        session.myTankId = msg.tanks[session.slot];
        session.oppTankId = msg.tanks[session.slot === 0 ? 1 : 0];
        sceneManager.switchTo("battle", msg);
      } else if (msg.t === MsgType.PHASE && msg.phase === "WAITING") {
        // 对手离开，回到等待
        oppStatus.textContent = "对手已离开，等待新对手...";
        session.ready = false;
      }
    });
  }

  exit(): void {
    this.unsub?.();
    this.el.classList.add("hidden");
  }
}
