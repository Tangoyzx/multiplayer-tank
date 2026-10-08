import { describe, it, expect } from "vitest";
import { generateHeights, heightAt, applyCrater } from "./terrain.js";
import { COLS, WORLD, TERRAIN } from "./constants.js";

describe("terrain", () => {
  it("同 seed 生成结果一致", () => {
    const a = generateHeights(12345);
    const b = generateHeights(12345);
    expect(a).toEqual(b);
  });

  it("不同 seed 通常不同", () => {
    const a = generateHeights(1);
    const b = generateHeights(2);
    let diff = false;
    for (let i = 0; i < COLS; i++) {
      if (a[i] !== b[i]) {
        diff = true;
        break;
      }
    }
    expect(diff).toBe(true);
  });

  it("高度图无悬空（单值，且在钳制范围内）", () => {
    const h = generateHeights(42);
    const minY = WORLD.HEIGHT * TERRAIN.MIN_Y_RATIO;
    const maxY = WORLD.HEIGHT * TERRAIN.MAX_Y_RATIO;
    for (let i = 0; i < COLS; i++) {
      expect(Number.isFinite(h[i])).toBe(true);
      expect(h[i]).toBeGreaterThanOrEqual(minY);
      expect(h[i]).toBeLessThanOrEqual(maxY);
    }
  });

  it("出生点被整平且高度差 ≤120", () => {
    const h = generateHeights(7);
    const leftCx = Math.round((WORLD.WIDTH * TERRAIN.SPAWN_X_RATIO) / WORLD.COL_STEP);
    const rightCx = Math.round((WORLD.WIDTH * (1 - TERRAIN.SPAWN_X_RATIO)) / WORLD.COL_STEP);
    const half = Math.round(TERRAIN.SPAWN_FLAT_WIDTH / WORLD.COL_STEP / 2);

    for (let i = leftCx - half; i <= leftCx + half; i++) {
      expect(h[i]).toBe(h[leftCx]);
    }
    expect(Math.abs(h[rightCx] - h[leftCx])).toBeLessThanOrEqual(TERRAIN.SPAWN_MAX_DELTA);
  });

  it("挖坑只降低地面（y 只增不减）", () => {
    const h = generateHeights(99);
    const before = h.slice();
    applyCrater(h, 1200, 500, 60);
    for (let i = 0; i < COLS; i++) {
      expect(h[i]).toBeGreaterThanOrEqual(before[i]);
    }
  });

  it("heightAt 与列值一致", () => {
    const h = generateHeights(5);
    const x = 800;
    expect(heightAt(h, x)).toBe(h[Math.round(x / WORLD.COL_STEP)]);
  });
});
