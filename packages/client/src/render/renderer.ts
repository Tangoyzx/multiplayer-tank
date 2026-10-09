// 战斗渲染：地形、坦克、炮弹、粒子
import { WORLD, COLS, type Point } from "@tank/shared";

export interface TankView {
  x: number;
  y: number;
  facing: 1 | -1;
  turretAngle: number; // 炮塔角度（弧度，向上为负）
  color: string;
}

export interface ShellView {
  x: number;
  y: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private camera = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  particles: Particle[] = [];
  floatTexts: FloatText[] = [];
  zoom = 1;
  shake = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  // 镜头目标（世界坐标）
  setCameraTarget(x: number, y: number): void {
    this.target = { x, y };
  }

  // 暴露镜头状态，供屏幕坐标 → 世界坐标换算（拖拽瞄准用）
  getCamera(): { x: number; y: number; zoom: number } {
    return { x: this.camera.x, y: this.camera.y, zoom: this.zoom };
  }

  updateCamera(dt: number, viewW: number, viewH: number): void {
    const lerp = Math.min(1, dt * 8);
    this.camera.x += (this.target.x - this.camera.x) * lerp;
    this.camera.y += (this.target.y - this.camera.y) * lerp;
    // 震屏衰减
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  triggerShake(intensity: number): void {
    this.shake = Math.max(this.shake, intensity);
  }

  private applyCamera(viewW: number, viewH: number, zoom: number): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    // 先重置到单位矩阵，用「设备像素」尺寸清屏（canvas 实际像素 = 逻辑像素 * dpr）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewW * dpr, viewH * dpr);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    // 世界坐标（逻辑像素）→ 设备像素：scale = zoom * dpr，偏移同样乘 dpr
    const scale = zoom * dpr;
    const cx = (viewW / 2 - this.camera.x * zoom + sx) * dpr;
    const cy = (viewH / 2 - this.camera.y * zoom + sy) * dpr;
    ctx.setTransform(scale, 0, 0, scale, cx, cy);
  }

  drawSky(viewW: number, viewH: number): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, viewH * dpr);
    grad.addColorStop(0, "#0ea5e9");
    grad.addColorStop(0.6, "#38bdf8");
    grad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW * dpr, viewH * dpr);
  }

  drawTerrain(heights: Float32Array, viewW: number, viewH: number, zoom: number): void {
    const ctx = this.ctx;
    this.applyCamera(viewW, viewH, zoom);
    const colStep = WORLD.COL_STEP;

    // 填充
    ctx.beginPath();
    ctx.moveTo(0, WORLD.HEIGHT);
    for (let i = 0; i < COLS; i++) {
      ctx.lineTo(i * colStep, heights[i]);
    }
    ctx.lineTo(WORLD.WIDTH, WORLD.HEIGHT);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 300, 0, WORLD.HEIGHT);
    grad.addColorStop(0, "#8b5a2b");
    grad.addColorStop(1, "#5c3a1e");
    ctx.fillStyle = grad;
    ctx.fill();

    // 顶部草色描边
    ctx.beginPath();
    for (let i = 0; i < COLS; i++) {
      const x = i * colStep;
      if (i === 0) ctx.moveTo(x, heights[i]);
      else ctx.lineTo(x, heights[i]);
    }
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  drawTank(tank: TankView): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(tank.x, tank.y);

    // 车体
    ctx.fillStyle = tank.color;
    ctx.fillRect(-20, -14, 40, 20);
    // 履带
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(-20, 4, 40, 10);
    // 车体细节
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(-20, -14, 40, 4);

    // 炮塔
    ctx.save();
    ctx.rotate(tank.turretAngle);
    ctx.fillStyle = shade(tank.color, -20);
    ctx.fillRect(0, -5, 34 * (tank.facing === 1 ? 1 : -1), 10);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(28 * (tank.facing === 1 ? 1 : -1), -5, 6, 10);
    ctx.restore();

    // 炮塔圆顶
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = shade(tank.color, -10);
    ctx.fill();

    ctx.restore();
  }

  drawShell(shell: ShellView): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shell.x, shell.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#1f2937";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(shell.x, shell.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
  }

  // 弹道预测线（发射前的虚线 + 落点标记）
  drawAimTrajectory(points: Point[], color: string): void {
    const ctx = this.ctx;
    if (points.length < 2) return;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    // 落点标记：圆圈 + 十字
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(last.x - r, last.y);
    ctx.lineTo(last.x + r, last.y);
    ctx.moveTo(last.x, last.y - r);
    ctx.lineTo(last.x, last.y + r);
    ctx.stroke();
    ctx.restore();
  }

  // 拖拽发射指示线（从坦克到手指/鼠标位置，愤怒小鸟式）
  drawDragIndicator(fromX: number, fromY: number, toX: number, toY: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fbbf24";
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.setLineDash([]);
    // 手指端圆点
    ctx.beginPath();
    ctx.arc(toX, toY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    ctx.restore();
  }

  spawnExplosion(x: number, y: number, power: number): void {
    const n = Math.round(20 + power * 0.5);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200 * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life: 0,
        maxLife: 0.8 + Math.random() * 0.8,
        size: 2 + Math.random() * 4,
        color: ["#fbbf24", "#f97316", "#ef4444", "#78350f"][Math.floor(Math.random() * 4)],
        gravity: 300,
      });
    }
  }

  spawnFloatText(x: number, y: number, text: string, color = "#ef4444"): void {
    this.floatTexts.push({ x, y, text, life: 0, maxLife: 0.8, color });
  }

  updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);

    for (const t of this.floatTexts) {
      t.life += dt;
      t.y -= 40 * dt;
    }
    this.floatTexts = this.floatTexts.filter((t) => t.life < t.maxLife);
  }

  drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawFloatTexts(): void {
    const ctx = this.ctx;
    for (const t of this.floatTexts) {
      const alpha = 1 - t.life / t.maxLife;
      ctx.globalAlpha = alpha;
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = t.color;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

function shade(hex: string, amt: number): string {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
