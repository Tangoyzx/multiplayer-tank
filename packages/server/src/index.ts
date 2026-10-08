import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { MsgType, NET, type ClientMessage } from "@tank/shared";
import { Player } from "./player.js";
import { RoomManager } from "./roomManager.js";
import { Matchmaker } from "./matchmaker.js";
import type { Room } from "./room.js";
import { log } from "./log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = path.resolve(__dirname, "../../client/dist");

const manager = new RoomManager();
const matchmaker = new Matchmaker();
let playerSeq = 0;

// ---- 静态文件服务 ----

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(STATIC_DIR, path.normalize(urlPath));
  // 防目录穿越
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
    };
    // HTML 不缓存；带 hash 的资源长缓存
    if (ext === ".html") {
      headers["Cache-Control"] = "no-cache";
    } else {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ---- HTTP 服务器 ----

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const s = manager.stats;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: s.rooms, players: s.players }));
    return;
  }
  serveStatic(req, res);
});

// ---- WebSocket 服务器 ----

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: NET.MAX_MESSAGE_BYTES });

wss.on("connection", (ws, req) => {
  const ip = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  const player = new Player("p_" + ++playerSeq, ws, ip);
  log.info(`[server] WS 连接建立: player=${player.id} ip=${ip}`);

  ws.on("message", (raw) => {
    log.info(`[server] 收到消息: player=${player.id} raw=${raw.toString()}`);
    if (!player.allowMessage()) {
      log.info(`[server] 限流拒绝: player=${player.id}`);
      ws.close(1008, "rate limited");
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      log.info(`[server] JSON 解析失败: player=${player.id} err=${(e as Error).message}`);
      ws.close(1003, "invalid json");
      return;
    }
    handleMessage(player, msg);
  });

  ws.on("close", () => {
    log.info(`[server] WS 连接关闭: player=${player.id}`);
    player.alive = false;
    player.ws = null;
    matchmaker.dequeue(player);
    const room = manager.findRoomOf(player);
    if (room) {
      room.removePlayer(player);
      if (room.phase === "CLOSED") manager.removeRoom(room);
    }
  });

  ws.on("error", (e) => {
    log.info(`[server] WS 错误: player=${player.id} err=${(e as Error).message}`);
  });
});

// ---- 消息处理 ----

function handleMessage(player: Player, msg: ClientMessage): void {
  log.info(`[server] handleMessage: player=${player.id} t=${msg.t}`);
  switch (msg.t) {
    case MsgType.HELLO: {
      const nickname = String(msg.nickname ?? "").slice(0, 24).trim() || "玩家";
      player.nickname = nickname;
      log.info(`[server] HELLO: player=${player.id} nickname=${nickname}`);
      player.send({ t: MsgType.HELLO_OK, playerId: player.id, serverTime: Date.now() });
      break;
    }
    case MsgType.CREATE_ROOM: {
      log.info(`[server] CREATE_ROOM: player=${player.id} nickname=${JSON.stringify(player.nickname)}`);
      if (!player.nickname) {
        log.info(`[server] CREATE_ROOM 拒绝: nickname 为空`);
        break;
      }
      // IP 限流
      if (manager.countRoomsByIp(player.ip) >= NET.MAX_ROOMS_PER_IP) {
        log.info(`[server] CREATE_ROOM 拒绝: IP 房间数过多`);
        player.send({ t: MsgType.ERROR, code: "TOO_MANY_ROOMS", message: "房间数过多" });
        break;
      }
      const existing = manager.findRoomOf(player);
      if (existing) {
        log.info(`[server] CREATE_ROOM 拒绝: 已在一个房间`);
        break; // 已在一个房间
      }
      const room = manager.createRoom(player);
      log.info(`[server] CREATE_ROOM 成功: player=${player.id} code=${room.code}`);
      player.send({
        t: MsgType.ROOM_JOINED,
        code: room.code,
        slot: 0,
        players: roomInfo(room),
      });
      break;
    }
    case MsgType.JOIN_ROOM: {
      if (!player.nickname) break;
      if (manager.findRoomOf(player)) break;
      const room = manager.findByCode(msg.code);
      if (!room) {
        player.send({ t: MsgType.ERROR, code: "ROOM_NOT_FOUND", message: "房间不存在" });
        break;
      }
      const slot = room.join(player);
      if (slot === null) {
        player.send({ t: MsgType.ERROR, code: "ROOM_FULL", message: "房间已满" });
        break;
      }
      player.send({ t: MsgType.ROOM_JOINED, code: room.code, slot, players: roomInfo(room) });
      room.broadcast({ t: MsgType.PLAYER_JOINED, slot, nickname: player.nickname });
      break;
    }
    case MsgType.QUICK_MATCH: {
      if (!player.nickname) break;
      if (manager.findRoomOf(player)) break;
      matchmaker.enqueue(player);
      const room = matchmaker.tryMatch(manager);
      if (room) {
        // 两个玩家都被配对了
        room.slots.forEach((s, i) => {
          s.player?.send({
            t: MsgType.ROOM_JOINED,
            code: room.code,
            slot: i as 0 | 1,
            players: roomInfo(room),
          });
        });
        room.broadcast({
          t: MsgType.PLAYER_JOINED,
          slot: 1,
          nickname: room.slots[1].nickname,
        });
      }
      break;
    }
    case MsgType.CANCEL_MATCH: {
      matchmaker.dequeue(player);
      break;
    }
    case MsgType.LEAVE_ROOM: {
      const room = manager.findRoomOf(player);
      if (room) {
        room.removePlayer(player);
        if (room.phase === "CLOSED") manager.removeRoom(room);
      }
      break;
    }
    case MsgType.SELECT_TANK: {
      const room = manager.findRoomOf(player);
      room?.selectTank(player, msg.tankId);
      break;
    }
    case MsgType.READY: {
      const room = manager.findRoomOf(player);
      room?.ready(player);
      break;
    }
    case MsgType.MOVE: {
      const room = manager.findRoomOf(player);
      room?.move(player, msg.turnId, msg.dir, msg.steps);
      break;
    }
    case MsgType.FIRE: {
      const room = manager.findRoomOf(player);
      room?.fire(player, msg.turnId, msg.angle, msg.power);
      break;
    }
    case MsgType.END_TURN: {
      const room = manager.findRoomOf(player);
      room?.endTurn(player, msg.turnId);
      break;
    }
    case MsgType.ANIM_DONE: {
      // 本版依赖定时器推进，ANIM_DONE 仅预留
      break;
    }
    case MsgType.REMATCH: {
      const room = manager.findRoomOf(player);
      room?.rematch(player);
      break;
    }
    case MsgType.PONG: {
      player.lastPongAt = Date.now();
      break;
    }
    default:
      break;
  }
}

function roomInfo(room: Room) {
  return room.slots
    .filter((s) => s.player)
    .map((s) => ({
      slot: room.slotOf(s.player!),
      nickname: s.nickname,
      tankId: s.tankId || undefined,
      ready: s.ready,
    }));
}

// ---- 心跳 ----

setInterval(() => {
  const players = manager.collectPlayers();
  for (const player of players) {
    player.ping();
    if (player.isHeartbeatTimeout()) {
      player.ws?.close(1001, "heartbeat timeout");
    }
  }
}, NET.HEARTBEAT_INTERVAL_MS);

// ---- 启动 ----

manager.startGC();
server.listen(PORT, () => {
  log.info(`[server] listening on http://0.0.0.0:${PORT}`);
  log.info(`[server] static dir: ${STATIC_DIR}`);
});

// 优雅关闭
function shutdown(): void {
  log.info("[server] shutting down...");
  wss.clients.forEach((c) => {
    try {
      c.send(JSON.stringify({ t: MsgType.SERVER_SHUTDOWN }));
    } catch {
      /* ignore */
    }
  });
  setTimeout(() => {
    manager.shutdown();
    server.close(() => process.exit(0));
  }, 2000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
