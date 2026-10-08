import type WebSocket from "ws";
import { NET, MsgType, type ClientMessage, type ServerMessage } from "@tank/shared";

export interface ConnMeta {
  ip: string;
}

export class Player {
  readonly id: string;
  nickname = "";
  ws: WebSocket | null;
  readonly ip: string;

  alive = true;
  lastPongAt = Date.now();

  // 限流
  private msgTimes: number[] = [];

  constructor(id: string, ws: WebSocket, ip: string) {
    this.id = id;
    this.ws = ws;
    this.ip = ip;
  }

  send(msg: ServerMessage): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        /* 发送失败忽略 */
      }
    }
  }

  // 消息速率限制：返回 true 表示放行
  allowMessage(): boolean {
    const now = Date.now();
    this.msgTimes = this.msgTimes.filter((t) => now - t < 1000);
    if (this.msgTimes.length >= NET.MAX_MSGS_PER_SEC) return false;
    this.msgTimes.push(now);
    return true;
  }

  ping(): void {
    this.send({ t: MsgType.PING, serverTime: Date.now() });
  }

  // 判断是否心跳超时
  isHeartbeatTimeout(): boolean {
    return Date.now() - this.lastPongAt > NET.HEARTBEAT_TIMEOUT_MS;
  }
}
