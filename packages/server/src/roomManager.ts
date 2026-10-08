import { NET } from "@tank/shared";
import { Room } from "./room.js";
import type { Player } from "./player.js";
import { log } from "./log.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉 0/O/1/I/L

export class RoomManager {
  private rooms = new Map<string, Room>(); // code -> room
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  generateCode(): string {
    let code = "";
    do {
      code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(p: Player): Room {
    const code = this.generateCode();
    const room = new Room(code, p);
    this.rooms.set(code, room);
    return room;
  }

  findByCode(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  // 查找玩家所在的房间
  findRoomOf(player: Player): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.hasPlayer(player)) return room;
    }
    return undefined;
  }

  removeRoom(room: Room): void {
    room.dispose();
    this.rooms.delete(room.code);
  }

  // 单 IP 房间数统计（用于限流）
  countRoomsByIp(ip: string): number {
    let n = 0;
    for (const room of this.rooms.values()) {
      if (room.slots.some((s) => s.player?.ip === ip)) n++;
    }
    return n;
  }

  startGC(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      for (const [code, room] of this.rooms) {
        if (room.isStale()) {
          this.removeRoom(room);
          log.info(`[gc] removed room ${code}`);
        }
      }
    }, NET.ROOM_GC_INTERVAL_MS);
  }

  stopGC(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  get stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.playerCount;
    return { rooms: this.rooms.size, players };
  }

  // 遍历所有房间（供心跳等扫描）
  forEachRoom(cb: (room: Room) => void): void {
    for (const room of this.rooms.values()) cb(room);
  }

  // 收集所有存活玩家（房间 + 匹配队列中的由调用方补充）
  collectPlayers(): Set<Player> {
    const set = new Set<Player>();
    for (const room of this.rooms.values()) {
      room.slots.forEach((s) => s.player && set.add(s.player));
    }
    return set;
  }

  // 优雅关闭：通知所有房间
  shutdown(): void {
    for (const room of this.rooms.values()) {
      room.dispose();
    }
    this.rooms.clear();
    this.stopGC();
  }
}
