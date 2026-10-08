import { BLAST } from "./constants.js";

export interface TankDef {
  id: string;
  name: string;
  desc: string;
  hp: number; // 生命值
  atk: number; // 攻击力（基础伤害）
  move: number; // 每回合移动力（单位：移动步）
  angle: [number, number]; // 射击角度范围（度，向上为正）
  power: [number, number]; // 射击力度范围
  radius: number; // 爆炸半径系数
}

export const TANKS: TankDef[] = [
  {
    id: "warhorse",
    name: "战马",
    desc: "属性均衡的全能选手",
    hp: 100,
    atk: 25,
    move: 12,
    angle: [10, 80],
    power: [30, 80],
    radius: 1.0,
  },
  {
    id: "bunker",
    name: "堡垒",
    desc: "高血量、低机动的移动碉堡",
    hp: 140,
    atk: 20,
    move: 6,
    angle: [15, 70],
    power: [25, 70],
    radius: 1.1,
  },
  {
    id: "scout",
    name: "游骑",
    desc: "高机动、角度最广的斥候",
    hp: 80,
    atk: 18,
    move: 22,
    angle: [0, 85],
    power: [20, 90],
    radius: 0.9,
  },
  {
    id: "howitzer",
    name: "重炮",
    desc: "高伤害，但只能打大仰角",
    hp: 90,
    atk: 38,
    move: 8,
    angle: [35, 85],
    power: [45, 95],
    radius: 1.3,
  },
  {
    id: "sniper",
    name: "狙击",
    desc: "低平弹道，远程精准打击",
    hp: 85,
    atk: 30,
    move: 10,
    angle: [0, 45],
    power: [60, 100],
    radius: 1.0,
  },
];

export function getTank(id: string): TankDef | undefined {
  return TANKS.find((t) => t.id === id);
}

// 伤害衰减：dist 为命中点到坦克中心的距离
export function damageFor(atk: number, dist: number, radiusCoeff: number): number {
  const blastRadius = BLAST.BASE_RADIUS * radiusCoeff;
  if (dist > blastRadius) return 0;
  const falloff = Math.pow(clamp(1 - dist / blastRadius, 0, 1), BLAST.FALLOFF_EXP);
  let dmg = atk * falloff;
  if (dist < BLAST.DIRECT_HIT_DIST) dmg *= BLAST.DIRECT_HIT_MULT;
  return Math.round(dmg);
}

// 自伤（炸到自己）系数
export function selfDamage(dmg: number): number {
  return Math.round(dmg * BLAST.SELF_DAMAGE_MULT);
}

// 坠落伤害：fall 为下落距离
export function fallDamage(fall: number): number {
  if (fall <= BLAST.FALL_DAMAGE_THRESHOLD) return 0;
  const dmg = Math.floor((fall - BLAST.FALL_DAMAGE_THRESHOLD) / BLAST.FALL_DAMAGE_STEP);
  return Math.min(dmg, BLAST.FALL_DAMAGE_CAP);
}

// 命中点的坑半径
export function craterRadius(damage: number): number {
  return BLAST.BASE_RADIUS + damage * BLAST.DAMAGE_RADIUS_SCALE;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
