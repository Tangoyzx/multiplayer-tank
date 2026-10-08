import { MsgType } from "@tank/shared";
import { net } from "../net.js";
import { session, saveNickname } from "../session.js";
import { sceneManager, type Scene } from "./SceneManager.js";
import { toast } from "../ui.js";

export class LobbyScene implements Scene {
  private el!: HTMLElement;
  private unsub: (() => void) | null = null;

  enter(): void {
    this.el = document.getElementById("lobby")!;
    this.el.classList.remove("hidden");
    console.log("[Lobby] enter, connected=", net.connected);

    const nickInput = this.el.querySelector<HTMLInputElement>("#nickname")!;
    const createBtn = this.el.querySelector<HTMLButtonElement>("#create-btn")!;
    const joinBtn = this.el.querySelector<HTMLButtonElement>("#join-btn")!;
    const codeInput = this.el.querySelector<HTMLInputElement>("#room-code")!;
    const matchBtn = this.el.querySelector<HTMLButtonElement>("#match-btn")!;

    nickInput.value = session.nickname;
    console.log("[Lobby] nickname 初始值 =", JSON.stringify(session.nickname));

    const ensureNick = (): boolean => {
      const n = nickInput.value.trim();
      console.log("[Lobby] ensureNick: 输入框值 =", JSON.stringify(n), "connected =", net.connected);
      if (!n) {
        toast("请先输入昵称");
        return false;
      }
      saveNickname(n);
      if (!net.connected) {
        toast("正在连接服务器...");
        return false;
      }
      return true;
    };

    createBtn.onclick = () => {
      console.log("[Lobby] 点击了「创建房间」");
      if (!ensureNick()) return;
      console.log("[Lobby] 发送 CREATE_ROOM, nickname =", JSON.stringify(session.nickname));
      net.send({ t: MsgType.HELLO, nickname: session.nickname });
      net.send({ t: MsgType.CREATE_ROOM });
    };

    joinBtn.onclick = () => {
      console.log("[Lobby] 点击了「加入房间」");
      if (!ensureNick()) return;
      const code = codeInput.value.trim().toUpperCase();
      console.log("[Lobby] 房间码 =", JSON.stringify(code));
      if (!code) {
        toast("请输入房间码");
        return;
      }
      net.send({ t: MsgType.HELLO, nickname: session.nickname });
      net.send({ t: MsgType.JOIN_ROOM, code });
    };

    matchBtn.onclick = () => {
      console.log("[Lobby] 点击了「快速匹配」");
      if (!ensureNick()) return;
      net.send({ t: MsgType.HELLO, nickname: session.nickname });
      net.send({ t: MsgType.QUICK_MATCH });
      toast("正在寻找对手...");
    };

    // 监听消息
    this.unsub = net.on((msg) => {
      console.log("[Lobby] 收到消息:", msg.t);
      if (msg.t === MsgType.ROOM_JOINED) {
        session.roomCode = msg.code;
        session.slot = msg.slot;
        console.log("[Lobby] ROOM_JOINED, code =", msg.code, "slot =", msg.slot, "players =", msg.players.length);
        // 只有自己一人 → 等待对手；已满两人 → 选坦克
        if (msg.players.length < 2) {
          sceneManager.switchTo("waiting");
        } else {
          sceneManager.switchTo("select");
        }
      } else if (msg.t === MsgType.ERROR) {
        toast(msg.message);
      }
    });
  }

  exit(): void {
    this.unsub?.();
    this.el.classList.add("hidden");
  }
}
