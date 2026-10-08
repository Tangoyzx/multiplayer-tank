import { MsgType, TANKS } from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";

export class SelectScene implements Scene {
  private el!: HTMLElement;
  private unsub: (() => void) | null = null;
  private index = 0; // 当前显示的坦克下标
  private selectedId = "";

  enter(): void {
    this.el = document.getElementById("select")!;
    this.el.classList.remove("hidden");
    this.index = 0;
    this.selectedId = "";

    const card = this.el.querySelector<HTMLElement>("#tank-card")!;
    const dots = this.el.querySelector<HTMLElement>("#tank-dots")!;
    const prevBtn = this.el.querySelector<HTMLButtonElement>("#tank-prev")!;
    const nextBtn = this.el.querySelector<HTMLButtonElement>("#tank-next")!;
    const readyBtn = this.el.querySelector<HTMLButtonElement>("#ready-btn")!;
    const oppStatus = this.el.querySelector<HTMLElement>("#opp-status")!;
    const roomCodeEl = this.el.querySelector<HTMLElement>("#select-room-code")!;
    roomCodeEl.textContent = session.roomCode;
    oppStatus.textContent = "等待对手选择...";
    readyBtn.disabled = true;

    // 生成圆点指示器
    dots.innerHTML = "";
    for (let i = 0; i < TANKS.length; i++) {
      const d = document.createElement("span");
      d.className = "dot";
      d.dataset.idx = String(i);
      dots.appendChild(d);
    }

    const render = () => {
      const tank = TANKS[this.index];
      this.selectedId = tank.id;
      card.innerHTML = `
        <div class="tank-name">${tank.name}</div>
        <div class="tank-desc">${tank.desc}</div>
        <div class="tank-stats">
          <div class="stat-row"><span>生命值 HP</span><b>${tank.hp}</b></div>
          <div class="stat-row"><span>攻击力</span><b>${tank.atk}</b></div>
          <div class="stat-row"><span>移动力</span><b>${tank.move} 步</b></div>
          <div class="stat-row"><span>射击角度</span><b>${tank.angle[0]}°~${tank.angle[1]}°</b></div>
          <div class="stat-row"><span>射击力度</span><b>${tank.power[0]}~${tank.power[1]}</b></div>
        </div>
      `;
      // 更新圆点
      dots.querySelectorAll<HTMLElement>(".dot").forEach((d, i) => {
        d.classList.toggle("active", i === this.index);
      });
      // 更新按钮可用状态
      prevBtn.disabled = this.index === 0;
      nextBtn.disabled = this.index === TANKS.length - 1;
      // 已准备则不可再换
      const locked = session.ready;
      prevBtn.disabled = prevBtn.disabled || locked;
      nextBtn.disabled = nextBtn.disabled || locked;
      readyBtn.disabled = locked;
    };

    prevBtn.onclick = () => {
      if (session.ready) return;
      if (this.index > 0) {
        this.index--;
        render();
      }
    };
    nextBtn.onclick = () => {
      if (session.ready) return;
      if (this.index < TANKS.length - 1) {
        this.index++;
        render();
      }
    };

    // 初始渲染（默认选中第一个）
    render();
    readyBtn.disabled = false;

    readyBtn.onclick = () => {
      if (!this.selectedId || session.ready) return;
      session.selectedTankId = this.selectedId;
      session.ready = true;
      readyBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
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
