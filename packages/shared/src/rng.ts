// mulberry32 确定性伪随机数生成器。
// 相同的 seed 产生完全相同的序列，用于让服务端与客户端可复算地形/弹道。

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 返回 [min, max) 内的随机浮点数
export function randRange(rng: RNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

// 返回 [min, max] 内的随机整数（含两端）
export function randInt(rng: RNG, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
