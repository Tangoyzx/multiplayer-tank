// 战斗主场景：接收指令、渲染、输入、演出编排
import {
  MsgType,
  WORLD,
  COLS,
  TURN,
  TANK,
  generateHeights,
  applyCrater,
  heightAt,
  simulate,
  TANKS,
  type ServerMessage,
  type Slot,
  type Point,
  type BattleStartMsg,
  type TankBody,
} from "@tank/shared";
import { net } from "../net.js";
import { session } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";
import { Renderer } from "../render/renderer.js";
import { log } from "../log.js";

const TANK_HALF_H = TANK.HALF_H;
const TANK_HALF_W = TANK.HALF_W;
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
  private aimFacing: 1 | -1 = 1; // 弹弓动态朝向（拖拽时根据手指在炮口左/右决定）
  private turretAngles: [number, number] = [0, 0];

  // 炮弹/演出
  private shell: { x: number; y: number; traj: Point[]; idx: number } | null = null;

  // 弹道预测线（发射前实时计算的轨迹点，无风环境）
  private aimTrajectory: Point[] | null = null;

  // 拖拽发射的指示线（从坦克到当前手指/鼠标位置）
  private dragIndicator: { toX: number; toY: number } | null = null;

  // 是否正在拖拽瞄准（供 loop 判断镜头效果）
  private dragging = false;

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
    // 初始化瞄准控件范围（基于我方坦克）
    this.syncAimControls();
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
        this.aimTrajectory = null;
        this.showTurnBanner(msg.slot);
        this.syncAimControls();
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
    // 同步瞄准朝向
    this.aimFacing = this.tanks[session.slot].facing;
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
        net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower, facing: this.aimFacing });
      }
    });

    // 弹弓式拖拽发射：锚点 = 坦克中心（世界坐标，拖拽期间镜头会动，必须用世界坐标锁定）
    // 发射方向 = 「手指 → 坦克」的延长线；facing 动态（手指在坦克左/右决定发射朝右/左）
    let anchorWX = 0; // 按下时锁定的坦克中心世界坐标
    let anchorWY = 0;

    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.myTurn || this.animating) {
        log.info("[drag] pointerdown 忽略: myTurn=", this.myTurn, "animating=", this.animating);
        return;
      }
      const me = this.tanks[session.slot];
      const p = this.screenToWorld(e.clientX, e.clientY);
      // 只有按在坦克附近（世界距离 60 单位，约 3 个车身宽）才开始拖拽
      const distToTank = Math.hypot(p.x - me.x, p.y - me.y);
      if (distToTank <= 60) {
        this.dragging = true;
        // 锁定坦克中心【世界坐标】（世界坐标不随镜头变化，是稳定的锚点）
        anchorWX = me.x;
        anchorWY = me.y;
        this.dragIndicator = { toX: p.x, toY: p.y };
        const cam = this.renderer.getCamera();
        log.info(
          "[drag] 按下:",
          "手指屏幕=(", e.clientX.toFixed(0), ",", e.clientY.toFixed(0), ")",
          "手指世界=(", p.x.toFixed(0), ",", p.y.toFixed(0), ")",
          "坦克世界=(", me.x.toFixed(0), ",", me.y.toFixed(0), ")",
          "镜头=(", cam.x.toFixed(0), ",", cam.y.toFixed(0), ") zoom=", cam.zoom.toFixed(2),
          "distToTank=", distToTank.toFixed(1),
          "初始facing=", this.aimFacing,
        );
        e.preventDefault();
      } else {
        log.info("[drag] 距离坦克过远，未开始拖拽");
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const me = this.tanks[session.slot];
      // 手指世界坐标（用当前镜头实时换算）
      const cur = this.screenToWorld(e.clientX, e.clientY);
      this.dragIndicator = { toX: cur.x, toY: cur.y };
      // 拉弓向量（世界坐标）：从手指指向坦克中心 = 发射方向
      const wx = anchorWX - cur.x;
      const wy = anchorWY - cur.y;
      const dist = Math.hypot(wx, wy);
      // 动态 facing：手指在坦克左边 → 发射朝右(facing=1)；右边 → 朝左(facing=-1)
      const newFacing: 1 | -1 = wx >= 0 ? 1 : -1;
      this.aimFacing = newFacing;
      // 仰角：向上分量（-wy，世界 y 向下，向上为负）比水平距离（绝对值）
      const absWx = Math.abs(wx);
      let angleRad: number;
      if (absWx < 1) {
        angleRad = Math.PI / 2; // 正上方/正下方 → 最大仰角
      } else {
        angleRad = Math.atan2(-wy, absWx);
      }
      const def = TANKS.find((t) => t.id === me.tankId);
      const [alo, ahi] = def ? def.angle : [0, 89];
      const [plo, phi] = def ? def.power : [20, 100];
      this.aimAngle = clamp(Math.round((angleRad * 180) / Math.PI), alo, ahi);
      // 力度：完全用【世界坐标】拉弓距离（dist），与镜头缩放无关。
      // 标定：拉弓 1500 世界单位 ≈ 满力度 100（约一个坦克间距的量级），映射到各坦克的 power 范围。
      this.aimPower = clamp(Math.round(dist / 15), plo, phi);
      this.updateTurretFromAim();
      this.updateAimHud();
      // 详细日志
      const cam = this.renderer.getCamera();
      log.info(
        "[drag] move:",
        "手指屏幕=(", e.clientX.toFixed(0), ",", e.clientY.toFixed(0), ")",
        "手指世界=(", cur.x.toFixed(0), ",", cur.y.toFixed(0), ")",
        "坦克世界=(", anchorWX.toFixed(0), ",", anchorWY.toFixed(0), ")",
        "镜头=(", cam.x.toFixed(0), ",", cam.y.toFixed(0), ") zoom=", cam.zoom.toFixed(2),
        "拉弓wx=", wx.toFixed(1), "wy=", wy.toFixed(1),
        "aimFacing=", this.aimFacing, "tankFacing=", this.tanks[session.slot].facing,
        "turretAngle=", (this.turretAngles[session.slot] * 180 / Math.PI).toFixed(1),
        "angle=", this.aimAngle, "power=", this.aimPower,
      );
    });

    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      // 松手发射：拉拽距离达到阈值才发射（世界距离阈值）
      const cur = this.screenToWorld(e.clientX, e.clientY);
      const wx = anchorWX - cur.x;
      const wy = anchorWY - cur.y;
      const dist = Math.hypot(wx, wy);
      this.dragIndicator = null;
      log.info("[drag] up: dist=", dist.toFixed(1), "facing=", this.aimFacing, "myTurn=", this.myTurn, "animating=", this.animating);
      if (dist >= 30 && this.myTurn && !this.animating) {
        log.info("[drag] 发射! facing=", this.aimFacing, "angle=", this.aimAngle, "power=", this.aimPower);
        net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower, facing: this.aimFacing });
      }
    });

    this.canvas.addEventListener("pointercancel", () => {
      log.info("[drag] pointercancel");
      this.dragging = false;
      this.dragIndicator = null;
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
      case "ArrowDown": {
        const me = this.tanks[session.slot];
        const def = TANKS.find((t) => t.id === me.tankId);
        const [lo, hi] = def ? def.angle : [0, 89];
        const delta = e.key === "ArrowUp" ? 1 : -1;
        this.aimAngle = clamp(this.aimAngle + delta, lo, hi);
        this.updateTurretFromAim();
        this.updateAimHud();
        break;
      }
      case " ":
        e.preventDefault();
        net.send({ t: MsgType.FIRE, turnId: this.turnId, angle: this.aimAngle, power: this.aimPower, facing: this.aimFacing });
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

  // 根据当前 aimAngle 更新炮管角度（含动态朝向）
  private updateTurretFromAim(): void {
    const angleRad = (this.aimAngle * Math.PI) / 180;
    this.turretAngles[session.slot] = -angleRad * (this.aimFacing === 1 ? 1 : -1);
    // 同步坦克朝向到渲染状态（炮管/车身跟随拖拽转身）
    this.tanks[session.slot].facing = this.aimFacing;
  }

  // 根据我方坦克的角度/力度范围，clamp 当前瞄准值到合法区间
  private syncAimControls(): void {
    const me = this.tanks[session.slot];
    const def = TANKS.find((t) => t.id === me.tankId);
    if (def) {
      this.aimAngle = clamp(this.aimAngle, def.angle[0], def.angle[1]);
      this.aimPower = clamp(this.aimPower, def.power[0], def.power[1]);
    }
    // 回合开始/重连时，瞄准朝向同步为坦克当前朝向
    this.aimFacing = me.facing;
    this.updateTurretFromAim();
    this.updateAimHud();
  }

  // 计算发射预测线（无风环境），与服务端 resolveFire 的入参保持一致
  private computeAimTrajectory(): void {
    // 仅在自己的回合、非结算动画、非炮弹飞行中才显示预测线
    if (!this.myTurn || this.animating || this.shell !== null) {
      this.aimTrajectory = null;
      return;
    }
    const me = this.tanks[session.slot];
    if (!me.tankId) {
      this.aimTrajectory = null;
      return;
    }
    // 炮口位置：用动态 aimFacing，与服务端 resolveFire 完全一致
    const start: Point = {
      x: me.x + this.aimFacing * (TANK_HALF_W - 4),
      y: me.y - 6,
    };
    // 双方坦克包围盒（用于命中判定）
    const tanks: TankBody[] = [0, 1].map((i) => {
      const t = this.tanks[i as Slot];
      return { x: t.x, y: t.y, halfW: TANK_HALF_W, halfH: TANK_HALF_H };
    });
    const result = simulate(
      this.heights,
      start,
      this.aimAngle,
      this.aimPower,
      this.aimFacing,
      tanks,
      session.slot,
    );
    this.aimTrajectory = result.trajectory;
  }

  private screenToWorld(cx: number, cy: number): Point {
    // 屏幕坐标（CSS 逻辑像素）→ 世界坐标，考虑镜头缩放与偏移
    const cam = this.renderer.getCamera();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    return {
      x: (cx - viewW / 2) / cam.zoom + cam.x,
      y: (cy - viewH / 2) / cam.zoom + cam.y,
    };
  }

  private worldToScreen(wx: number, wy: number): Point {
    // 世界坐标 → 屏幕坐标（CSS 逻辑像素），screenToWorld 的逆运算
    const cam = this.renderer.getCamera();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    return {
      x: (wx - cam.x) * cam.zoom + viewW / 2,
      y: (wy - cam.y) * cam.zoom + viewH / 2,
    };
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
    // 服务端下发了本次发射的实际朝向，同步到坦克状态
    const facing = msg.facing;
    this.tanks[slot].facing = facing;
    if (slot === session.slot) this.aimFacing = facing;
    // 炮管角度需考虑朝向
    const angleRad = (msg.angle * Math.PI) / 180;
    this.turretAngles[slot] = -angleRad * (facing === 1 ? 1 : -1);

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
          // 通知服务端动画播完，可以推进回合了
          net.send({ t: MsgType.ANIM_DONE, turnId: msg.turnId });
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

    // 基础缩放：屏幕越窄，zoom 越小（看到更多）
    const baseZoom = clamp(viewW / 1200, 0.4, 1.2);

    // 镜头目标：炮弹 > 拖拽瞄准（拉远看双方，留边距）> 当前回合坦克
    if (this.shell) {
      this.renderer.setZoomTarget(baseZoom);
      this.renderer.setCameraTarget(this.shell.x, this.shell.y - 100);
    } else if (this.dragging) {
      // 拖拽时：拉远 zoom，让双方坦克都落在屏幕 10%~90% 区间（留边距）
      // 锚点已是世界坐标，镜头缩放/移动不影响拉弓方向计算，可放心拉远
      const me = this.tanks[session.slot];
      const enemy = this.tanks[session.slot === 0 ? 1 : 0];
      const x0 = Math.min(me.x, enemy.x);
      const x1 = Math.max(me.x, enemy.x);
      const gap = Math.max(80, x1 - x0); // 至少 80，避免距离过近时 zoom 爆炸
      // 让两车占屏幕中间 80%（10%~90%），且不超过 baseZoom 的 2 倍（避免过糊）
      const fitZoom = clamp((viewW * 0.8) / gap, baseZoom * 0.5, baseZoom * 2.0);
      const targetX = (x0 + x1) / 2;
      const targetY = Math.min(me.y, enemy.y) - 60;
      this.renderer.setZoomTarget(fitZoom);
      this.renderer.setCameraTarget(targetX, targetY);
    } else {
      this.renderer.setZoomTarget(baseZoom);
      const focus = this.tanks[this.currentSlot];
      this.renderer.setCameraTarget(focus.x, focus.y - 50);
    }

    this.renderer.updateCamera(dt, viewW, viewH);
    this.renderer.drawSky(viewW, viewH);
    this.renderer.drawTerrain(this.heights, viewW, viewH, this.renderer.zoom);

    // 弹道预测线（发射前实时计算 + 绘制）
    this.computeAimTrajectory();
    if (this.aimTrajectory && this.aimTrajectory.length > 0) {
      this.renderer.drawAimTrajectory(this.aimTrajectory, TANK_COLORS[session.slot]);
    }

    // 拖拽发射指示线
    if (this.dragIndicator) {
      const me = this.tanks[session.slot];
      this.renderer.drawDragIndicator(me.x, me.y, this.dragIndicator.toX, this.dragIndicator.toY);
    }

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
