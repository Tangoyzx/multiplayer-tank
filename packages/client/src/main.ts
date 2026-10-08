import { net } from "./net.js";
import { sceneManager } from "./scenes/SceneManager.js";
import { LobbyScene } from "./scenes/Lobby.js";
import { SelectScene } from "./scenes/Select.js";
import { WaitingScene } from "./scenes/Waiting.js";
import { BattleScene } from "./scenes/Battle.js";
import { ResultScene } from "./scenes/Result.js";
import { session } from "./session.js";

// 注册场景
sceneManager.register("lobby", new LobbyScene());
sceneManager.register("select", new SelectScene());
sceneManager.register("waiting", new WaitingScene());
sceneManager.register("battle", new BattleScene());
sceneManager.register("result", new ResultScene());

// 网络连接 + 重连后重发 HELLO（带 playerId 以便复用身份）
net.dispatchOpen = () => {
  if (session.nickname) {
    let playerId: string | undefined;
    try {
      playerId = sessionStorage.getItem("tank_player_id") ?? undefined;
    } catch {
      playerId = undefined;
    }
    net.send({ t: "HELLO", nickname: session.nickname, playerId });
  }
};

net.connect();
sceneManager.switchTo("lobby");
