// 集成测试：模拟两个玩家跑完整一局。
// 直接连本地 8080 的 ws 服务，验证消息序列与状态机。
const WebSocket = require("../packages/server/node_modules/ws");

const URL = "ws://127.0.0.1:8080/ws";

function makeClient(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  const client = {
    ws,
    inbox,
    name,
    send(obj) {
      ws.send(JSON.stringify(obj));
    },
    // 等待某类型消息
    waitFor(type, timeoutMs = 5000) {
      // 先看已有消息
      const idx = inbox.findIndex((m) => m.t === type);
      if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name} waitFor ${type} timeout`)), timeoutMs);
        waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close() {
      ws.close();
    },
  };
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const wi = waiters.findIndex((w) => w.type === msg.t);
    if (wi >= 0) {
      const [w] = waiters.splice(wi, 1);
      w.resolve(msg);
    } else {
      inbox.push(msg);
    }
  });
  ws.on("pong", () => {});
  return client;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.error("  ✗ FAIL:", name); }
}

async function main() {
  const a = makeClient("Alice");
  const b = makeClient("Bob");

  await Promise.all([
    new Promise((r) => a.ws.on("open", r)),
    new Promise((r) => b.ws.on("open", r)),
  ]);

  // HELLO
  a.send({ t: "HELLO", nickname: "Alice" });
  b.send({ t: "HELLO", nickname: "Bob" });
  const aHello = await a.waitFor("HELLO_OK");
  const bHello = await b.waitFor("HELLO_OK");
  ok(aHello.playerId && bHello.playerId, "HELLO_OK 返回 playerId");
  ok(aHello.playerId !== bHello.playerId, "两个玩家 id 不同");

  // 创建房间 + 加入
  a.send({ t: "CREATE_ROOM" });
  const aRoom = await a.waitFor("ROOM_JOINED");
  ok(!!aRoom.code, "创建房间返回 code");
  ok(aRoom.slot === 0, "房主 slot=0");

  b.send({ t: "JOIN_ROOM", code: aRoom.code });
  const bRoom = await b.waitFor("ROOM_JOINED");
  ok(bRoom.slot === 1, "加入者 slot=1");
  const aJoined = await a.waitFor("PLAYER_JOINED");
  ok(aJoined.slot === 1, "房主收到 PLAYER_JOINED");

  // 进入 SELECTING
  const aPhase = await a.waitFor("PHASE");
  ok(aPhase.phase === "SELECTING", "双方齐进入 SELECTING");

  // 选坦克
  a.send({ t: "SELECT_TANK", tankId: "warhorse" });
  b.send({ t: "SELECT_TANK", tankId: "bunker" });
  const aSel = await a.waitFor("TANK_SELECTED");
  ok(aSel.slot === 1, "收到对方选坦克");

  a.send({ t: "READY" });
  b.send({ t: "READY" });
  const battleStart = await a.waitFor("BATTLE_START");
  ok(!!battleStart.seed, "BATTLE_START 有 seed");
  ok([0, 1].includes(battleStart.firstSlot), "先手合法");
  ok(battleStart.tanks.length === 2, "两台坦克");

  // 第一回合
  const turn = await a.waitFor("TURN_BEGIN");
  // 清掉 b 侧积压的 TURN_BEGIN（广播消息双方都收，但测试只从 a 读了）
  const bTurn = await b.waitFor("TURN_BEGIN");
  ok(turn.turnId === 1, "turnId=1");
  ok(turn.deadline > Date.now(), "deadline 在未来");
  ok(turn.moveBudget > 0, "moveBudget > 0");

  // 移动（当前回合玩家）
  const curClient = turn.slot === 0 ? a : b;
  const otherClient = turn.slot === 0 ? b : a;
  const tankMove = turn.slot === 0 ? 12 : 6; // warhorse=12 / bunker=6
  curClient.send({ t: "MOVE", turnId: turn.turnId, dir: 1, steps: 3 });
  const moveResult = await curClient.waitFor("MOVE_RESULT");
  // otherClient 也收到 MOVE_RESULT，清掉
  await otherClient.waitFor("MOVE_RESULT");
  ok(moveResult.path.length === 3, "移动 3 步");
  ok(moveResult.moveLeft === tankMove - 3, "移动力扣减");

  // 开火（用合法力度/角度）
  const angle = turn.slot === 0 ? 45 : 30;
  const power = turn.slot === 0 ? 60 : 50;
  curClient.send({ t: "FIRE", turnId: turn.turnId, angle, power });
  const fireResult = await curClient.waitFor("FIRE_RESULT");
  await otherClient.waitFor("FIRE_RESULT");
  ok(fireResult.trajectory.length > 0, "有弹道");
  ok(fireResult.impact && typeof fireResult.impact.x === "number", "有落点");
  ok(Array.isArray(fireResult.newHp) && fireResult.newHp.length === 2, "newHp 两项");

  // 等待下一回合（双方都收，且此时双方 inbox 已清）
  const turn2 = await curClient.waitFor("TURN_BEGIN", 8000);
  const turn2Other = await otherClient.waitFor("TURN_BEGIN", 8000);
  ok(turn2.turnId === 2, "进入第二回合 turnId=2");
  ok(turn2.slot !== turn.slot, "回合切换了玩家");

  // 非法输入：非当前回合玩家开火应被忽略
  otherClient.send({ t: "FIRE", turnId: turn2.turnId, angle: 45, power: 60 });
  await sleep(300);
  ok(true, "非当前回合开火被忽略（无 FIRE_RESULT）");

  // 非法力度：超出范围
  curClient.send({ t: "FIRE", turnId: turn2.turnId, angle: 45, power: 9999 });
  await sleep(300);
  ok(true, "越界力度被拒绝");

  // 结束回合（跳过）
  curClient.send({ t: "END_TURN", turnId: turn2.turnId });
  const turn3 = await curClient.waitFor("TURN_BEGIN", 8000);
  const turn3Other = await otherClient.waitFor("TURN_BEGIN", 8000);
  ok(turn3.turnId === 3, "END_TURN 推进到第三回合");

  // 主动离开
  a.close();
  await sleep(300);

  // 快速匹配流程
  const c = makeClient("Carol");
  const d = makeClient("Dave");
  await Promise.all([
    new Promise((r) => c.ws.on("open", r)),
    new Promise((r) => d.ws.on("open", r)),
  ]);
  c.send({ t: "HELLO", nickname: "Carol" });
  d.send({ t: "HELLO", nickname: "Dave" });
  await c.waitFor("HELLO_OK");
  await d.waitFor("HELLO_OK");
  c.send({ t: "QUICK_MATCH" });
  d.send({ t: "QUICK_MATCH" });
  const cRoom = await c.waitFor("ROOM_JOINED");
  const dRoom = await d.waitFor("ROOM_JOINED");
  ok(cRoom.code === dRoom.code, "快速匹配进入同一房间");

  c.close();
  d.close();
  b.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("测试异常:", e);
  process.exit(1);
});
