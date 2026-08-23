// 花田拾光像素绘制：Chrome 小恐龙同款 1-bit 剪影、纸色描边、地平线与整数格点，不加载图片。

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
  type PixelSprite,
} from "./xiaohua-runner-sprites";

export interface RunnerPalette {
  paper: string;
  ink: string;
  accent: string;
}

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

const OUTLINE_CACHE = new WeakMap<PixelSprite, string[]>();

export function hashUnit(value: number): number {
  const unit = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return unit - Math.floor(unit);
}

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
  if (pose.action === "crouch") return pose.frontPhase >= 0 ? SPRITE_PUPPY_DUCK_A : SPRITE_PUPPY_DUCK_B;
  if (pose.action === "jump") return SPRITE_PUPPY_JUMP;
  if (pose.action === "run") return pose.frontPhase >= 0 ? SPRITE_PUPPY_RUN_A : SPRITE_PUPPY_RUN_B;
  return pose.blink > 0.5 ? SPRITE_PUPPY_BLINK : SPRITE_PUPPY_IDLE;
}

export function obstacleSprite(kind: RunnerObstacleKind, elapsed: number): PixelSprite {
  if (kind === "rock") return SPRITE_ROCK;
  if (kind === "stump") return SPRITE_STUMP;
  if (kind === "log") return SPRITE_LOG;
  if (kind === "bramble") return SPRITE_BRAMBLE;
  return Math.floor(elapsed * 6) % 2 === 0 ? SPRITE_BIRD_UP : SPRITE_BIRD_DOWN;
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
  const originX = Math.round(x);
  const originY = Math.round(y);
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

function drawHorizon(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  scroll: number,
  palette: RunnerPalette,
  scale: number,
  chapter: RunnerChapterId,
) {
  const y = snapToScale(metrics.groundBaseline, scale);
  const start = Math.floor(scroll / scale);
  const columns = Math.ceil(metrics.frame.width / scale) + 3;
  context.fillStyle = palette.ink;
  for (let index = 0; index < columns; index += 1) {
    const texel = start + index;
    const unit = hashUnit(texel * 0.17);
    const bump = unit < 0.035 ? -1 : unit < 0.07 ? 1 : 0;
    const x = metrics.frame.x + index * scale - (scroll % scale);
    context.fillRect(x, y + bump * scale, scale, scale);
    const pebble = hashUnit(texel * 19.7);
    if (pebble < 0.11) {
      const py = y + (2 + Math.floor(hashUnit(texel * 7.1) * 3)) * scale;
      const width = (1 + Math.floor(hashUnit(texel * 3.3) * 2)) * scale;
      context.fillRect(x, py, width, scale);
    } else if (pebble > 0.975 && chapter !== "night") {
      context.fillStyle = palette.accent;
      context.fillRect(x, y - 3 * scale, scale, scale);
      context.fillRect(x - scale, y - 2 * scale, scale, scale);
      context.fillRect(x + scale, y - 2 * scale, scale, scale);
      context.fillStyle = palette.ink;
    }
  }
}

function drawClouds(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  scroll: number,
  palette: RunnerPalette,
  scale: number,
) {
  const cloudScale = Math.max(2, scale - 1);
  for (let index = 0; index < 3; index += 1) {
    const drift = (scroll * 0.22 + index * 240) % (metrics.frame.width + 160);
    const x = metrics.frame.x + metrics.frame.width - drift;
    const y = metrics.frame.y + metrics.frame.height * (0.12 + hashUnit(index + 4) * 0.18);
    blitSprite(context, SPRITE_CLOUD, x, y, cloudScale, palette, false);
  }
}

function drawNightSky(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  scale: number,
  time: number,
  reducedMotion: boolean,
) {
  blitSprite(
    context,
    SPRITE_MOON,
    metrics.frame.x + metrics.frame.width * 0.78,
    metrics.frame.y + metrics.frame.height * 0.12,
    Math.max(2, scale),
    palette,
    true,
  );
  context.fillStyle = palette.ink;
  const count = reducedMotion ? 10 : 18;
  for (let index = 0; index < count; index += 1) {
    const x = metrics.frame.x + hashUnit(index + 9) * metrics.frame.width;
    const y = metrics.frame.y + hashUnit(index + 21) * metrics.frame.height * 0.42;
    const twinkle = reducedMotion ? 1 : 0.35 + (Math.sin(time * 1.7 + index) + 1) * 0.35;
    context.globalAlpha = twinkle;
    context.fillRect(Math.round(x / scale) * scale, Math.round(y / scale) * scale, scale, scale);
  }
  context.globalAlpha = 1;
}

function drawPickupItem(
  context: CanvasRenderingContext2D,
  pickup: RunnerPickup,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  time: number,
  reducedMotion: boolean,
) {
  const sprite = pickup.kind === "heart" ? SPRITE_HEART : pickup.kind === "letter" ? SPRITE_LETTER : SPRITE_PETAL;
  const worldWidth = pickup.width * metrics.bodyUnit;
  const worldHeight = pickup.height * metrics.standingHeight;
  const itemScale = spriteFitScale(sprite, worldWidth, worldHeight, true);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * itemScale;
  const drawH = rows.length * itemScale;
  const bob = reducedMotion ? 0 : Math.round(Math.sin(time * 4 + pickup.id) * itemScale);
  const x = snapToScale(worldX(metrics, pickup.x + pickup.width / 2) - drawW / 2, itemScale);
  const y = snapToScale(worldY(metrics, pickup.bottom + pickup.height) - bob, itemScale);
  blitSprite(context, sprite, x, y, itemScale, palette, true);
}

function drawObstacleShape(
  context: CanvasRenderingContext2D,
  obstacle: RunnerObstacle,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
  elapsed: number,
) {
  const sprite = obstacleSprite(obstacle.kind, elapsed);
  const worldWidth = obstacle.width * metrics.bodyUnit;
  const worldHeight = obstacle.height * metrics.standingHeight;
  const itemScale = spriteFitScale(sprite, worldWidth, worldHeight, true);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * itemScale;
  const drawH = rows.length * itemScale;
  const x = snapToScale(worldX(metrics, obstacle.x + obstacle.width / 2) - drawW / 2, itemScale);
  const y = snapToScale(worldY(metrics, obstacle.bottom) - drawH, itemScale);
  blitSprite(context, sprite, x, y, itemScale, palette, true);
}

function drawPuppyPixels(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  pose: PuppyPose,
  palette: RunnerPalette,
  scale: number,
  reducedMotion: boolean,
) {
  if (state.invincibleFor > 0 && !reducedMotion && Math.floor(state.elapsed * 16) % 2 === 0) return;
  const sprite = puppySprite(state, pose);
  const rows = withOutline(sprite);
  const drawW = rows[0].length * scale;
  const drawH = rows.length * scale;
  const core = unionBoxes(playerBoxes(state));
  const x = snapToScale(worldX(metrics, core.x + core.width / 2) - drawW / 2, scale);
  const y = snapToScale(worldY(metrics, core.bottom) - drawH, scale);
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

function drawPopups(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  palette: RunnerPalette,
) {
  context.save();
  context.font = `700 ${Math.max(11, Math.round(metrics.standingHeight * 0.11))}px ui-monospace, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = palette.ink;
  for (const popup of state.popups) {
    context.globalAlpha = Math.max(0, 1 - popup.age / 0.7);
    context.fillText(popup.text, Math.round(worldX(metrics, popup.x)), Math.round(worldY(metrics, popup.y)));
  }
  context.restore();
}

export const OBSTACLE_KINDS: RunnerObstacleKind[] = ["rock", "stump", "log", "bramble", "bird"];

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
) {
  const palette = CHAPTER_PALETTE[state.chapter];
  const scale = pixelScale(metrics);
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  context.save();
  context.beginPath();
  context.rect(metrics.frame.x, metrics.frame.y, metrics.frame.width, metrics.frame.height);
  context.clip();
  context.imageSmoothingEnabled = false;
  context.fillStyle = palette.paper;
  context.fillRect(metrics.frame.x, metrics.frame.y, metrics.frame.width, metrics.frame.height);

  const scroll = state.status === "playing" || state.status === "paused"
    ? state.distance * metrics.bodyUnit
    : reducedMotion
      ? 0
      : renderTime * 18;

  if (state.chapter === "night") {
    drawNightSky(context, metrics, palette, scale, renderTime, reducedMotion);
  } else {
    drawClouds(context, metrics, scroll, palette, scale);
  }
  drawHorizon(context, metrics, scroll, palette, scale, state.chapter);

  for (const pickup of state.pickups) {
    drawPickupItem(context, pickup, metrics, palette, renderTime, reducedMotion);
  }
  for (const obstacle of state.obstacles) {
    drawObstacleShape(context, obstacle, metrics, palette, state.elapsed);
  }
  drawLandingDust(context, state, metrics, palette, scale);
  drawPuppyPixels(
    context,
    state,
    metrics,
    puppyPose(state, renderTime, celebrating, reducedMotion),
    palette,
    scale,
    reducedMotion,
  );
  drawPopups(context, state, metrics, palette);
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
