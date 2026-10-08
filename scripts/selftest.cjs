// 轻量自跑测试：不依赖 vitest（vitest 需要 fork worker + esbuild native service，沙箱下 EPERM）。
// 直接 require 编译后的 dist，单进程断言。
const {
  generateHeights,
  heightAt,
  applyCrater,
  simulate,
  damageFor,
  selfDamage,
  fallDamage,
  craterRadius,
  TANKS,
  getTank,
  mulberry32,
  COLS,
  WORLD,
  TERRAIN,
  PHYSICS,
  TURN,
} = require("../packages/shared/dist/index.js");

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("  FAIL:", name);
  }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

console.log("=== terrain ===");
{
  const a = generateHeights(12345);
  const b = generateHeights(12345);
  eq(a, b, "同 seed 一致");
  let diff = false;
  const c = generateHeights(1);
  for (let i = 0; i < COLS; i++) if (c[i] !== b[i]) { diff = true; break; }
  ok(diff, "不同 seed 不同");
  const h = generateHeights(42);
  const minY = WORLD.HEIGHT * TERRAIN.MIN_Y_RATIO;
  const maxY = WORLD.HEIGHT * TERRAIN.MAX_Y_RATIO;
  let inRange = true, finite = true;
  for (let i = 0; i < COLS; i++) {
    if (!Number.isFinite(h[i])) finite = false;
    if (h[i] < minY || h[i] > maxY) inRange = false;
  }
  ok(finite, "高度有限");
  ok(inRange, "高度在钳制范围内");
  const leftCx = Math.round((WORLD.WIDTH * TERRAIN.SPAWN_X_RATIO) / WORLD.COL_STEP);
  const rightCx = Math.round((WORLD.WIDTH * (1 - TERRAIN.SPAWN_X_RATIO)) / WORLD.COL_STEP);
  const half = Math.round(TERRAIN.SPAWN_FLAT_WIDTH / WORLD.COL_STEP / 2);
  let flat = true;
  for (let i = leftCx - half; i <= leftCx + half; i++) if (h[i] !== h[leftCx]) flat = false;
  ok(flat, "左出生点整平");
  ok(Math.abs(h[rightCx] - h[leftCx]) <= TERRAIN.SPAWN_MAX_DELTA, "出生点高度差 ≤120");
  const hh = generateHeights(99);
  const before = hh.slice();
  applyCrater(hh, 1200, 500, 60);
  let lowered = true;
  for (let i = 0; i < COLS; i++) if (hh[i] < before[i]) lowered = false;
  ok(lowered, "挖坑只降地面");
  eq(heightAt(hh, 800), hh[Math.round(800 / WORLD.COL_STEP)], "heightAt 一致");
}

console.log("=== ballistics ===");
{
  const h = generateHeights(1);
  const r1 = simulate(h, { x: 300, y: 300 }, 45, 60, 1, [], 0);
  const r2 = simulate(h, { x: 300, y: 300 }, 45, 60, 1, [], 0);
  eq(r1, r2, "同输入同轨迹");
  const flat = new Float32Array(COLS).fill(600);
  const rLow = simulate(flat, { x: 500, y: 300 }, 5, 70, 1, [], 0);
  eq(rLow.kind, "terrain", "低角度撞地");
  const rUp = simulate(flat, { x: 1000, y: 200 }, 85, 80, 1, [], 0);
  eq(rUp.kind, "terrain", "高抛回落撞地");
  const rTank = simulate(flat, { x: 300, y: 560 }, 20, 90, 1, [
    { x: 300, y: 560, halfW: 20, halfH: 20 },
    { x: 1500, y: 560, halfW: 20, halfH: 20 },
  ], 0);
  eq(rTank.kind, "tank", "命中坦克");
  if (rTank.kind === "tank") eq(rTank.slot, 1, "命中 slot 1");
  const rMax = simulate(flat, { x: 300, y: 100 }, 89, 100, 1, [], 0);
  ok(rMax.steps <= PHYSICS.MAX_STEPS, "MAX_STEPS 截断");
}

console.log("=== damage ===");
{
  ok(damageFor(100, 5, 1.0) > damageFor(100, 40, 1.0), "直击>远处");
  eq(damageFor(100, 58, 1.0), 0, "超半径外为 0");
  ok(damageFor(100, 5, 1.0) > damageFor(100, 12, 1.0), "直击加成");
  eq(selfDamage(100), 80, "自伤 0.8");
  eq(fallDamage(80), 0, "坠落阈值内 0");
  eq(fallDamage(92), 1, "坠落线性");
  eq(fallDamage(10000), 15, "坠落上限");
  ok(craterRadius(50) > craterRadius(10), "坑半径随伤害增");
  eq(TANKS.length, 5, "5 台坦克");
  eq(new Set(TANKS.map(t => t.id)).size, 5, "id 唯一");
  ok(TANKS.every(t => t.hp > 0 && t.atk > 0 && t.move > 0), "数值合法");
  ok(TANKS.every(t => getTank(t.id) === t), "getTank 可用");
  ok(TURN.TURN_SECONDS > 0, "TURN_SECONDS 为正");
}

console.log("=== rng ===");
{
  const a = mulberry32(123);
  const b = mulberry32(123);
  let same = true;
  for (let i = 0; i < 100; i++) if (a() !== b()) same = false;
  ok(same, "同 seed 同序列");
  const r = mulberry32(9);
  let range = true;
  for (let i = 0; i < 1000; i++) { const v = r(); if (v < 0 || v >= 1) range = false; }
  ok(range, "值域 [0,1)");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
