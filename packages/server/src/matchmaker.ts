import type { Player } from "./player.js";
import type { RoomManager } from "./roomManager.js";

// 快速匹配队列：等待中的玩家，凑够两人创建房间
export class Matchmaker {
  private queue: Player[] = [];

  enqueue(p: Player): void {
    // 已在队列则忽略
    if (this.queue.some((q) => q.id === p.id)) return;
    this.queue.push(p);
  }

  dequeue(p: Player): void {
    this.queue = this.queue.filter((q) => q.id !== p.id);
  }

  isQueued(p: Player): boolean {
    return this.queue.some((q) => q.id === p.id);
  }

  // 尝试配对：返回 null 表示继续等待，返回 Room 表示配对成功
  tryMatch(manager: RoomManager): ReturnType<RoomManager["createRoom"]> | null {
    // 移除已断开的玩家
    this.queue = this.queue.filter((q) => q.alive && q.ws);
    if (this.queue.length < 2) return null;
    const a = this.queue.shift()!;
    const b = this.queue.shift()!;
    // 双保险：两人都还活跃
    if (!a.alive || !b.alive || !a.ws || !b.ws) return null;
    const room = manager.createRoom(a);
    room.join(b);
    return room;
  }
}
