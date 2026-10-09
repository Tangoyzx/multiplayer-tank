import {
  MsgType,
  TURN,
  MOVE,
  WORLD,
  NET,
  TANK,
  generateHeights,
  heightAt,
  applyCrater,
  simulate,
  getTank,
  damageFor,
  selfDamage,
  fallDamage,
  craterRadius,
  clamp,
  mulberry32,
  type Slot,
  type Phase,
  type Crater,
  type Point,
  type ServerMessage,
  type TankBody,
} from "@tank/shared";
import type { Player } from "./player.js";

const TANK_HALF_W = TANK.HALF_W;
const TANK_HALF_H = TANK.HALF_H;
const SPAWN_X_LEFT = WORLD.WIDTH * 0.12;
const SPAWN_X_RIGHT = WORLD.WIDTH * 0.88;

export interface PlayerSlot {
  player: Player | null;
  nickname: string;
  tankId: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number; // 坦克中心 y
  facing: 1 | -1;
  moveLeft: number;
  ready: boolean;
  rematch: boolean;
  disconnectedAt: number | null;
}

interface FireResultInternal {
  turnId: number;
  slot: Slot;
  angle: number;
  power: number;
  trajectory: Point[];
  impact: Point;
  hitSlot?: Slot;
  damage?: number;
  crater?: Crater;
  newHp: [number, number];
  tankFall: Array<{ slot: Slot; fromY: number; toY: number }>;
}

let roomSeq = 0;

export class Room {
  readonly id: string;
  readonly code: string;
  phase: Phase = "WAITING";
  seed = 0;
  heights: Float32Array = new Float32Array(0);
  craters: Crater[] = [];
  slots: [PlayerSlot, PlayerSlot];
  currentSlot: Slot = 0;
  turnId = 0;
  turnDeadline = 0;
  roundIndex = 0;
  timeoutStrikes: [number, number] = [0, 0];
  readonly createdAt = Date.now();
  lastActiveAt = Date.now();
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimers: Array<ReturnType<typeof setTimeout> | null> = [null, null];

  constructor(code: string, p0: Player) {
    this.id = "room_" + ++roomSeq;
    this.code = code;
    this.slots = [this.emptySlot(p0, 0), this.emptySlot(null, 1)];
    this.slots[0].nickname = p0.nickname;
  }

  private emptySlot(player: Player | null, slot: Slot): PlayerSlot {
    return {
      player,
      nickname: "",
      tankId: "",
      hp: 0,
      maxHp: 0,
      x: slot === 0 ? SPAWN_X_LEFT : SPAWN_X_RIGHT,
      y: 0,
      facing: slot === 0 ? 1 : -1,
      moveLeft: 0,
      ready: false,
      rematch: false,
      disconnectedAt: null,
    };
  }

  // ---- 生命周期 ----

  get playerCount(): number {
    return this.slots.filter((s) => s.player).length;
  }

  get isFull(): boolean {
    return this.slots[0].player !== null && this.slots[1].player !== null;
  }

  slotOf(player: Player): Slot {
    return this.slots[0].player?.id === player.id ? 0 : 1;
  }

  hasPlayer(player: Player): boolean {
    return this.slots.some((s) => s.player?.id === player.id);
  }

  // 加入房间（第二个空位）
  join(p: Player): Slot | null {
    if (this.isFull) return null;
    const slot: Slot = this.slots[0].player === null ? 0 : 1;
    this.slots[slot].player = p;
    this.slots[slot].nickname = p.nickname;
    this.lastActiveAt = Date.now();
    if (this.isFull) this.enterSelecting();
    return slot;
  }

  private enterSelecting(): void {
    this.phase = "SELECTING";
    this.broadcast({ t: MsgType.PHASE, phase: "SELECTING" });
  }

  // 移除玩家；返回是否房间因此关闭
  removePlayer(p: Player): void {
    const slot = this.slotOf(p);
    if (this.slots[slot].player?.id !== p.id) return;
    this.slots[slot].player = null;
    this.slots[slot].nickname = "";
    this.slots[slot].ready = false;

    const other: Slot = slot === 0 ? 1 : 0;
    if (this.slots[other].player) {
      // 对局中断开：进入宽限
      if (this.phase === "TURN" || this.phase === "RESOLVING") {
        this.handleDisconnect(slot, other);
      } else {
        // 未开局：退回 WAITING
        this.phase = "WAITING";
        this.slots[other].player?.send({
          t: MsgType.PLAYER_LEFT,
          slot,
        });
        this.slots[other].player?.send({ t: MsgType.PHASE, phase: "WAITING" });
      }
    } else {
      this.phase = "CLOSED";
      this.clearTimers();
    }
  }

  // 对局中断线：保留 player 身份（不置 null），进入重连宽限。
  // 由 index.ts 的 ws.on("close") 调用。
  handleDisconnectPublic(p: Player): void {
    const slot = this.slotOf(p);
    if (this.slots[slot].player?.id !== p.id) return;
    this.handleDisconnect(slot, slot === 0 ? 1 : 0);
  }

  private handleDisconnect(disconnectedSlot: Slot, otherSlot: Slot): void {
    const other = this.slots[otherSlot];
    this.slots[disconnectedSlot].disconnectedAt = Date.now();
    other.player?.send({ t: MsgType.OPPONENT_LEFT, graceMs: NET.DISCONNECT_GRACE_MS });

    this.disconnectTimers[disconnectedSlot] = setTimeout(() => {
      // 宽限期结束，若断线玩家仍未重连（ws 仍为 null）→ 移除并判对方胜
      const p = this.slots[disconnectedSlot].player;
      if (p && p.ws === null) {
        this.slots[disconnectedSlot].player = null;
        this.slots[disconnectedSlot].nickname = "";
        this.finishGame(otherSlot, "disconnect");
      }
    }, NET.DISCONNECT_GRACE_MS);
  }

  // 断线玩家重连成功：清除宽限定时器，恢复标记
  markReconnected(p: Player): void {
    const slot = this.slotOf(p);
    if (this.slots[slot].player?.id !== p.id) return;
    this.slots[slot].disconnectedAt = null;
    if (this.disconnectTimers[slot]) {
      clearTimeout(this.disconnectTimers[slot]!);
      this.disconnectTimers[slot] = null;
    }
    // 通知对方玩家已回来
    const other: Slot = slot === 0 ? 1 : 0;
    this.slots[other].player?.send({ t: MsgType.PLAYER_JOINED, slot, nickname: p.nickname });
  }

  // 重新加入（预留：本版通过断线重连时调用）
  rejoin(p: Player): boolean {
    const emptySlot: Slot = this.slots[0].player === null ? 0 : 1;
    if (this.phase === "CLOSED" || this.phase === "GAME_OVER") return false;
    this.slots[emptySlot].player = p;
    this.slots[emptySlot].nickname = p.nickname;
    this.slots[emptySlot].disconnectedAt = null;
    if (this.disconnectTimers[emptySlot]) {
      clearTimeout(this.disconnectTimers[emptySlot]!);
      this.disconnectTimers[emptySlot] = null;
    }
    return true;
  }

  // ---- 选坦克 ----

  selectTank(p: Player, tankId: string): void {
    if (this.phase !== "SELECTING") return;
    const def = getTank(tankId);
    if (!def) return;
    const slot = this.slotOf(p);
    this.slots[slot].tankId = tankId;
    const other: Slot = slot === 0 ? 1 : 0;
    if (this.slots[other].player) {
      this.slots[other].player?.send({ t: MsgType.TANK_SELECTED, slot, tankId });
    }
  }

  ready(p: Player): void {
    if (this.phase !== "SELECTING") return;
    const slot = this.slotOf(p);
    this.slots[slot].ready = true;
    const other: Slot = slot === 0 ? 1 : 0;
    this.slots[other].player?.send({ t: MsgType.TANK_SELECTED, slot, tankId: this.slots[slot].tankId });

    if (this.slots[0].ready && this.slots[1].ready) this.startBattle();
  }

  private startBattle(): void {
    // 初始化坦克属性
    for (const slot of [0, 1] as Slot[]) {
      const def = getTank(this.slots[slot].tankId)!;
      this.slots[slot].hp = def.hp;
      this.slots[slot].maxHp = def.hp;
      this.slots[slot].moveLeft = def.move;
    }

    // 随机地形种子与先手
    const rng = mulberry32(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
    this.seed = Math.floor(rng() * 0xffffffff);
    this.craters = [];
    this.heights = generateHeights(this.seed);
    this.roundIndex = 0;
    this.timeoutStrikes = [0, 0];

    const firstSlot: Slot = Math.random() < 0.5 ? 0 : 1;
    this.currentSlot = firstSlot;

    // 放置坦克到出生点
    for (const slot of [0, 1] as Slot[]) {
      this.placeTank(slot);
    }

    this.phase = "COIN_TOSS";
    const spawn = [this.slots[0], this.slots[1]].map((s) => ({ x: s.x, y: s.y }));
    this.broadcast({
      t: MsgType.BATTLE_START,
      seed: this.seed,
      terrainWidth: WORLD.WIDTH,
      spawn: [spawn[0], spawn[1]],
      tanks: [this.slots[0].tankId, this.slots[1].tankId],
      firstSlot,
    });

    // 短暂延迟后开始第一回合
    setTimeout(() => this.beginTurn(), 800);
  }

  private placeTank(slot: Slot): void {
    const s = this.slots[slot];
    const groundY = heightAt(this.heights, s.x);
    s.y = groundY - TANK_HALF_H;
    s.facing = slot === 0 ? 1 : -1;
  }

  // ---- 回合 ----

  private beginTurn(): void {
    if (this.phase === "CLOSED" || this.phase === "GAME_OVER") return;
    this.phase = "TURN";
    this.turnId++;
    this.turnDeadline = Date.now() + TURN.TURN_SECONDS * 1000;
    const def = getTank(this.slots[this.currentSlot].tankId)!;
    this.slots[this.currentSlot].moveLeft = def.move;

    const cur = this.slots[this.currentSlot];
    this.broadcast({
      t: MsgType.TURN_BEGIN,
      turnId: this.turnId,
      slot: this.currentSlot,
      deadline: this.turnDeadline,
      moveBudget: cur.moveLeft,
    });

    // 回合超时定时器
    this.resolveTimer = setTimeout(() => this.onTurnTimeout(), TURN.TURN_SECONDS * 1000);
  }

  private onTurnTimeout(): void {
    if (this.phase !== "TURN") return;
    const slot = this.currentSlot;
    this.timeoutStrikes[slot]++;
    this.phase = "RESOLVING";
    this.broadcast({ t: MsgType.TURN_TIMEOUT, turnId: this.turnId, slot });

    if (this.timeoutStrikes[slot] >= TURN.TIMEOUT_STRIKE_LIMIT) {
      const other: Slot = slot === 0 ? 1 : 0;
      this.finishGame(other, "timeout");
    } else {
      this.advanceTurn();
    }
  }

  // ---- 移动 ----

  move(p: Player, turnId: number, dir: -1 | 1, steps: number): void {
    const slot = this.slotOf(p);
    // 非本回合 / 非当前操作者：静默忽略（不回复，避免干扰）
    if (this.phase !== "TURN") return;
    if (this.currentSlot !== slot) return;
    if (turnId !== this.turnId) return;
    const s = this.slots[this.currentSlot];

    // 移动力耗尽：回一个空 path 的 MOVE_RESULT，让客户端同步状态并提示
    if (s.moveLeft <= 0) {
      p.send({
        t: MsgType.MOVE_RESULT,
        turnId: this.turnId,
        slot: this.currentSlot,
        path: [],
        moveLeft: 0,
      });
      return;
    }

    steps = Math.min(steps, s.moveLeft);
    const path: number[] = [];
    let curX = s.x;

    for (let i = 0; i < steps; i++) {
      const nextX = curX + dir * MOVE.STEP_PX;
      if (nextX < MOVE.EDGE_MARGIN || nextX > WORLD.WIDTH - MOVE.EDGE_MARGIN) break;
      // 坡度限制
      const curGround = heightAt(this.heights, curX);
      const nextGround = heightAt(this.heights, nextX);
      if (nextGround - curGround > MOVE.MAX_SLOPE_PER_STEP) break;
      // 与对方坦克最小间距
      const other = this.slots[this.currentSlot === 0 ? 1 : 0];
      if (other.player && Math.abs(nextX - other.x) < MOVE.TANK_MIN_GAP) break;

      curX = nextX;
      s.x = curX;
      s.y = nextGround - TANK_HALF_H;
      s.moveLeft--;
      path.push(curX);
    }

    this.broadcast({
      t: MsgType.MOVE_RESULT,
      turnId: this.turnId,
      slot: this.currentSlot,
      path,
      moveLeft: s.moveLeft,
    });
  }

  // ---- 开火 ----

  fire(p: Player, turnId: number, angle: number, power: number): void {
    if (this.phase !== "TURN") return;
    if (this.currentSlot !== this.slotOf(p)) return;
    if (turnId !== this.turnId) return;

    const s = this.slots[this.currentSlot];
    const def = getTank(s.tankId)!;
    if (angle < def.angle[0] || angle > def.angle[1]) return;
    if (power < def.power[0] || power > def.power[1]) return;

    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }

    const result = this.resolveFire(angle, power);
    this.phase = "RESOLVING";
    this.broadcast({
      t: MsgType.FIRE_RESULT,
      turnId: this.turnId,
      slot: this.currentSlot,
      angle,
      power,
      trajectory: result.trajectory,
      impact: result.impact,
      hitSlot: result.hitSlot,
      damage: result.damage,
      crater: result.crater,
      newHp: result.newHp,
      tankFall: result.tankFall,
    });

    this.afterFire();
  }

  private resolveFire(angle: number, power: number): FireResultInternal {
    const slot = this.currentSlot;
    const s = this.slots[slot];
    const def = getTank(s.tankId)!;

    // 炮口位置
    const start: Point = {
      x: s.x + s.facing * (TANK_HALF_W - 4),
      y: s.y - 6,
    };

    const tanks: TankBody[] = [0, 1].map((i) => ({
      x: this.slots[i as Slot].x,
      y: this.slots[i as Slot].y,
      halfW: TANK_HALF_W,
      halfH: TANK_HALF_H,
    }));

    const result = simulate(this.heights, start, angle, power, s.facing, tanks, slot);

    let impact: Point;
    let hitSlot: Slot | undefined;
    let crater: Crater | undefined;

    if (result.kind === "terrain") {
      impact = result.impact;
      // 地形破坏
      const dmgAtImpact = def.atk; // 地形破坏量基于攻击力
      const r = craterRadius(dmgAtImpact);
      crater = { x: impact.x, y: impact.y, r };
      applyCrater(this.heights, impact.x, impact.y, r);
      this.craters.push(crater);
    } else if (result.kind === "tank") {
      impact = result.impact;
      hitSlot = result.slot as Slot;
    } else {
      // 出界 / max_steps：取轨迹末端
      impact = result.trajectory[result.trajectory.length - 1];
    }

    // 计算伤害
    let damage = 0;
    const hpBefore: [number, number] = [this.slots[0].hp, this.slots[1].hp];
    const tankFall: Array<{ slot: Slot; fromY: number; toY: number }> = [];

    if (hitSlot !== undefined) {
      const target = this.slots[hitSlot];
      const dist = Math.hypot(impact.x - target.x, impact.y - target.y);
      let dmg = damageFor(def.atk, dist, def.radius);
      if (hitSlot === slot) dmg = selfDamage(dmg); // 自伤
      damage = dmg;
      target.hp = Math.max(0, target.hp - dmg);
    }

    // 坠落：地形变化后重新吸附，计算下落
    for (const i of [0, 1] as Slot[]) {
      const t = this.slots[i];
      if (!t.player) continue;
      const groundY = heightAt(this.heights, t.x);
      const newY = groundY - TANK_HALF_H;
      const fall = newY - t.y;
      if (fall > 1) {
        const fdmg = fallDamage(fall);
        if (fdmg > 0) {
          t.hp = Math.max(0, t.hp - fdmg);
        }
        tankFall.push({ slot: i, fromY: t.y, toY: newY });
        t.y = newY;
      }
    }

    return {
      turnId: this.turnId,
      slot,
      angle,
      power,
      trajectory: result.trajectory,
      impact,
      hitSlot,
      damage: damage > 0 ? damage : undefined,
      crater,
      newHp: [this.slots[0].hp, this.slots[1].hp],
      tankFall,
    };
  }

  private afterFire(): void {
    // 判定胜负
    if (this.slots[0].hp <= 0 || this.slots[1].hp <= 0) {
      let winner: Slot;
      if (this.slots[0].hp <= 0 && this.slots[1].hp <= 0) {
        winner = this.currentSlot === 0 ? 1 : 0; // 自杀同归于尽：开火方负
      } else {
        winner = this.slots[0].hp <= 0 ? 1 : 0;
      }
      // 延迟进入结算，让演出播完
      setTimeout(() => this.finishGame(winner, "hp"), 2000);
      return;
    }

    // 推进回合
    this.advanceTurn();
  }

  private advanceTurn(): void {
    if (this.phase === "CLOSED" || this.phase === "GAME_OVER") return;
    this.currentSlot = this.currentSlot === 0 ? 1 : 0;
    this.roundIndex++;
    // 延迟进入下一回合，让 RESOLVING 演出有缓冲
    setTimeout(() => this.beginTurn(), 1500);
  }

  // 玩家主动跳过回合（END_TURN）
  endTurn(p: Player, turnId: number): void {
    if (this.phase !== "TURN") return;
    if (this.currentSlot !== this.slotOf(p)) return;
    if (turnId !== this.turnId) return;
    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }
    this.phase = "RESOLVING";
    this.advanceTurn();
  }

  // ---- 结算 ----

  private finishGame(winnerSlot: Slot, reason: "hp" | "disconnect" | "surrender" | "timeout"): void {
    if (this.phase === "GAME_OVER" || this.phase === "CLOSED") return;
    this.phase = "GAME_OVER";
    this.clearTimers();
    this.broadcast({ t: MsgType.GAME_OVER, winnerSlot, reason });
  }

  // 再来一局
  rematch(p: Player): void {
    if (this.phase !== "GAME_OVER") return;
    const slot = this.slotOf(p);
    this.slots[slot].rematch = true;
    if (this.slots[0].rematch && this.slots[1].rematch) {
      // 重置回选坦克
      for (const i of [0, 1] as Slot[]) {
        this.slots[i].ready = false;
        this.slots[i].rematch = false;
        this.slots[i].tankId = "";
        this.slots[i].hp = 0;
      }
      this.phase = "SELECTING";
      this.broadcast({ t: MsgType.PHASE, phase: "SELECTING" });
    }
  }

  // ---- 工具 ----

  broadcast(msg: ServerMessage): void {
    for (const s of this.slots) {
      s.player?.send(msg);
    }
  }

  sendTo(slot: Slot, msg: ServerMessage): void {
    this.slots[slot].player?.send(msg);
  }

  private clearTimers(): void {
    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }
    for (let i = 0; i < 2; i++) {
      if (this.disconnectTimers[i]) {
        clearTimeout(this.disconnectTimers[i]!);
        this.disconnectTimers[i] = null;
      }
    }
  }

  dispose(): void {
    this.clearTimers();
    this.phase = "CLOSED";
    this.slots[0].player = null;
    this.slots[1].player = null;
  }

  // 房间是否可回收
  isStale(): boolean {
    if (this.phase === "CLOSED") return true;
    if (this.playerCount === 0) return true;
    if (this.phase === "WAITING" && Date.now() - this.createdAt > NET.ROOM_WAITING_TTL_MS) return true;
    return false;
  }

  // 生成 STATE_SYNC 快照
  snapshot(): ServerMessage {
    return {
      t: MsgType.STATE_SYNC,
      phase: this.phase,
      seed: this.seed,
      craters: this.craters,
      players: [0, 1].map((i) => {
        const s = this.slots[i as Slot];
        return {
          slot: i as Slot,
          nickname: s.nickname,
          tankId: s.tankId,
          hp: s.hp,
          x: s.x,
          y: s.y,
          facing: s.facing,
          moveLeft: s.moveLeft,
          ready: s.ready,
        };
      }),
      currentSlot: this.currentSlot,
      turnId: this.turnId,
      turnDeadline: this.turnDeadline,
      roundIndex: this.roundIndex,
    };
  }
}
