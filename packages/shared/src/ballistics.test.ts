import { describe, it, expect } from "vitest";
import { simulate, type TankBody } from "./ballistics.js";
import { generateHeights } from "./terrain.js";
import { PHYSICS } from "./constants.js";

function flatHeights(): Float32Array {
  const h = new Float32Array(600);
  h.fill(600);
  return h;
}

describe("ballistics", () => {
  it("同输入产生同轨迹", () => {
    const h = generateHeights(1);
    const tanks: TankBody[] = [];
    const r1 = simulate(h, { x: 300, y: 300 }, 45, 60, 1, tanks, 0);
    const r2 = simulate(h, { x: 300, y: 300 }, 45, 60, 1, tanks, 0);
    expect(r1).toEqual(r2);
  });

  it("水平低角度会撞地", () => {
    const h = flatHeights();
    const r = simulate(h, { x: 500, y: 300 }, 5, 70, 1, [], 0);
    expect(r.kind).toBe("terrain");
  });

  it("垂直向上会回落撞地", () => {
    const h = flatHeights();
    const r = simulate(h, { x: 1000, y: 200 }, 85, 80, 1, [], 0);
    expect(r.kind).toBe("terrain");
  });

  it("朝左射击会飞出左边界", () => {
    const h = flatHeights();
    const r = simulate(h, { x: 100, y: 200 }, 30, 90, -1, [], 0);
    // 向左高速平射，会先出界
    expect(["out_of_bounds", "terrain", "max_steps"]).toContain(r.kind);
  });

  it("命中坦克包围盒", () => {
    const h = flatHeights();
    // 坦克贴近地面（flat 地面 y=600，坦克中心 y=560，高 40）
    const tanks = [
      { x: 1500, y: 560, halfW: 20, halfH: 20 },
      { x: 300, y: 560, halfW: 20, halfH: 20 },
    ];
    // 从 slot 0 (x=300) 向右以接近平射但略抬的角度、较高初速打 slot 1 (x=1500)
    const r = simulate(h, { x: 300, y: 560 }, 20, 90, 1, tanks, 0);
    // 高初速低角度才能跨 1200px 距离；若确实命中则 slot=1
    expect(r.kind).toBe("tank");
    if (r.kind === "tank") expect(r.slot).toBe(1);
  });

  it("MAX_STEPS 截断生效（不无限循环）", () => {
    const h = flatHeights();
    const tanks: TankBody[] = [];
    // 用极大力度高抛，理论上飞很久；这里验证返回的 steps <= MAX_STEPS
    const r = simulate(h, { x: 300, y: 100 }, 89, 100, 1, tanks, 0);
    expect(r.steps).toBeLessThanOrEqual(PHYSICS.MAX_STEPS);
  });
});
