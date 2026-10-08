// 战斗主场景：接收指令、渲染、输入、演出编排
import {
  MsgType,
  WORLD,
  COLS,
  TURN,
  generateHeights,
  applyCrater,
  heightAt,
  TANKS,
  type ServerMessage,
  type Slot,
  type Point,
  type BattleStartMsg,
} from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";
import { Renderer } from "../render/renderer.js";

const TANK_HALF_H = 20;
const TANK_COLORS = ["#3b82f6", "#ef4444"]; // slot 0 蓝, slot 1 红

interface TankState {
  x: number;
  y: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  moveLeft: number;
  tankId: string;
}

export class BattleScene implements Scene {
  private el!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private renderer!: Renderer;
  private unsub: (() => void) | null = null;

  private heights: Float32Array = new Float32Array(0);
  private tanks: [TankState, TankState] = [this.emptyTank(), this.emptyTank()];
  private currentSlot: Slot = 0;
  private turnId = 0;
  private deadline = 0;
  private myTurn = false;

  // 输入状态
  private aimAngle = 45;
  private aimPower = 60;
  private turretAngles: [number, number] = [0, 0];

  // 炮弹/演出
  private shell: { x: number; y: number; traj: Point[]; idx: number } | null = null;

  private raf = 0;
  private lastTime = 0;
  private animating = false;

  private emptyTank(): TankState {
    return { x: 0, y: 0, facing: 1, hp: 0, maxHp: 0, moveLeft: 0, tankId: "" };
  }

  enter(params?: unknown): void {
    this.el = document.getElementById("battle")!;
    this.el.classList.remove("hidden");
    this.canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.renderer = new Renderer(this.ctx);

    this.resize();
    window.addEventListener("resize", this.resize);

    const start = params as BattleStartMsg;
    this.initBattle(start);

    // 显示先手提示
    const firstName = TANKS.find((t) => t.id === start.tanks[start.firstSlot])?.name ?? "";
    const banner = this.el.querySelector<HTMLElement>("#turn-banner")!;
    banner.textContent = `先手：${firstName}`;
    setTimeout(() => {
      if (banner.textContent === `先手：${firstName}`) banner.textContent = "";
    }, 1800);

    this.unsub = net.on((msg) => this.onMessage(msg));

    this.setupInput();
    this.bindHud();

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
  };

  private initBattle(start: BattleStartMsg): void {
    this.heights = generateHeights(start.seed);
    for (const slot of [0, 1] as Slot[]) {
      const spawn = start.spawn[slot];
      const def = TANKS.find((t) => t.id === start.tanks[slot])!;
      this.tanks[slot] = {
        x: spawn.x,
        y: spawn.y,
        facing: slot === 0 ? 1 : -1,
        hp: def.hp,
        maxHp: def.hp,
        moveLeft: def.move,
        tankId: start.tanks[slot],
      };
    }
    this.currentSlot = start.firstSlot;
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case MsgType.TURN_BEGIN:
        this.turnId = msg.turnId;
        this.currentSlot = msg.slot;
        this.deadline = msg.deadline;
        this.myTurn = msg.slot === session.slot;
        this.tanks[msg.slot].moveLeft = msg.moveBudget;
        this.animating = false;
        this.shell = null;
        this.showTurnBanner(msg.slot);
        this.updateHud();
        break;

      case MsgType.MOVE_RESULT:
        this.animateMove(msg.slot, msg.path, msg.moveLeft);
        break;

      case MsgType.FIRE_RESULT:
        this.animateFire(msg);
        break;

      case MsgType.TURN_TIMEOUT:
        this.showTurnBanner(msg.slot, "超时！");
        break;

      case MsgType.GAME_OVER:
        this.animating = false;
        setTimeout(() => sceneManager.switchTo("result", msg), 1500);
        break;

      case MsgType.OPPONENT_LEFT:
        this.showTurnBanner(this.currentSlot, "对手掉线，等待重连...");
        break;

      case MsgType.STATE_SYNC:
        // 硬同步
        this.hardSync(msg);
        break;
    }
  }

  private hardSync(msg: Extract<ServerMessage, { t: typeof MsgType.STATE_SYNC }>): void {
    this.heights = generateHeights(msg.seed);
    for (const crater of msg.craters) {
      applyCrater(this.heights, crater.x, crater.y, crater.r);
    }
    for (const p of msg.players) {
      this.tanks[p.slot] = {
        x: p.x,
        y: p.y,
        facing: p.facing,
        hp: p.hp,
        maxHp: this.tanks[p.slot].maxHp,
        moveLeft: p.moveLeft,
        tankId: p.tankId,
      };
    }
    this.currentSlot = msg.currentSlot;
    this.turnId = msg.turnId;
    this.deadline = msg.turnDeadline;
    // 恢复「是否我的回合」状态
    this.myTurn = msg.currentSlot === session.slot;
    this.updateHud();
  }

  private showTurnBanner(slot: Slot, custom?: string): void {
    const banner = this.el.querySelector<HTMLElement>("#turn-banner")!;
    if (custom) {
      banner.textContent = custom;
    } else {
      const name = slot === session.slot ? "你的回合" : "对手回合";
      banner.textContent = `${name}`;
    }
    banner.style.animation = "none";
    void banner.offsetWidth;
    banner.style.animation = "";
    setTimeout(() => {
      if (banner.textContent === (custom ?? (slot === session.slot ? "你的回合" : "对手回合"))) {
        banner.textContent = "";
      }
    }, 2000);
  }

  private bindHud(): void {
    // 每帧更新 HUD（在 loop 里调用）
  }

  private updateHud(): void {
    for (const slot of [0, 1] as Slot[]) {
      const t = this.tanks[slot];
      const hpFill = this.el.querySelector<HTMLElement>(`#hp-fill-${slot}`)!;
      const hpPct = Math.max(0, (t.hp / t.maxHp) * 100);
      hpFill.style.width = hpPct + "%";
      hpFill.className = `hp-fill ${hpPct < 30 ? "low" : ""}`;
      const nameEl = this.el.querySelector<HTMLElement>(`#nick-${slot}`)!;
      const def = TANKS.find((x) => x.id === t.tankId);
      nameEl.textContent = `${slot === session.slot ? "我" : "对手"} · ${def?.name ?? ""}`;
    }
    // 移动力
    const moveEl = this.el.querySelector<HTMLElement>("#move-indicator")!;
    moveEl.textContent = `移动力：${this.tanks[this.currentSlot].moveLeft}`;
    this.updateInputState();
  }

  // 根据 myTurn / animating 切换输入 UI 的可用状态（视觉屏蔽）
  private updateInputState(): void {
    const canAct = this.myTurn && !this.animating;
    const controls = this.el.querySelectorAll<HTMLElement>("#btn-left, #btn-right, #btn-fire");
    controls.forEach((c) => {
      c.style.opacity = canAct ? "1" : "0.3";
      c.style.pointerEvents = canAct ? "auto" : "none";
    });
    // 键盘/拖拽也通过 this.myTurn / this.animating 在事件处理里判断，这里无需额外处理
  }

  private setupInput(): void {
    // 键盘
    window.addEventListener("keydown", this.onKeyDown);
    // 触控按钮
    const leftBtn = this.el.querySelector<HTMLElement>("#btn-left")!;
    const rightBtn = this.el.querySelector<HTMLElement>("#btn-right")!;
    const fireBtn = this.el.querySelector<HTMLElement>("#btn-fire")!;

    // 移动：按下立即走一步，按住则每 120ms 连续走（用指针事件 + 全局监听，避免 pointerleave 误停）
    const startMove = (dir: -1 | 1) => {
      // 立即走第一步（不等 interval）
      if (this.myTurn && !this.animating) {
        net.send({ t: MsgType.MOVE, turnId: this.turnId, dir, steps: 1 });
      }
      // 持续移动
      const interval = setInterval(() => {
        if (this.myTurn && !this.animating) {
          net.send({ t: MsgType.MOVE, turnId: this.turnId, dir, steps: 1 });
        } else {
          clearInterval(interval);
        }
      }, 120);
      return interval;
    };

    const bindHold = (btn: HTMLElement, dir: -1 | 1) => {
      let iv: ReturnType<typeof setInterval> | null = null;

      const clear = () => {
        if (iv !== null) {
          clearInterval(iv);
          iv = null;
        }
      };

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        // 防止重复按住（多点触控/重复触发）
        if (iv !== null) return;
        iv = startMove(dir);
      });

      // 用全局 pointerup/pointercancel 结束，避免 pointerleave 在触屏上误触发
      btn.addEventListener("pointerup", clear);
      btn.addEventListener("pointercancel", clear);
      // 鼠标移出按钮时也结束（PC 端体验）
      btn.addEventListener("pointerleave", clear);
      // 兜底：指针释放时若还没清，也清一次
      window.addEventListener("pointerup", clear, { once: true });
    };

    bindHold(leftBtn, -1);
    bindHold(rightBtn, 1);

    fireBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.myTurn && !this.animating) {
        net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower });
      }
    });

    // 鼠标拖拽瞄准（画布上）
    let dragStart: Point | null = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.myTurn || this.animating) return;
      dragStart = this.screenToWorld(e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const cur = this.screenToWorld(e.clientX, e.clientY);
      const me = this.tanks[session.slot];
      const dx = cur.x - me.x;
      const dy = cur.y - me.y;
      // 拉弓式：向后拉
      const pullX = me.x - cur.x;
      const pullY = me.y - cur.y;
      const dist = Math.min(200, Math.hypot(pullX, pullY));
      const angleRad = Math.atan2(-pullY, Math.abs(pullX));
      this.aimAngle = clamp(Math.round((angleRad * 180) / Math.PI), 0, 89);
      this.aimPower = clamp(Math.round(dist / 2), 20, 100);
      this.turretAngles[session.slot] = -angleRad * (me.facing === 1 ? 1 : -1);
      this.updateAimHud();
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (dragStart) {
        dragStart = null;
        // 松手发射
        if (this.myTurn && !this.animating) {
          net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower });
        }
      }
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.myTurn || this.animating) return;
    switch (e.key) {
      case "ArrowLeft":
        net.send({ t: MsgType.MOVE, turnId: this.turnId, dir: -1, steps: 1 });
        break;
      case "ArrowRight":
        net.send({ t: MsgType.MOVE, turnId: this.turnId, dir: 1, steps: 1 });
        break;
      case "ArrowUp":
        this.aimAngle = Math.min(89, this.aimAngle + 1);
        this.turretAngles[session.slot] = -(this.aimAngle * Math.PI) / 180;
        this.updateAimHud();
        break;
      case "ArrowDown":
        this.aimAngle = Math.max(0, this.aimAngle - 1);
        this.turretAngles[session.slot] = -(this.aimAngle * Math.PI) / 180;
        this.updateAimHud();
        break;
      case " ":
        e.preventDefault();
        net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower });
        break;
      case "Enter":
        net.send({ t: MsgType.END_TURN, turnId: this.turnId });
        break;
    }
  };

  private updateAimHud(): void {
    const aimEl = this.el.querySelector<HTMLElement>("#aim-indicator")!;
    aimEl.textContent = `角度 ${this.aimAngle}°  力度 ${this.aimPower}`;
  }

  private screenToWorld(cx: number, cy: number): Point {
    // 简化：世界坐标 = 屏幕坐标（镜头未缩放时）
    return { x: cx, y: cy };
  }

  // ---- 演出 ----

  private animateMove(slot: Slot, path: number[], moveLeft: number): void {
    // 注意：移动不设置 this.animating，否则会中断连续移动（触控按钮的 setInterval）。
    // 移动是「轻量」操作，可以连续触发；只有开火结算才用 animating 锁定输入。
    const tank = this.tanks[slot];
    // 同步服务端返回的权威移动力
    tank.moveLeft = moveLeft;
    if (path.length === 0) {
      // 移动被拒绝：移动力耗尽 or 撞墙/边缘/挡路
      if (moveLeft <= 0) {
        this.renderer.spawnFloatText(tank.x, tank.y - 40, "移动力耗尽", "#94a3b8");
      }
      this.updateHud();
      return;
    }
    // 直接跳到最终位置（简单可靠）
    tank.x = path[path.length - 1];
    tank.y = heightAt(this.heights, tank.x) - TANK_HALF_H;
    this.updateHud();
  }

  private animateFire(msg: Extract<ServerMessage, { t: typeof MsgType.FIRE_RESULT }>): void {
    this.animating = true;
    this.updateHud();
    const slot = msg.slot;
    const traj = msg.trajectory;
    this.turretAngles[slot] = -(msg.angle * Math.PI) / 180;

    // 播放炮弹飞行
    this.shell = { x: traj[0].x, y: traj[0].y, traj, idx: 0 };
    const flightTime = Math.min(3500, traj.length * 16); // 每点约 16ms
    const startTime = performance.now();

    const fly = () => {
      if (!this.shell) return;
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / flightTime);
      const idx = Math.floor(progress * (traj.length - 1));
      this.shell.idx = idx;
      this.shell.x = traj[idx].x;
      this.shell.y = traj[idx].y;
      if (progress >= 1) {
        // 命中
        this.shell = null;
        const power = msg.damage ? msg.damage / 30 : 0.5;
        this.renderer.spawnExplosion(msg.impact.x, msg.impact.y, power);
        this.renderer.triggerShake(clamp((msg.damage ?? 0) / 40, 3, 12));

        // 伤害飘字
        if (msg.damage && msg.hitSlot !== undefined) {
          const target = this.tanks[msg.hitSlot];
          this.renderer.spawnFloatText(target.x, target.y - 30, `-${msg.damage}`, msg.hitSlot === session.slot ? "#ef4444" : "#fbbf24");
        }

        // 应用地形与血量
        if (msg.crater) {
          applyCrater(this.heights, msg.crater.x, msg.crater.y, msg.crater.r);
        }
        this.tanks[0].hp = msg.newHp[0];
        this.tanks[1].hp = msg.newHp[1];
        for (const fall of msg.tankFall) {
          this.tanks[fall.slot].y = fall.toY;
          // 坠落伤害飘字
          if (fall.toY - fall.fromY > 80) {
            this.renderer.spawnFloatText(this.tanks[fall.slot].x, fall.toY - 30, "坠落！", "#f97316");
          }
        }
        this.updateHud();
        setTimeout(() => {
          this.animating = false;
          this.updateHud();
        }, 1200);
      } else {
        requestAnimationFrame(fly);
      }
    };
    requestAnimationFrame(fly);
  }

  // ---- 主循环 ----

  private loop = (time: number): void => {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;

    net.drain();

    // 逻辑像素（canvas 的 CSS 尺寸，即 window.innerWidth/innerHeight）
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    // 自适应缩放：屏幕越窄，zoom 越小（看到更多）
    this.renderer.zoom = clamp(viewW / 1200, 0.4, 1.2);

    // 镜头目标：炮弹 > 当前回合坦克
    if (this.shell) {
      this.renderer.setCameraTarget(this.shell.x, this.shell.y - 100);
    } else {
      const focus = this.tanks[this.currentSlot];
      this.renderer.setCameraTarget(focus.x, focus.y - 50);
    }

    this.renderer.updateCamera(dt, viewW, viewH);
    this.renderer.drawSky(viewW, viewH);
    this.renderer.drawTerrain(this.heights, viewW, viewH, this.renderer.zoom);

    // 坦克
    for (const slot of [0, 1] as Slot[]) {
      const t = this.tanks[slot];
      this.renderer.drawTank({
        x: t.x,
        y: t.y,
        facing: t.facing,
        turretAngle: this.turretAngles[slot],
        color: TANK_COLORS[slot],
      });
    }

    // 炮弹
    if (this.shell) {
      this.renderer.drawShell({ x: this.shell.x, y: this.shell.y });
    }

    this.renderer.updateParticles(dt);
    this.renderer.drawParticles();
    this.renderer.drawFloatTexts();

    // 倒计时条
    this.updateTimer();

    this.raf = requestAnimationFrame(this.loop);
  };

  private updateTimer(): void {
    const timerFill = this.el.querySelector<HTMLElement>("#timer-fill")!;
    if (this.deadline === 0) {
      timerFill.style.width = "0%";
      return;
    }
    const remain = this.deadline - (Date.now() + net.clockOffset);
    const total = TURN.TURN_SECONDS * 1000;
    const pct = clamp((remain / total) * 100, 0, 100);
    timerFill.style.width = pct + "%";
    timerFill.className = `timer-fill ${pct < 25 ? "urgent" : ""}`;
  }

  exit(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    this.unsub?.();
    this.el.classList.add("hidden");
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
