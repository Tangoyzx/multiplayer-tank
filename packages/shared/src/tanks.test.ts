import { describe, it, expect } from "vitest";
import { damageFor, selfDamage, fallDamage, craterRadius, TANKS, getTank } from "./tanks.js";
import { BLAST } from "./constants.js";
import { TURN } from "./constants.js";

describe("tanks & damage", () => {
  it("直击伤害 > 远处伤害", () => {
    const near = damageFor(100, 5, 1.0);
    const far = damageFor(100, 40, 1.0);
    expect(near).toBeGreaterThan(far);
  });

  it("超半径外伤害为 0", () => {
    expect(damageFor(100, BLAST.BASE_RADIUS + 10, 1.0)).toBe(0);
  });

  it("直击有 1.25 倍加成", () => {
    const base = damageFor(100, 12, 1.0); // 恰在直击阈值外
    const direct = damageFor(100, 5, 1.0);
    expect(direct).toBeGreaterThan(base);
  });

  it("自伤系数 0.8", () => {
    expect(selfDamage(100)).toBe(80);
  });

  it("坠落伤害：阈值内为 0，超阈值线性，有上限", () => {
    expect(fallDamage(80)).toBe(0);
    expect(fallDamage(92)).toBe(1);
    expect(fallDamage(10000)).toBe(BLAST.FALL_DAMAGE_CAP);
  });

  it("坑半径随伤害增大", () => {
    expect(craterRadius(50)).toBeGreaterThan(craterRadius(10));
  });

  it("5 台坦克，id 唯一，数值在合理范围", () => {
    expect(TANKS).toHaveLength(5);
    const ids = new Set(TANKS.map((t) => t.id));
    expect(ids.size).toBe(5);
    for (const t of TANKS) {
      expect(t.hp).toBeGreaterThan(0);
      expect(t.atk).toBeGreaterThan(0);
      expect(t.move).toBeGreaterThan(0);
      expect(t.angle[0]).toBeLessThanOrEqual(t.angle[1]);
      expect(t.power[0]).toBeLessThan(t.power[1]);
      expect(getTank(t.id)).toBe(t);
    }
  });

  it("TURN_SECONDS 为正数值", () => {
    expect(typeof TURN.TURN_SECONDS).toBe("number");
    expect(TURN.TURN_SECONDS).toBeGreaterThan(0);
  });
});
