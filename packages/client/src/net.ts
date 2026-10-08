// WS 网络层：连接管理、重连退避、消息分发。
import { MsgType, type ClientMessage, type ServerMessage } from "@tank/shared";
import { log } from "./log.js";

type Handler = (msg: ServerMessage) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: ServerMessage[] = [];
  private reconnectDelay = 1000;
  private reconnectAttempts = 0;
  private manualClose = false;

  playerId = "";
  clockOffset = 0; // serverTime - localTime

  connect(): void {
    this.manualClose = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      log.info("[net] WebSocket 已连接", url);
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.onOpen();
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.t === MsgType.HELLO_OK) {
        this.playerId = msg.playerId;
        this.clockOffset = msg.serverTime - Date.now();
      }
      // 立即分发，而不是依赖 drain() 被外部循环调用
      // （否则在大厅/选坦克等没有主循环的场景，消息会永远堆积在队列里）
      this.queue.push(msg);
      this.drain();
    };

    ws.onclose = () => {
      log.info("[net] WebSocket 已关闭");
      this.ws = null;
      this.onClose();
      if (!this.manualClose) this.scheduleReconnect();
    };

    ws.onerror = () => {
      log.info("[net] WebSocket 出错");
      /* close 会触发 */
    };
  }

  private onOpen(): void {
    // 重连后重发 HELLO（昵称在 main 里维护，这里通过回调）
    this.dispatchOpen?.();
  }

  dispatchOpen: (() => void) | null = null;
  dispatchClose: (() => void) | null = null;

  private onClose(): void {
    this.dispatchClose?.();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // 在主循环帧边界消费消息队列
  drain(): void {
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!;
      for (const h of this.handlers) h(msg);
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const net = new Net();
