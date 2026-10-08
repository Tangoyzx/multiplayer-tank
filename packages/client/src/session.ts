// 全局会话状态（跨场景共享）
import type { Slot } from "@tank/shared";

export interface SessionState {
  nickname: string;
  roomCode: string;
  slot: Slot;
  myTankId: string;
  oppTankId: string;
  selectedTankId: string;
  ready: boolean;
  // 战斗状态（由 Battle 场景填充）
  seed: number;
  firstSlot: Slot;
}

export const session: SessionState = {
  nickname: localStorage.getItem("tank_nickname") ?? "",
  roomCode: "",
  slot: 0,
  myTankId: "",
  oppTankId: "",
  selectedTankId: "",
  ready: false,
  seed: 0,
  firstSlot: 0,
};

export function saveNickname(n: string): void {
  session.nickname = n;
  localStorage.setItem("tank_nickname", n);
}
