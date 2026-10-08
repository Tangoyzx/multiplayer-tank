// 通信协议：所有消息的 TS 类型 + MsgType 常量。前后端共用。

export const MsgType = {
  // client -> server
  HELLO: "HELLO",
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  QUICK_MATCH: "QUICK_MATCH",
  CANCEL_MATCH: "CANCEL_MATCH",
  LEAVE_ROOM: "LEAVE_ROOM",
  SELECT_TANK: "SELECT_TANK",
  READY: "READY",
  MOVE: "MOVE",
  FIRE: "FIRE",
  END_TURN: "END_TURN",
  ANIM_DONE: "ANIM_DONE",
  REMATCH: "REMATCH",
  PONG: "PONG",
  // server -> client
  HELLO_OK: "HELLO_OK",
  ROOM_JOINED: "ROOM_JOINED",
  PLAYER_JOINED: "PLAYER_JOINED",
  PLAYER_LEFT: "PLAYER_LEFT",
  PHASE: "PHASE",
  TANK_SELECTED: "TANK_SELECTED",
  BATTLE_START: "BATTLE_START",
  TURN_BEGIN: "TURN_BEGIN",
  MOVE_RESULT: "MOVE_RESULT",
  FIRE_RESULT: "FIRE_RESULT",
  TURN_TIMEOUT: "TURN_TIMEOUT",
  STATE_SYNC: "STATE_SYNC",
  GAME_OVER: "GAME_OVER",
  OPPONENT_LEFT: "OPPONENT_LEFT",
  ERROR: "ERROR",
  PING: "PING",
  SERVER_SHUTDOWN: "SERVER_SHUTDOWN",
} as const;

export type MsgType = (typeof MsgType)[keyof typeof MsgType];

export type Phase =
  | "WAITING"
  | "SELECTING"
  | "COIN_TOSS"
  | "TURN"
  | "RESOLVING"
  | "GAME_OVER"
  | "CLOSED";

export type Slot = 0 | 1;

export interface Point {
  x: number;
  y: number;
}

export interface CraterDTO {
  x: number;
  y: number;
  r: number;
}

// ---- client -> server payloads ----

export interface HelloMsg {
  nickname: string;
}

export interface JoinRoomMsg {
  code: string;
}

export interface SelectTankMsg {
  tankId: string;
}

export interface MoveMsg {
  turnId: number;
  dir: -1 | 1;
  steps: number;
}

export interface FireMsg {
  turnId: number;
  angle: number;
  power: number;
}

export interface EndTurnMsg {
  turnId: number;
}

export interface AnimDoneMsg {
  turnId: number;
}

// ---- server -> client payloads ----

export interface PlayerInfo {
  slot: Slot;
  nickname: string;
  tankId?: string;
  ready?: boolean;
}

export interface HelloOkMsg {
  playerId: string;
  serverTime: number;
}

export interface RoomJoinedMsg {
  code: string;
  slot: Slot;
  players: PlayerInfo[];
}

export interface PlayerJoinedMsg {
  slot: Slot;
  nickname: string;
}

export interface PhaseMsg {
  phase: Phase;
}

export interface TankSelectedMsg {
  slot: Slot;
  tankId: string;
}

export interface SpawnInfo {
  x: number;
  y: number;
}

export interface BattleStartMsg {
  seed: number;
  terrainWidth: number;
  spawn: [SpawnInfo, SpawnInfo];
  tanks: [string, string];
  firstSlot: Slot;
}

export interface TurnBeginMsg {
  turnId: number;
  slot: Slot;
  deadline: number; // 服务端 Date.now() 基准的绝对时间戳
  moveBudget: number;
}

export interface MoveResultMsg {
  turnId: number;
  slot: Slot;
  path: number[]; // 走过的 x 序列
  moveLeft: number;
}

export interface TankFallDTO {
  slot: Slot;
  fromY: number;
  toY: number;
}

export interface FireResultMsg {
  turnId: number;
  slot: Slot;
  angle: number;
  power: number;
  trajectory: Point[];
  impact: Point;
  hitSlot?: Slot;
  damage?: number;
  crater?: CraterDTO;
  newHp: [number, number];
  tankFall: TankFallDTO[];
}

export interface TurnTimeoutMsg {
  turnId: number;
  slot: Slot;
}

export interface StateSyncMsg {
  phase: Phase;
  seed: number;
  craters: CraterDTO[];
  players: Array<{
    slot: Slot;
    nickname: string;
    tankId: string;
    hp: number;
    x: number;
    y: number;
    facing: 1 | -1;
    moveLeft: number;
    ready: boolean;
  }>;
  currentSlot: Slot;
  turnId: number;
  turnDeadline: number;
  roundIndex: number;
}

export interface GameOverMsg {
  winnerSlot: Slot;
  reason: "hp" | "disconnect" | "surrender" | "timeout";
}

export interface OpponentLeftMsg {
  graceMs: number;
}

export interface ErrorMsg {
  code: string;
  message: string;
}

export interface PingMsg {
  serverTime: number;
}

// ---- 统一信封 ----

export type ClientMessage =
  | { t: typeof MsgType.HELLO; nickname: string; playerId?: string }
  | { t: typeof MsgType.CREATE_ROOM }
  | { t: typeof MsgType.JOIN_ROOM; code: string }
  | { t: typeof MsgType.QUICK_MATCH }
  | { t: typeof MsgType.CANCEL_MATCH }
  | { t: typeof MsgType.LEAVE_ROOM }
  | { t: typeof MsgType.SELECT_TANK; tankId: string }
  | { t: typeof MsgType.READY }
  | { t: typeof MsgType.MOVE; turnId: number; dir: -1 | 1; steps: number }
  | { t: typeof MsgType.FIRE; turnId: number; angle: number; power: number }
  | { t: typeof MsgType.END_TURN; turnId: number }
  | { t: typeof MsgType.ANIM_DONE; turnId: number }
  | { t: typeof MsgType.REMATCH }
  | { t: typeof MsgType.PONG };

export type ServerMessage =
  | { t: typeof MsgType.HELLO_OK; playerId: string; serverTime: number }
  | { t: typeof MsgType.ROOM_JOINED; code: string; slot: Slot; players: PlayerInfo[] }
  | { t: typeof MsgType.PLAYER_JOINED; slot: Slot; nickname: string }
  | { t: typeof MsgType.PLAYER_LEFT; slot: Slot }
  | { t: typeof MsgType.PHASE; phase: Phase }
  | { t: typeof MsgType.TANK_SELECTED; slot: Slot; tankId: string }
  | { t: typeof MsgType.BATTLE_START } & BattleStartMsg
  | { t: typeof MsgType.TURN_BEGIN } & TurnBeginMsg
  | { t: typeof MsgType.MOVE_RESULT } & MoveResultMsg
  | { t: typeof MsgType.FIRE_RESULT } & FireResultMsg
  | { t: typeof MsgType.TURN_TIMEOUT } & TurnTimeoutMsg
  | { t: typeof MsgType.STATE_SYNC } & StateSyncMsg
  | { t: typeof MsgType.GAME_OVER } & GameOverMsg
  | { t: typeof MsgType.OPPONENT_LEFT; graceMs: number }
  | { t: typeof MsgType.ERROR; code: string; message: string }
  | { t: typeof MsgType.PING; serverTime: number }
  | { t: typeof MsgType.SERVER_SHUTDOWN };
