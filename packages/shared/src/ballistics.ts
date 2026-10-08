import { PHYSICS, WORLD } from "./constants.js";
import { heightAt } from "./terrain.js";
import type { Point } from "./protocol.js";

export type { Point };

export interface TankBody {
  x: number; // 中心 x
  y: number; // 中心 y（地面顶端以上）
  halfW: number; // 半宽
  halfH: number; // 半高
}

export type TrajectoryResult =
  | { kind: "terrain"; impact: Point; trajectory: Point[]; steps: number }
  | { kind: "tank"; impact: Point; trajectory: Point[]; steps: number; slot: number }
  | { kind: "out_of_bounds"; trajectory: Point[]; steps: number }
  | { kind: "max_steps"; trajectory: Point[]; steps: number };

// 确定性弹道模拟。返回轨迹点数组（含落点）。
// facing: 1 = 朝右（向左射击为 -1），angle 为相对水平朝上的角度（度）。
// tanks 为双方坦克包围盒（用于命中判定），tankSlot 忽略哪个槽（发射方自身也参与判定，但通常会被跳过）。
export function simulate(
  heights: Float32Array,
  start: Point,
  angleDeg: number,
  power: number,
  facing: 1 | -1,
  tanks: TankBody[],
  skipSlot: number,
): TrajectoryResult {
  const angle = (angleDeg * Math.PI) / 180;
  const v0 = power * PHYSICS.POWER_SCALE;
  let vx = Math.cos(angle) * v0 * facing;
  let vy = -Math.sin(angle) * v0;

  let x = start.x;
  let y = start.y;

  const trajectory: Point[] = [{ x, y }];
  const maxSteps = PHYSICS.MAX_STEPS;

  for (let step = 1; step <= maxSteps; step++) {
    vy += PHYSICS.G * PHYSICS.DT;
    x += vx * PHYSICS.DT;
    y += vy * PHYSICS.DT;

    if (step % PHYSICS.SAMPLE_EVERY === 0) {
      trajectory.push({ x, y });
    }

    // 命中坦克（除发射方自身）
    for (let s = 0; s < tanks.length; s++) {
      if (s === skipSlot) continue;
      const t = tanks[s];
      if (
        x >= t.x - t.halfW &&
        x <= t.x + t.halfW &&
        y >= t.y - t.halfH &&
        y <= t.y + t.halfH
      ) {
        trajectory.push({ x, y });
        return { kind: "tank", impact: { x, y }, trajectory, steps: step, slot: s };
      }
    }

    // 出左右边界
    if (x < 0 || x > WORLD.WIDTH) {
      trajectory.push({ x, y });
      return { kind: "out_of_bounds", trajectory, steps: step };
    }

    // 撞地形（y 大于等于该处地面顶端）
    if (y >= heightAt(heights, x)) {
      const impact = refineImpact(heights, x, y, vx, vy);
      trajectory.push(impact);
      return { kind: "terrain", impact, trajectory, steps: step };
    }
  }

  return { kind: "max_steps", trajectory, steps: maxSteps };
}

// 二分细化求精确落点
function refineImpact(
  heights: Float32Array,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Point {
  let cx = x;
  let cy = y;
  let cvx = vx;
  let cvy = vy;
  const sub = PHYSICS.DT / 2;
  for (let i = 0; i < 8; i++) {
    cvy += PHYSICS.G * sub;
    cx += cvx * sub;
    cy += cvy * sub;
    if (cy >= heightAt(heights, cx)) {
      // 越过地形，保留该点
    }
  }
  // 最终把落点吸附到地形表面，避免悬浮/穿模
  return { x: cx, y: heightAt(heights, cx) };
}
