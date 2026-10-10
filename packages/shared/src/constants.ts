// 全局规则 / 物理 / 场地常量 —— 唯一权威来源。
// 服务端读取这些值计算 deadline 与校验输入；客户端只消费服务端下发的数据，不硬编码。

export const WORLD = {
  WIDTH: 2400, // 逻辑世界宽度（px）
  HEIGHT: 900, // 逻辑世界高度（px）
  COL_STEP: 4, // 每列宽度（px）
} as const;

export const COLS = WORLD.WIDTH / WORLD.COL_STEP; // 600

export const TERRAIN = {
  BASE_MIN_RATIO: 0.55, // 基准高度占世界高比例下限
  BASE_MAX_RATIO: 0.72, // 上限
  INIT_AMP: 160, // 中点位移初始幅度
  AMP_DECAY: 0.55, // 每层幅度衰减
  OCTAVES: 9, // 中点位移细分层数
  SINE_AMP: 18, // 细节正弦幅度
  SMOOTH_PASSES: 3, // 滑动平均次数
  SMOOTH_WINDOW: 5, // 滑动平均窗口
  MIN_Y_RATIO: 0.35, // 地形最低（y 最大）限制
  MAX_Y_RATIO: 0.92,
  SPAWN_FLAT_WIDTH: 48, // 出生点整平宽度
  SPAWN_X_RATIO: 0.12, // 出生点距左/右的比例
  SPAWN_MAX_DELTA: 120, // 两出生点允许最大高度差
} as const;

export const PHYSICS = {
  G: 180, // 重力加速度（逻辑 px/s^2）
  DT: 1 / 120, // 弹道固定时间步长
  // 力度 → 初速度 换算。
  // 标定：中等力度坦克（战马，满力 80）在 45° 最佳射角的射程 ≈ 1680（约 70% 地图宽 2400）。
  // 推导：range = (power*POWER_SCALE)^2 / G → POWER_SCALE = sqrt(1680*180)/80 ≈ 6.874。
  POWER_SCALE: 6.875,
  MAX_STEPS: 2400, // 弹道硬截断步数
  SAMPLE_EVERY: 4, // 每 N 步采样一个轨迹点
} as const;

export const BLAST = {
  BASE_RADIUS: 48, // 爆炸半径基数
  DAMAGE_RADIUS_SCALE: 0.4, // 伤害对坑半径的加成
  FALLOFF_EXP: 0.6, // 伤害衰减指数
  DIRECT_HIT_DIST: 12, // 判定为直击的距离
  DIRECT_HIT_MULT: 1.25, // 直击伤害倍率
  SELF_DAMAGE_MULT: 0.8, // 自伤系数
  FALL_DAMAGE_THRESHOLD: 80, // 坠落免伤高度
  FALL_DAMAGE_STEP: 12, // 每超阈值多少 px 扣 1
  FALL_DAMAGE_CAP: 15, // 坠落伤害上限
} as const;

export const MOVE = {
  STEP_PX: 8, // 每步水平位移
  MAX_SLOPE_PER_STEP: 14, // 单步允许的最大地形上升
  TANK_MIN_GAP: 24, // 坦克最小间距
  EDGE_MARGIN: 16, // 坦克距离场地边缘的最小 x
} as const;

// 坦克碰撞/渲染半宽半高（服务端与客户端必须一致，用于弹道命中判定与预测线）
export const TANK = {
  HALF_W: 20,
  HALF_H: 20,
} as const;

export const TURN = {
  TURN_SECONDS: 120, // 回合时长（秒），暂定 120，可配置
  TIMEOUT_STRIKE_LIMIT: 2, // 连续超时判负次数
} as const;

export const NET = {
  HEARTBEAT_INTERVAL_MS: 15000,
  HEARTBEAT_TIMEOUT_MS: 45000,
  DISCONNECT_GRACE_MS: 20000,
  ROOM_GC_INTERVAL_MS: 30000,
  ROOM_WAITING_TTL_MS: 10 * 60 * 1000,
  RESOLVE_EXTRA_MS: 1500,
  MAX_MESSAGE_BYTES: 4096,
  MAX_MSGS_PER_SEC: 20,
  MAX_ROOMS_PER_IP: 5,
} as const;
