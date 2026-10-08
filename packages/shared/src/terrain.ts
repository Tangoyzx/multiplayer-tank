import { COLS, WORLD, TERRAIN } from "./constants.js";
import { mulberry32, randRange, type RNG } from "./rng.js";

export interface Crater {
  x: number; // 圆心 x
  y: number; // 圆心 y
  r: number; // 半径
}

// 由 seed 生成单层高度图（Float32Array，长度 COLS）。
// 每个元素表示该列地面顶端的 y 坐标（向下为正，越大越低）。
export function generateHeights(seed: number): Float32Array {
  const rng = mulberry32(seed);
  const heights = new Float32Array(COLS);

  const base = WORLD.HEIGHT * randRange(rng, TERRAIN.BASE_MIN_RATIO, TERRAIN.BASE_MAX_RATIO);
  heights[0] = base;
  heights[COLS - 1] = base;

  // 中点位移法（递归分治，覆盖所有索引，任意长度安全）
  const displace = (left: number, right: number, amp: number): void => {
    const mid = (left + right) >> 1;
    if (mid === left || mid === right) return; // 段长已到 1
    heights[mid] = (heights[left] + heights[right]) / 2 + randRange(rng, -amp, amp);
    const nextAmp = amp * TERRAIN.AMP_DECAY;
    displace(left, mid, nextAmp);
    displace(mid, right, nextAmp);
  };
  displace(0, COLS - 1, TERRAIN.INIT_AMP);

  // 低幅正弦细节
  const phase = randRange(rng, 0, Math.PI * 2);
  const freq = randRange(rng, 0.008, 0.02);
  for (let i = 0; i < COLS; i++) {
    heights[i] += TERRAIN.SINE_AMP * Math.sin(i * freq + phase);
  }

  // 滑动平均平滑
  for (let p = 0; p < TERRAIN.SMOOTH_PASSES; p++) {
    const w = TERRAIN.SMOOTH_WINDOW;
    const half = (w - 1) >> 1;
    const tmp = heights.slice();
    for (let i = 0; i < COLS; i++) {
      let sum = 0;
      let n = 0;
      for (let j = i - half; j <= i + half; j++) {
        if (j >= 0 && j < COLS) {
          sum += tmp[j];
          n++;
        }
      }
      heights[i] = sum / n;
    }
  }

  // 钳制
  const minY = WORLD.HEIGHT * TERRAIN.MIN_Y_RATIO;
  const maxY = WORLD.HEIGHT * TERRAIN.MAX_Y_RATIO;
  for (let i = 0; i < COLS; i++) {
    heights[i] = clamp(heights[i], minY, maxY);
  }

  flattenSpawns(heights);
  return heights;
}

// 出生点整平 + 高度差约束
function flattenSpawns(heights: Float32Array): void {
  const leftCx = Math.round((WORLD.WIDTH * TERRAIN.SPAWN_X_RATIO) / WORLD.COL_STEP);
  const rightCx = Math.round((WORLD.WIDTH * (1 - TERRAIN.SPAWN_X_RATIO)) / WORLD.COL_STEP);
  const half = Math.round(TERRAIN.SPAWN_FLAT_WIDTH / WORLD.COL_STEP / 2);

  flattenAround(heights, leftCx, half);
  flattenAround(heights, rightCx, half);

  const leftY = heights[leftCx];
  const rightY = heights[rightCx];
  const delta = rightY - leftY;
  if (Math.abs(delta) > TERRAIN.SPAWN_MAX_DELTA) {
    // 整体微调：把较高的一侧往下压，减少高度差
    const target = delta > 0 ? rightY : leftY;
    const idx = delta > 0 ? rightCx : leftCx;
    const offset = Math.abs(delta) - TERRAIN.SPAWN_MAX_DELTA;
    for (let i = idx - half; i <= idx + half; i++) {
      if (i >= 0 && i < COLS) heights[i] += offset;
    }
  }
}

function flattenAround(heights: Float32Array, cx: number, half: number): void {
  const avg =
    (heights[cx - half] + heights[cx + half]) / 2;
  for (let i = cx - half; i <= cx + half; i++) {
    if (i >= 0 && i < COLS) heights[i] = avg;
  }
}

// 按列取地形高度（x 为世界坐标，返回该处地面顶端 y）
export function heightAt(heights: Float32Array, x: number): number {
  const col = clamp(Math.round(x / WORLD.COL_STEP), 0, COLS - 1);
  return heights[col];
}

// 在 (x, y) 处挖出一个半径 r 的圆坑（只降低地面，保持单层不变式）。
// 直接修改传入的 heights 并返回它。
export function applyCrater(heights: Float32Array, x: number, y: number, r: number): Float32Array {
  const r2 = r * r;
  const colMin = clamp(Math.floor((x - r) / WORLD.COL_STEP), 0, COLS - 1);
  const colMax = clamp(Math.ceil((x + r) / WORLD.COL_STEP), 0, COLS - 1);

  for (let i = colMin; i <= colMax; i++) {
    const cx = i * WORLD.COL_STEP + WORLD.COL_STEP / 2;
    const dx = cx - x;
    if (dx * dx > r2) continue;
    // 圆的底部（y 最大处）在这一列的深度
    const dy = Math.sqrt(r2 - dx * dx);
    const bottomY = y + dy;
    if (bottomY > heights[i]) heights[i] = bottomY;
  }
  return heights;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
