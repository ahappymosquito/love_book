// 花田拾光像素绘制：1-bit 小狗与障碍剪影（离屏缓存、纸色描边、摇尾/耳朵弹跳/跑动眨眼与起伏），Bayer 抖动连续天色与暗角、日月弧线与光晕、星星和流星、三层整数视差远山/花田/草丛、萤火与飘落花瓣，以及尘土、拾取闪光、心盾、受击闪白与轻震；关闭平滑、不加载图片。

import {
  playerBoxes,
  type CollisionBox,
  type RunnerChapterId,
  type RunnerMetrics,
  type RunnerObstacle,
  type RunnerObstacleKind,
  type RunnerPickup,
  type RunnerState,
} from "./xiaohua-runner";
import {
  FX_DUST,
  FX_SHARD,
  FX_SPARKLE,
  FX_TONE_ACCENT,
  FX_TONE_CREAM,
  FX_TONE_PEACH,
  RUNNER_FX_COMBO,
  RUNNER_FX_FLASH,
  RUNNER_FX_SHAKE,
  RUNNER_FX_SHIELD,
  ambientFirefly,
  ambientPetal,
  ambientStar,
  shootingStar,
  type AmbientPoint,
  type RunnerFx,
} from "./xiaohua-runner-fx";
import {
  bayerThreshold,
  buildSkyPixels,
  hashUnit,
  runnerDayClock,
  runnerWorldPalette,
  smoothstep,
  type RunnerSpritePalette,
  type RunnerWorldPalette,
} from "./xiaohua-runner-sky";
import {
  PUPPY_FLAG_BLINK,
  PUPPY_FLAG_EARS,
  PUPPY_FLAG_TAIL,
  SPRITE_BIRD_DOWN,
  SPRITE_BIRD_UP,
  SPRITE_BRAMBLE,
  SPRITE_CLOUD,
  SPRITE_HEART,
  SPRITE_LETTER,
  SPRITE_LOG,
  SPRITE_MOON,
  SPRITE_PETAL,
  SPRITE_PUPPY_BLINK,
  SPRITE_PUPPY_CRASH,
  SPRITE_PUPPY_DUCK_A,
  SPRITE_PUPPY_DUCK_B,
  SPRITE_PUPPY_IDLE,
  SPRITE_PUPPY_JUMP,
  SPRITE_PUPPY_RUN_A,
  SPRITE_PUPPY_RUN_B,
  SPRITE_PUPPY_SIT,
  SPRITE_ROCK,
  SPRITE_STUMP,
  puppyVariant,
  type PixelSprite,
} from "./xiaohua-runner-sprites";

export { hashUnit };

export type RunnerPalette = RunnerSpritePalette;

export const CHAPTER_PALETTE: Record<RunnerChapterId, RunnerPalette> = {
  dawn: { paper: "#f3ebe3", ink: "#5c4339", accent: "#c97878" },
  noon: { paper: "#f6f1ea", ink: "#53433c", accent: "#c46d73" },
  dusk: { paper: "#edd4bc", ink: "#5a3328", accent: "#c45c58" },
  night: { paper: "#2a2422", ink: "#e6d5c4", accent: "#e8a39a" },
};

export const CHAPTER_SKY: Record<RunnerChapterId, string> = {
  dawn: CHAPTER_PALETTE.dawn.paper,
  noon: CHAPTER_PALETTE.noon.paper,
  dusk: CHAPTER_PALETTE.dusk.paper,
  night: CHAPTER_PALETTE.night.paper,
};

export const PUPPY_TEXEL_HEIGHT = 47;
export const AMBIENT_PETALS = 18;
export const AMBIENT_FIREFLIES = 16;
export const AMBIENT_STARS = 42;

export type PuppyAction = "idle" | "run" | "jump" | "crouch" | "stumble" | "celebrate";

export interface PuppyPose {
  action: PuppyAction;
  breath: number;
  bob: number;
  tail: number;
  ear: number;
  blink: number;
  frontPhase: number;
  hindPhase: number;
  stretch: number;
  squash: number;
  sit: number;
  tilt: number;
}

type PixelCanvas = HTMLCanvasElement | OffscreenCanvas;
type PixelContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface DiskCells {
  spans: Int16Array;
  innerGlow: Int16Array;
  outerGlow: Int16Array;
}

interface SkyLayer {
  canvas: PixelCanvas;
  context: PixelContext;
  image: ImageData;
  cols: number;
  rows: number;
  key: number;
}

const OUTLINE_CACHE = new WeakMap<PixelSprite, string[]>();
const SPRITE_CANVAS_CACHE = new WeakMap<RunnerPalette, Map<PixelSprite, PixelCanvas | null>>();
const DISK_CACHE = new Map<number, DiskCells>();
const RING_CACHE = new Map<number, Int16Array>();
const HILL_HEIGHTS = new Float32Array(1024);
const AMBIENT: AmbientPoint = { x: 0, y: 0, alpha: 0, frame: 0 };
let skyLayer: SkyLayer | null = null;
let comboLabel = { value: 0, text: "" };

export function unionBoxes(boxes: CollisionBox[]): CollisionBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const bottom = Math.min(...boxes.map((box) => box.bottom));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.max(...boxes.map((box) => box.bottom + box.height));
  return { x: left, bottom, width: right - left, height: top - bottom };
}

export function puppyAction(state: RunnerState, celebrating: boolean): PuppyAction {
  if (state.status === "gameover") return celebrating ? "celebrate" : "stumble";
  if (state.y > 0.001) return "jump";
  if (state.crouching) return "crouch";
  if (state.status === "playing") return "run";
  return "idle";
}

export function puppyPose(state: RunnerState, time: number, celebrating: boolean, reducedMotion: boolean): PuppyPose {
  const action = puppyAction(state, celebrating);
  const quiet = reducedMotion ? 0 : 1;
  const pose: PuppyPose = {
    action,
    breath: 1,
    bob: 0,
    tail: 0.18,
    ear: 0,
    blink: 0,
    frontPhase: 0,
    hindPhase: 0,
    stretch: 1,
    squash: 1,
    sit: 0,
    tilt: 0,
  };

  if (action === "idle") {
    pose.breath = 1 + Math.sin(time * 2.2) * 0.03 * quiet;
    pose.bob = quiet ? Math.sin(time * 2.2) * 0.012 : 0;
    pose.tail = quiet ? Math.sin(time * 3.4) * 0.5 + 0.15 : 0.15;
    pose.ear = quiet ? Math.sin(time * 1.4) * 0.08 : 0;
    pose.blink = !reducedMotion && time % 4.6 < 0.12 ? 1 : 0;
    return pose;
  }

  if (action === "run") {
    const phase = state.distance * 2.35 + state.elapsed * 2;
    pose.frontPhase = Math.sin(phase);
    pose.hindPhase = Math.sin(phase + Math.PI);
    pose.bob = Math.abs(Math.sin(phase)) * 0.045 * quiet;
    pose.tail = Math.sin(phase * 1.15) * 0.62 * quiet + 0.1;
    pose.ear = -0.1 + Math.sin(phase) * 0.1 * quiet;
    pose.breath = 1 + Math.sin(phase * 2) * 0.02 * quiet;
    pose.blink = !reducedMotion && time % 3.7 < 0.12 ? 1 : 0;
    return pose;
  }

  if (action === "jump") {
    const rising = state.velocityY > 0;
    pose.stretch = rising ? 1.08 : 1.02;
    pose.squash = rising ? 0.9 : 0.96;
    pose.frontPhase = rising ? 0.85 : 0.35;
    pose.hindPhase = rising ? 0.55 : 0.2;
    pose.ear = -0.42;
    pose.tail = 0.55;
    pose.tilt = rising ? -0.08 : 0.06;
    return pose;
  }

  if (action === "crouch") {
    pose.squash = 0.72;
    pose.stretch = 1.08;
    pose.bob = -0.02;
    pose.ear = 0.28;
    pose.tail = -0.2;
    pose.frontPhase = Math.sin(state.distance * 2.2);
    pose.hindPhase = -0.2;
    return pose;
  }

  if (action === "stumble") {
    pose.tilt = -0.2;
    pose.squash = 0.88;
    pose.ear = 0.35;
    pose.tail = -0.35;
    pose.blink = 1;
    return pose;
  }

  pose.sit = 0.78;
  pose.tail = Math.sin(time * 9) * 0.75 * quiet + 0.2;
  pose.bob = Math.abs(Math.sin(time * 6)) * 0.05 * quiet;
  pose.ear = 0.12;
  pose.blink = !reducedMotion && time % 2.8 < 0.1 ? 1 : 0;
  return pose;
}

export function puppyVisualBox(state: RunnerState, pose: PuppyPose): CollisionBox {
  const core = unionBoxes(playerBoxes(state));
  const padX = 0.06;
  const padY = pose.action === "crouch" ? 0.03 : 0.08;
  return {
    x: core.x - padX,
    bottom: Math.max(0, core.bottom - 0.02 + pose.bob * 0.2),
    width: core.width + padX * 2,
    height: core.height * pose.squash * pose.breath + padY,
  };
}

export function pixelScale(metrics: RunnerMetrics): number {
  return Math.max(2, Math.round(metrics.standingHeight / PUPPY_TEXEL_HEIGHT));
}

export function withOutline(rows: PixelSprite): string[] {
  const cached = OUTLINE_CACHE.get(rows);
  if (cached) return cached;

  const width = Math.max(0, ...rows.map((row) => row.length));
  const padded = [
    ".".repeat(width + 2),
    ...rows.map((row) => `.${row.padEnd(width, ".")}.`),
    ".".repeat(width + 2),
  ];
  const height = padded.length;
  const grid = padded.map((row) => row.split(""));
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width + 2; x += 1) {
      if (grid[y][x] !== "#" && grid[y][x] !== "*") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width + 2) continue;
        if (out[ny][nx] === ".") out[ny][nx] = "o";
      }
    }
  }
  const result = out.map((row) => row.join(""));
  OUTLINE_CACHE.set(rows, result);
  return result;
}

export function puppySprite(state: RunnerState, pose: PuppyPose): PixelSprite {
  if (pose.action === "celebrate") return SPRITE_PUPPY_SIT;
  if (pose.action === "stumble") return SPRITE_PUPPY_CRASH;
  if (pose.action === "jump") return SPRITE_PUPPY_JUMP;
  const runFrame = Math.floor(state.elapsed * 12) % 2 === 0;
  if (pose.action === "crouch") return runFrame ? SPRITE_PUPPY_DUCK_A : SPRITE_PUPPY_DUCK_B;
  if (pose.action === "run") return runFrame ? SPRITE_PUPPY_RUN_A : SPRITE_PUPPY_RUN_B;
  return pose.blink > 0.5 ? SPRITE_PUPPY_BLINK : SPRITE_PUPPY_IDLE;
}

export function puppyFrameFlags(state: RunnerState, pose: PuppyPose, time: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const stride = Math.floor(state.elapsed * 12) % 2 === 0;
  if (pose.action === "run") return (stride ? PUPPY_FLAG_TAIL : PUPPY_FLAG_EARS) | (pose.blink > 0.5 ? PUPPY_FLAG_BLINK : 0);
  if (pose.action === "crouch") return stride ? 0 : PUPPY_FLAG_TAIL;
  if (pose.action === "jump") return (state.velocityY > 0 ? PUPPY_FLAG_EARS : 0) | (Math.floor(time * 8) % 2 === 0 ? PUPPY_FLAG_TAIL : 0);
  if (pose.action === "celebrate") return Math.floor(time * 9) % 2 === 0 ? PUPPY_FLAG_TAIL : 0;
  if (pose.action === "idle") return time % 3 < 1.2 && Math.floor(time * 5) % 2 === 0 ? PUPPY_FLAG_TAIL : 0;
  return 0;
}

export function puppyFrame(state: RunnerState, pose: PuppyPose, time: number, reducedMotion: boolean): PixelSprite {
  return puppyVariant(puppySprite(state, pose), puppyFrameFlags(state, pose, time, reducedMotion));
}

export function obstacleSprite(kind: RunnerObstacleKind, elapsed: number): PixelSprite {
  if (kind === "rock") return SPRITE_ROCK;
  if (kind === "stump") return SPRITE_STUMP;
  if (kind === "log") return SPRITE_LOG;
  if (kind === "bramble") return SPRITE_BRAMBLE;
  return Math.floor(elapsed * 6) % 2 === 0 ? SPRITE_BIRD_UP : SPRITE_BIRD_DOWN;
}

export function diskCells(radius: number): DiskCells {
  const cached = DISK_CACHE.get(radius);
  if (cached) return cached;
  const spans: number[] = [];
  const innerGlow: number[] = [];
  const outerGlow: number[] = [];
  const reach = radius + 5;
  for (let dy = -reach; dy <= reach; dy += 1) {
    if (Math.abs(dy) <= radius) spans.push(dy, Math.floor(Math.sqrt(radius * radius - dy * dy) + 0.35));
    for (let dx = -reach; dx <= reach; dx += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius + 0.5 || distance > reach + 0.5) continue;
      if (distance <= radius + 2.5) {
        if (((dx + dy) & 1) === 0) innerGlow.push(dx, dy);
      } else if (bayerThreshold(dx + 64, dy + 64) < 0.25) {
        outerGlow.push(dx, dy);
      }
    }
  }
  const cells = { spans: Int16Array.from(spans), innerGlow: Int16Array.from(innerGlow), outerGlow: Int16Array.from(outerGlow) };
  DISK_CACHE.set(radius, cells);
  return cells;
}

export function ringCells(radius: number): Int16Array {
  const cached = RING_CACHE.get(radius);
  if (cached) return cached;
  const cells: number[] = [];
  for (let dy = -radius - 1; dy <= radius + 1; dy += 1) {
    for (let dx = -radius - 1; dx <= radius + 1; dx += 1) {
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - radius) < 0.5) cells.push(dx, dy);
    }
  }
  const ring = Int16Array.from(cells);
  RING_CACHE.set(radius, ring);
  return ring;
}

function snapToScale(value: number, scale: number): number {
  return Math.round(value / scale) * scale;
}

function worldX(metrics: RunnerMetrics, x: number): number {
  return metrics.frame.x + x * metrics.bodyUnit;
}

function worldY(metrics: RunnerMetrics, bottom: number): number {
  return metrics.groundBaseline - bottom * metrics.standingHeight;
}

function spriteFitScale(sprite: PixelSprite, worldWidth: number, worldHeight: number, outlined: boolean): number {
  const rows = outlined ? withOutline(sprite) : sprite;
  const width = rows[0]?.length ?? 1;
  const height = Math.max(1, rows.length);
  return Math.max(2, Math.round(Math.min(worldWidth / width, worldHeight / height)));
}

function createPixelCanvas(width: number, height: number): PixelCanvas | null {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  return null;
}

function pixelContext(canvas: PixelCanvas): PixelContext | null {
  return (canvas as OffscreenCanvas).getContext("2d") as PixelContext | null;
}

function paintRows(context: PixelContext, rows: PixelSprite, palette: RunnerPalette, scale: number, originX: number, originY: number) {
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row];
    for (let col = 0; col < line.length; col += 1) {
      const cell = line[col];
      if (cell === "." || cell === " ") continue;
      context.fillStyle = cell === "*" ? palette.accent : cell === "o" ? palette.paper : palette.ink;
      context.fillRect(originX + col * scale, originY + row * scale, scale, scale);
    }
  }
}

function spriteCanvas(rows: PixelSprite, palette: RunnerPalette): PixelCanvas | null {
  let byPalette = SPRITE_CANVAS_CACHE.get(palette);
  if (!byPalette) {
    byPalette = new Map();
    SPRITE_CANVAS_CACHE.set(palette, byPalette);
  }
  if (byPalette.has(rows)) return byPalette.get(rows) ?? null;
  const canvas = createPixelCanvas(Math.max(1, rows[0]?.length ?? 1), Math.max(1, rows.length));
  const context = canvas ? pixelContext(canvas) : null;
  if (canvas && context) paintRows(context, rows, palette, 1, 0, 0);
  const result = canvas && context ? canvas : null;
  byPalette.set(rows, result);
  return result;
}

export function blitSprite(
  context: CanvasRenderingContext2D,
  sprite: PixelSprite,
  x: number,
  y: number,
  scale: number,
  palette: RunnerPalette,
  outlined = true,
) {
  const rows = outlined ? withOutline(sprite) : sprite;
  const originX = snapToScale(x, scale);
  const originY = snapToScale(y, scale);
  const canvas = spriteCanvas(rows, palette);
  if (canvas) {
    context.drawImage(canvas, originX, originY, canvas.width * scale, canvas.height * scale);
    return;
  }
  paintRows(context, rows, palette, scale, originX, originY);
}

function drawSky(context: CanvasRenderingContext2D, metrics: RunnerMetrics, world: RunnerWorldPalette, scale: number, baseline: number) {
  const cols = Math.max(1, Math.ceil(metrics.frame.width / scale));
  const rows = Math.max(1, Math.ceil((baseline - metrics.frame.y) / scale) + 1);
  if (!skyLayer || skyLayer.cols !== cols || skyLayer.rows !== rows) {
    const canvas = createPixelCanvas(cols, rows);
    const skyContext = canvas ? pixelContext(canvas) : null;
    skyLayer = canvas && skyContext
      ? { canvas, context: skyContext, image: skyContext.createImageData(cols, rows), cols, rows, key: -1 }
      : null;
  }
  if (!skyLayer) {
    context.fillStyle = world.skyMid;
    context.fillRect(metrics.frame.x, metrics.frame.y, metrics.frame.width, baseline - metrics.frame.y);
    return;
  }
  if (skyLayer.key !== world.key) {
    buildSkyPixels(cols, rows, world.skyStops, skyLayer.image.data);
    skyLayer.context.putImageData(skyLayer.image, 0, 0);
    skyLayer.key = world.key;
  }
  context.drawImage(skyLayer.canvas, metrics.frame.x, metrics.frame.y, cols * scale, rows * scale);
}

function drawStars(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  scale: number,
  skyHeight: number,
  time: number,
  reducedMotion: boolean,
) {
  if (world.stars <= 0.02) return;
  const { frame } = metrics;
  const count = reducedMotion ? AMBIENT_STARS / 2 : AMBIENT_STARS;
  context.fillStyle = world.star;
  for (let index = 0; index < count; index += 1) {
    ambientStar(index, reducedMotion ? 0 : time, frame.width, skyHeight * 0.62, AMBIENT);
    const alpha = world.stars * (reducedMotion ? 0.8 : AMBIENT.alpha);
    const x = snapToScale(frame.x + AMBIENT.x, scale);
    const y = snapToScale(frame.y + AMBIENT.y, scale);
    context.globalAlpha = alpha;
    context.fillRect(x, y, scale, scale);
    if (AMBIENT.frame === 1 && alpha > 0.55) {
      context.globalAlpha = alpha * 0.45;
      context.fillRect(x - scale, y, scale, scale);
      context.fillRect(x + scale, y, scale, scale);
      context.fillRect(x, y - scale, scale, scale);
      context.fillRect(x, y + scale, scale, scale);
    }
  }
  if (!reducedMotion && world.stars > 0.6 && shootingStar(time, AMBIENT)) {
    const headX = snapToScale(frame.x + AMBIENT.x * frame.width, scale);
    const headY = snapToScale(frame.y + AMBIENT.y * skyHeight, scale);
    const fade = AMBIENT.alpha * world.stars;
    for (let step = 0; step <= 7; step += 1) {
      context.globalAlpha = fade * (1 - step / 8);
      context.fillRect(headX + step * 2 * scale, headY - step * scale, scale, scale);
      if (step > 0) context.fillRect(headX + (step * 2 - 1) * scale, headY - step * scale, scale, scale);
    }
  }
  context.globalAlpha = 1;
}

function drawGlowDisk(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  scale: number,
  body: string | null,
  glow: string,
  alpha: number,
) {
  const cells = diskCells(radius);
  const cx = snapToScale(centerX, scale);
  const cy = snapToScale(centerY, scale);
  context.fillStyle = glow;
  context.globalAlpha = alpha * 0.5;
  for (let index = 0; index < cells.outerGlow.length; index += 2) {
    context.fillRect(cx + cells.outerGlow[index] * scale, cy + cells.outerGlow[index + 1] * scale, scale, scale);
  }
  context.globalAlpha = alpha * 0.85;
  for (let index = 0; index < cells.innerGlow.length; index += 2) {
    context.fillRect(cx + cells.innerGlow[index] * scale, cy + cells.innerGlow[index + 1] * scale, scale, scale);
  }
  if (body) {
    context.globalAlpha = alpha;
    context.fillStyle = body;
    for (let index = 0; index < cells.spans.length; index += 2) {
      const half = cells.spans[index + 1];
      context.fillRect(cx - half * scale, cy + cells.spans[index] * scale, (half * 2 + 1) * scale, scale);
    }
  }
  context.globalAlpha = 1;
}

function drawSunAndMoon(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  scale: number,
  baseline: number,
  skyHeight: number,
  hillBand: number,
  elapsed: number,
) {
  const { frame } = metrics;
  const horizonY = baseline - hillBand * 0.55;
  const arc = Math.min(skyHeight * 0.6, Math.max(hillBand * 1.6, skyHeight * 0.45));
  const radius = Math.min(9, Math.max(5, Math.round((Math.min(frame.width, frame.height) * 0.045) / scale)));
  if (world.clock < 2.6) {
    const progress = Math.min(1, Math.max(0, (world.clock + 0.25) / 2.6));
    const x = frame.x + frame.width * (0.1 + 0.8 * progress);
    const y = horizonY - Math.sin(Math.PI * progress) * arc + Math.max(0, world.clock - 2) * hillBand * 0.9;
    drawGlowDisk(context, x, y, radius, scale, world.sun, world.glow, 1 - smoothstep((world.clock - 2.3) / 0.3));
  }
  const moonUp = smoothstep((world.clock - 2.15) / 0.85);
  if (moonUp <= 0) return;
  const drift = Math.min(1, Math.max(0, elapsed - 80) / 150);
  const moonScale = scale + 1;
  const x = frame.x + frame.width * (0.16 + 0.5 * moonUp + 0.18 * drift);
  const y = horizonY - (0.3 + 0.5 * moonUp) * arc + (1 - moonUp) * hillBand * 0.8;
  drawGlowDisk(context, x, y, Math.round((radius * moonScale) / scale) - 1, scale, null, world.glow, moonUp);
  const rows = withOutline(SPRITE_MOON);
  context.globalAlpha = moonUp;
  blitSprite(context, SPRITE_MOON, x - (rows[0].length * moonScale) / 2, y - (rows.length * moonScale) / 2, moonScale, world.moonPalette, true);
  context.globalAlpha = 1;
}

function drawClouds(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  scroll: number,
  palette: RunnerPalette,
  scale: number,
  alpha: number,
) {
  if (alpha <= 0.02) return;
  const cloudScale = Math.max(2, scale - 1);
  const span = metrics.frame.width + 160;
  context.globalAlpha = alpha * 0.35;
  for (let index = 0; index < 2; index += 1) {
    const drift = (scroll * 0.08 + index * 330 + 90) % span;
    const y = metrics.frame.y + metrics.frame.height * (0.06 + hashUnit(index + 40) * 0.12);
    blitSprite(context, SPRITE_CLOUD, metrics.frame.x + metrics.frame.width - drift, y, Math.max(2, cloudScale - 1), palette, false);
  }
  context.globalAlpha = alpha * 0.7;
  for (let index = 0; index < 3; index += 1) {
    const drift = (scroll * 0.22 + index * 240) % span;
    const y = metrics.frame.y + metrics.frame.height * (0.12 + hashUnit(index + 4) * 0.18);
    blitSprite(context, SPRITE_CLOUD, metrics.frame.x + metrics.frame.width - drift, y, cloudScale, palette, false);
  }
  context.globalAlpha = 1;
}

function ridge(column: number, seed: number, frequency: number): number {
  return 0.5 + 0.32 * Math.sin(column * frequency + seed) + 0.18 * Math.sin(column * frequency * 2.7 + seed * 1.9);
}

function drawHillLayer(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  baseline: number,
  scroll: number,
  scale: number,
  layer: "far" | "mid",
  hillBand: number,
) {
  const far = layer === "far";
  const cell = far ? scale * 2 : scale;
  const offset = Math.floor((scroll * (far ? 0.12 : 0.32)) / scale) * scale;
  const startColumn = Math.floor(offset / cell);
  const shift = offset - startColumn * cell;
  const columns = Math.min(HILL_HEIGHTS.length, Math.ceil(metrics.frame.width / cell) + 4);
  const base = far ? hillBand * 0.45 : metrics.standingHeight * 0.36;
  const amplitude = far ? hillBand * 0.55 : metrics.standingHeight * 0.42;
  const seed = far ? 1.7 : 4.3;
  const frequency = far ? 0.11 : 0.045;
  const left = metrics.frame.x - cell * 2 - shift;

  context.fillStyle = far ? world.hillFar : world.hillMid;
  for (let index = 0; index < columns; index += 1) {
    const top = snapToScale(baseline - base - amplitude * ridge(startColumn + index, seed, frequency), scale);
    HILL_HEIGHTS[index] = top;
    context.fillRect(left + index * cell, top, cell, baseline - top + scale);
    if (far && ((startColumn + index) & 1) === 0) context.fillRect(left + index * cell, top - scale, scale, scale);
  }
  if (far) return;

  for (let pass = 0; pass < 2; pass += 1) {
    context.fillStyle = pass === 0 ? world.flowerA : world.flowerB;
    for (let index = 0; index < columns; index += 1) {
      const bloom = hashUnit((startColumn + index) * 3.7 + seed);
      if (bloom >= 0.11 || (bloom < 0.055 ? 0 : 1) !== pass) continue;
      const x = left + index * cell;
      const top = HILL_HEIGHTS[index];
      context.fillRect(x, top - scale, scale, scale);
      if (bloom < 0.022 || (bloom > 0.06 && bloom < 0.075)) {
        context.fillRect(x - scale, top - 2 * scale, scale, scale);
        context.fillRect(x + scale, top - 2 * scale, scale, scale);
        context.fillRect(x, top - 3 * scale, scale, scale);
      }
    }
  }
}

function drawFireflies(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  scale: number,
  baseline: number,
  hillBand: number,
  scroll: number,
  time: number,
  reducedMotion: boolean,
) {
  const count = Math.round((reducedMotion ? 6 : AMBIENT_FIREFLIES) * world.fireflies);
  if (count <= 0) return;
  context.fillStyle = world.firefly;
  const top = baseline - hillBand * 1.15;
  for (let index = 0; index < count; index += 1) {
    ambientFirefly(index, reducedMotion ? 0 : time, metrics.frame.width, top, hillBand, reducedMotion ? 0 : scroll, AMBIENT);
    const alpha = (reducedMotion ? 0.6 : AMBIENT.alpha) * world.fireflies;
    if (alpha < 0.04) continue;
    const x = snapToScale(metrics.frame.x + AMBIENT.x, scale);
    const y = snapToScale(AMBIENT.y, scale);
    context.globalAlpha = alpha;
    context.fillRect(x, y, scale, scale);
    if (AMBIENT.frame === 1) {
      context.globalAlpha = alpha * 0.35;
      context.fillRect(x - scale, y, scale, scale);
      context.fillRect(x + scale, y, scale, scale);
      context.fillRect(x, y - scale, scale, scale);
      context.fillRect(x, y + scale, scale, scale);
    }
  }
  context.globalAlpha = 1;
}

function drawPetalDrift(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  scale: number,
  skyHeight: number,
  scroll: number,
  time: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return;
  const count = Math.round(AMBIENT_PETALS * world.petals);
  for (let index = 0; index < count; index += 1) {
    ambientPetal(index, time, metrics.frame.width, skyHeight, scroll, AMBIENT);
    const x = snapToScale(metrics.frame.x + AMBIENT.x, scale);
    const y = snapToScale(metrics.frame.y + AMBIENT.y, scale);
    context.globalAlpha = AMBIENT.alpha * world.petals;
    context.fillStyle = index % 3 === 0 ? world.flowerB : world.flowerA;
    if (index % 4 === 3) context.fillRect(x, y, scale, scale);
    else if (AMBIENT.frame === 0) context.fillRect(x, y, scale * 2, scale);
    else context.fillRect(x, y, scale, scale * 2);
  }
  context.globalAlpha = 1;
}

function drawGround(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  world: RunnerWorldPalette,
  palette: RunnerPalette,
  baseline: number,
  scroll: number,
  scale: number,
  chapter: RunnerChapterId,
) {
  const { frame } = metrics;
  const margin = scale * 4;
  context.fillStyle = world.ground;
  context.fillRect(frame.x - margin, baseline, frame.width + margin * 2, frame.y + frame.height - baseline + margin);

  const start = Math.floor(scroll / scale);
  const columns = Math.ceil(frame.width / scale) + 6;
  const left = frame.x - scale * 3 - (scroll % scale);
  context.fillStyle = world.groundShade;
  for (let index = 0; index < columns; index += 1) {
    const texel = start + index;
    if ((texel & 1) === 0) context.fillRect(left + index * scale, baseline + 2 * scale, scale, scale);
    if ((texel & 3) === 1) context.fillRect(left + index * scale, baseline + 4 * scale, scale, scale);
  }
  const fgCell = scale * 2;
  const fgOffset = Math.floor((scroll * 1.35) / scale) * scale;
  const fgStart = Math.floor(fgOffset / fgCell);
  const fgLeft = frame.x - fgCell - (fgOffset - fgStart * fgCell);
  for (let index = 0; index < Math.ceil(frame.width / fgCell) + 3; index += 1) {
    const speck = hashUnit((fgStart + index) * 11.3 + 2);
    if (speck > 0.2) continue;
    context.fillRect(fgLeft + index * fgCell, baseline + (5 + Math.floor(speck * 20)) * scale, fgCell, scale);
  }

  context.fillStyle = palette.ink;
  for (let index = 0; index < columns; index += 1) {
    const texel = start + index;
    const x = left + index * scale;
    const unit = hashUnit(texel * 0.17);
    const bump = unit < 0.035 ? -1 : unit < 0.07 ? 1 : 0;
    context.fillRect(x, baseline + bump * scale, scale, scale);
    const pebble = hashUnit(texel * 19.7);
    if (pebble < 0.11) {
      const py = baseline + (2 + Math.floor(hashUnit(texel * 7.1) * 3)) * scale;
      const width = (1 + Math.floor(hashUnit(texel * 3.3) * 2)) * scale;
      context.fillRect(x, py, width, scale);
    }
    const tuft = hashUnit(texel * 5.3 + 1);
    if (tuft < 0.045) {
      context.fillRect(x, baseline - scale, scale, scale);
      context.fillRect(x + scale, baseline - 2 * scale, scale, scale);
      if (tuft < 0.02) context.fillRect(x + 2 * scale, baseline - scale, scale, scale);
    }
  }
  if (chapter === "night") return;
  context.fillStyle = palette.accent;
  for (let index = 0; index < columns; index += 1) {
    const texel = start + index;
    if (hashUnit(texel * 19.7) <= 0.975) continue;
    const x = left + index * scale;
    context.fillRect(x, baseline - 3 * scale, scale, scale);
    context.fillRect(x - scale, baseline - 2 * scale, scale, scale);
    context.fillRect(x + scale, baseline - 2 * scale, scale, scale);
  }
}

function drawGroundShadow(context: CanvasRenderingContext2D, centerX: number, baseline: number, halfWidth: number, scale: number, color: string, alpha: number) {
  if (halfWidth <= 0 || alpha <= 0) return;
  const cx = snapToScale(centerX, scale);
  context.fillStyle = color;
  context.globalAlpha = alpha;
  for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
    if ((dx & 1) === 0) context.fillRect(cx + dx * scale, baseline + scale, scale, scale);
    if ((dx & 1) === 1 && Math.abs(dx) < halfWidth - 1) context.fillRect(cx + dx * scale, baseline + 2 * scale, scale, scale);
  }
  context.globalAlpha = 1;
}

function drawPickupItem(
  context: CanvasRenderingContext2D,
  pickup: RunnerPickup,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  world: RunnerWorldPalette,
  baseline: number,
  scale: number,
  time: number,
  reducedMotion: boolean,
) {
  const sprite = pickup.kind === "heart" ? SPRITE_HEART : pickup.kind === "letter" ? SPRITE_LETTER : SPRITE_PETAL;
  const worldWidth = pickup.width * metrics.bodyUnit;
  const worldHeight = pickup.height * metrics.standingHeight;
  const itemScale = spriteFitScale(sprite, worldWidth, worldHeight, true);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * itemScale;
  const bob = reducedMotion ? 0 : Math.round(Math.sin(time * 4 + pickup.id) * itemScale);
  const centerX = worldX(metrics, pickup.x + pickup.width / 2);
  const x = snapToScale(centerX - drawW / 2, itemScale);
  const y = snapToScale(worldY(metrics, pickup.bottom + pickup.height) - bob, itemScale);
  drawGroundShadow(context, centerX, baseline, 2, scale, palette.ink, 0.16);
  blitSprite(context, sprite, x, y, itemScale, palette, true);
  if (reducedMotion || Math.sin(time * 4.5 + pickup.id * 1.3) < 0.8) return;
  const gx = x + drawW - itemScale;
  const gy = y;
  context.fillStyle = world.sun;
  context.fillRect(gx, gy - itemScale, itemScale, itemScale * 3);
  context.fillRect(gx - itemScale, gy, itemScale * 3, itemScale);
}

function drawObstacleShape(
  context: CanvasRenderingContext2D,
  obstacle: RunnerObstacle,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  baseline: number,
  scale: number,
  elapsed: number,
) {
  const sprite = obstacleSprite(obstacle.kind, elapsed);
  const worldWidth = obstacle.width * metrics.bodyUnit;
  const worldHeight = obstacle.height * metrics.standingHeight;
  const itemScale = spriteFitScale(sprite, worldWidth, worldHeight, true);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * itemScale;
  const drawH = rows.length * itemScale;
  const centerX = worldX(metrics, obstacle.x + obstacle.width / 2);
  if (obstacle.bottom > 0) drawGroundShadow(context, centerX, baseline, 3, scale, palette.ink, 0.14);
  const x = snapToScale(centerX - drawW / 2, itemScale);
  const y = snapToScale(worldY(metrics, obstacle.bottom) - drawH, itemScale);
  blitSprite(context, sprite, x, y, itemScale, palette, true);
}

function drawPuppyPixels(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  pose: PuppyPose,
  palette: RunnerPalette,
  baseline: number,
  scale: number,
  time: number,
  reducedMotion: boolean,
) {
  const core = unionBoxes(playerBoxes(state));
  const centerX = worldX(metrics, core.x + core.width / 2);
  const shadowHalf = Math.round((pose.action === "crouch" ? 9 : 7) * (1 - Math.min(0.6, state.y * 0.4)));
  drawGroundShadow(context, centerX, baseline, shadowHalf, scale, palette.ink, 0.2);
  if (state.invincibleFor > 0 && !reducedMotion && Math.floor(state.elapsed * 16) % 2 === 0) return;
  const sprite = puppyFrame(state, pose, time, reducedMotion);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * scale;
  const drawH = rows.length * scale;
  const lift = pose.action === "run" && !reducedMotion && Math.floor(state.elapsed * 12) % 2 === 0 ? scale : 0;
  const x = snapToScale(centerX - drawW / 2, scale);
  const y = snapToScale(worldY(metrics, core.bottom) - drawH, scale) - lift;
  blitSprite(context, sprite, x, y, scale, palette, true);
}

function drawLandingDust(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  scale: number,
) {
  if (state.landDust <= 0) return;
  const strength = state.landDust / 0.28;
  const x = snapToScale(metrics.playerScreenX + metrics.bodyUnit * 0.2, scale);
  const y = snapToScale(metrics.groundBaseline + scale, scale);
  context.fillStyle = palette.ink;
  context.globalAlpha = 0.45 * strength;
  context.fillRect(x, y, scale, scale);
  context.fillRect(x + 3 * scale, y + scale, scale, scale);
  context.fillRect(x - 2 * scale, y + scale, scale, scale);
  context.globalAlpha = 1;
}

function particleColor(tone: number, palette: RunnerPalette, world: RunnerWorldPalette, chapter: RunnerChapterId): string {
  if (tone === FX_TONE_ACCENT) return palette.accent;
  if (tone === FX_TONE_PEACH) return world.flowerB;
  if (tone === FX_TONE_CREAM) return chapter === "night" ? world.star : world.sun;
  return palette.ink;
}

function drawParticles(
  context: CanvasRenderingContext2D,
  fx: RunnerFx,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  world: RunnerWorldPalette,
  chapter: RunnerChapterId,
  scale: number,
  front: boolean,
) {
  for (let index = 0; index < fx.count; index += 1) {
    const kind = fx.kind[index];
    if ((kind === FX_DUST) === front) continue;
    const life = fx.age[index] / fx.life[index];
    const x = snapToScale(worldX(metrics, fx.x[index]), scale);
    const y = snapToScale(worldY(metrics, fx.y[index]), scale);
    context.fillStyle = particleColor(fx.tone[index], palette, world, chapter);
    if (kind === FX_DUST) {
      context.globalAlpha = 0.42 * (1 - life);
      const size = life < 0.5 ? scale * 2 : scale;
      context.fillRect(x, y - size, size, size);
    } else if (kind === FX_SPARKLE) {
      context.globalAlpha = 1 - life * life;
      context.fillRect(x, y, scale, scale);
      if (life < 0.45) {
        context.fillRect(x - scale, y, scale, scale);
        context.fillRect(x + scale, y, scale, scale);
        context.fillRect(x, y - scale, scale, scale);
        context.fillRect(x, y + scale, scale, scale);
      }
    } else if (kind === FX_SHARD) {
      context.globalAlpha = 1 - life * life * life;
      if (index & 1) context.fillRect(x, y, scale * 2, scale);
      else context.fillRect(x, y, scale, scale * 2);
    }
  }
  context.globalAlpha = 1;
}

function drawShield(
  context: CanvasRenderingContext2D,
  fx: RunnerFx,
  state: RunnerState,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  scale: number,
) {
  if (fx.shield <= 0) return;
  const progress = 1 - fx.shield / RUNNER_FX_SHIELD;
  const baseRadius = Math.max(6, Math.round((metrics.standingHeight * 0.62) / scale));
  const radius = baseRadius + Math.round(progress * 3);
  const cx = snapToScale(metrics.playerScreenX + metrics.bodyUnit * 0.47, scale);
  const cy = snapToScale(worldY(metrics, state.y + 0.48), scale);
  const ring = ringCells(radius);
  context.fillStyle = palette.accent;
  context.globalAlpha = 0.9 * (1 - progress);
  for (let index = 0; index < ring.length; index += 2) {
    context.fillRect(cx + ring[index] * scale, cy + ring[index + 1] * scale, scale, scale);
  }
  const shine = ringCells(radius - 2);
  context.fillStyle = palette.paper;
  context.globalAlpha = 0.7 * (1 - progress);
  for (let index = 0; index < shine.length; index += 2) {
    const dx = shine[index];
    const dy = shine[index + 1];
    if (dx < 0 && dy < 0 && dx > -radius * 0.8 && (dx & 1) === 0) context.fillRect(cx + dx * scale, cy + dy * scale, scale, scale);
  }
  context.globalAlpha = 1;
}

function drawPopups(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  fx: RunnerFx | null,
) {
  const base = Math.max(11, Math.round(metrics.standingHeight * 0.13));
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = palette.paper;
  context.lineWidth = Math.max(3, Math.round(base * 0.28));
  for (const popup of state.popups) {
    const grow = popup.age < 0.12 ? 1.3 - (popup.age / 0.12) * 0.3 : 1;
    context.font = `700 ${Math.round(base * grow)}px ui-monospace, monospace`;
    context.globalAlpha = popup.age < 0.45 ? 1 : Math.max(0, 1 - (popup.age - 0.45) / 0.25);
    context.fillStyle = popup.text.startsWith("+") ? palette.accent : palette.ink;
    const x = Math.round(worldX(metrics, popup.x));
    const y = Math.round(worldY(metrics, popup.y));
    context.strokeText(popup.text, x, y);
    context.fillText(popup.text, x, y);
  }
  if (fx && fx.comboAge < RUNNER_FX_COMBO && fx.comboValue >= 3) {
    if (comboLabel.value !== fx.comboValue) comboLabel = { value: fx.comboValue, text: `连击 ×${fx.comboValue}` };
    const grow = fx.comboAge < 0.15 ? 1.35 - (fx.comboAge / 0.15) * 0.35 : 1;
    context.font = `800 ${Math.round(base * 1.05 * grow)}px ui-monospace, monospace`;
    context.globalAlpha = fx.comboAge < 0.6 ? 1 : Math.max(0, 1 - (fx.comboAge - 0.6) / 0.3);
    context.fillStyle = palette.accent;
    const x = Math.round(metrics.playerScreenX + metrics.bodyUnit * 0.5);
    const y = Math.round(worldY(metrics, state.y + 1.42) - fx.comboAge * 10);
    context.strokeText(comboLabel.text, x, y);
    context.fillText(comboLabel.text, x, y);
  }
  context.restore();
}

export const OBSTACLE_KINDS: RunnerObstacleKind[] = ["rock", "stump", "log", "bramble", "bird"];

export function shakeOffset(fx: RunnerFx | null, scale: number, reducedMotion: boolean): { x: number; y: number } {
  if (!fx || reducedMotion || fx.shake <= 0) return { x: 0, y: 0 };
  const strength = Math.ceil((fx.shake / RUNNER_FX_SHAKE) * 2);
  return {
    x: Math.round((hashUnit(fx.time * 61.3) - 0.5) * 2 * strength) * scale,
    y: Math.round((hashUnit(fx.time * 47.9 + 3) - 0.5) * 2 * strength) * scale,
  };
}

export function drawScene(
  context: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  state: RunnerState,
  metrics: RunnerMetrics,
  reducedMotion: boolean,
  celebrating: boolean,
  renderTime: number,
  _dpr: number,
  fx: RunnerFx | null = null,
) {
  const palette = CHAPTER_PALETTE[state.chapter];
  const world = runnerWorldPalette(runnerDayClock(state.elapsed));
  const scale = pixelScale(metrics);
  const { frame } = metrics;
  const baseline = snapToScale(metrics.groundBaseline, scale);
  const skyHeight = baseline - frame.y;
  const hillBand = Math.min(frame.height * 0.3, Math.max(metrics.standingHeight * 2.2, frame.height * 0.16));
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y, frame.width, frame.height);
  context.clip();
  context.imageSmoothingEnabled = false;
  context.imageSmoothingQuality = "low";

  const rawScroll = state.status === "playing" || state.status === "paused"
    ? state.distance * metrics.bodyUnit
    : reducedMotion
      ? 0
      : renderTime * 28;
  const scroll = snapToScale(rawScroll, scale);

  drawSky(context, metrics, world, scale, baseline);
  drawStars(context, metrics, world, scale, skyHeight, renderTime, reducedMotion);
  drawSunAndMoon(context, metrics, world, scale, baseline, skyHeight, hillBand, state.elapsed);

  const shake = shakeOffset(fx, scale, reducedMotion);
  context.save();
  context.translate(shake.x, shake.y);
  drawClouds(context, metrics, scroll, palette, scale, 1 - world.stars);
  drawHillLayer(context, metrics, world, baseline, scroll, scale, "far", hillBand);
  drawHillLayer(context, metrics, world, baseline, scroll, scale, "mid", hillBand);
  drawFireflies(context, metrics, world, scale, baseline, hillBand, scroll, renderTime, reducedMotion);
  drawPetalDrift(context, metrics, world, scale, skyHeight, scroll, renderTime, reducedMotion);
  drawGround(context, metrics, world, palette, baseline, scroll, scale, state.chapter);

  for (const pickup of state.pickups) {
    drawPickupItem(context, pickup, metrics, palette, world, baseline, scale, renderTime, reducedMotion);
  }
  for (const obstacle of state.obstacles) {
    drawObstacleShape(context, obstacle, metrics, palette, baseline, scale, state.elapsed);
  }
  if (fx) drawParticles(context, fx, metrics, palette, world, state.chapter, scale, false);
  else drawLandingDust(context, state, metrics, palette, scale);
  drawPuppyPixels(
    context,
    state,
    metrics,
    puppyPose(state, renderTime, celebrating, reducedMotion),
    palette,
    baseline,
    scale,
    renderTime,
    reducedMotion,
  );
  if (fx) {
    drawShield(context, fx, state, metrics, palette, scale);
    drawParticles(context, fx, metrics, palette, world, state.chapter, scale, true);
  }
  drawPopups(context, state, metrics, palette, fx);
  context.restore();

  if (fx && fx.flash > 0 && !reducedMotion) {
    context.fillStyle = world.flash;
    context.globalAlpha = (state.chapter === "night" ? 0.3 : 0.42) * (fx.flash / RUNNER_FX_FLASH);
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
    context.globalAlpha = 1;
  }
  context.restore();
}

export function obstacleVisualBox(obstacle: RunnerObstacle): CollisionBox {
  return {
    x: obstacle.x,
    bottom: obstacle.bottom,
    width: obstacle.width,
    height: obstacle.height,
  };
}

export function collisionFitsVisual(visual: CollisionBox, collision: CollisionBox): boolean {
  return collision.x >= visual.x - 0.001
    && collision.bottom >= visual.bottom - 0.001
    && collision.x + collision.width <= visual.x + visual.width + 0.001
    && collision.bottom + collision.height <= visual.bottom + visual.height + 0.001;
}
