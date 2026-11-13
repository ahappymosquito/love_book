// 花田拾光粒子与环境光：固定容量 TypedArray 粒子池在固定步进内按状态差分发射（起跳/落地/脚步尘土、二段跳与拾取闪光、受击碎心、心盾、闪白与轻震、连击提示），种子随机可复现；环境花瓣、萤火、星星与流星按时间和序号纯函数定位，减弱动效时降量或静止。

import { RUNNER_DOUBLE_JUMP_START, RUNNER_PLAYER_X, type RunnerPickupKind, type RunnerState } from "./xiaohua-runner";
import { hashUnit } from "./xiaohua-runner-sky";

export const RUNNER_FX_CAPACITY = 96;
export const RUNNER_FX_REDUCED_CAPACITY = 24;
export const RUNNER_FX_FLASH = 0.14;
export const RUNNER_FX_SHAKE = 0.24;
export const RUNNER_FX_SHIELD = 0.55;
export const RUNNER_FX_COMBO = 0.9;

export const FX_DUST = 0;
export const FX_SPARKLE = 1;
export const FX_SHARD = 2;

export const FX_TONE_INK = 0;
export const FX_TONE_ACCENT = 1;
export const FX_TONE_PEACH = 2;
export const FX_TONE_CREAM = 3;

const KIND_DRIFT = [0.92, 0.35, 0.6] as const;
const KIND_DRAG = [3.2, 1.6, 0.8] as const;

export interface RunnerFx {
  count: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  age: Float32Array;
  life: Float32Array;
  gravity: Float32Array;
  kind: Uint8Array;
  tone: Uint8Array;
  seed: number;
  time: number;
  flash: number;
  shake: number;
  shield: number;
  comboValue: number;
  comboAge: number;
  stepDust: number;
  lastVelocityY: number;
}

export interface AmbientPoint {
  x: number;
  y: number;
  alpha: number;
  frame: number;
}

export function createRunnerFx(seed = 1): RunnerFx {
  return {
    count: 0,
    x: new Float32Array(RUNNER_FX_CAPACITY),
    y: new Float32Array(RUNNER_FX_CAPACITY),
    vx: new Float32Array(RUNNER_FX_CAPACITY),
    vy: new Float32Array(RUNNER_FX_CAPACITY),
    age: new Float32Array(RUNNER_FX_CAPACITY),
    life: new Float32Array(RUNNER_FX_CAPACITY),
    gravity: new Float32Array(RUNNER_FX_CAPACITY),
    kind: new Uint8Array(RUNNER_FX_CAPACITY),
    tone: new Uint8Array(RUNNER_FX_CAPACITY),
    seed: seed | 0,
    time: 0,
    flash: 0,
    shake: 0,
    shield: 0,
    comboValue: 0,
    comboAge: RUNNER_FX_COMBO,
    stepDust: 0.2,
    lastVelocityY: 0,
  };
}

export function fxRandom(fx: RunnerFx): number {
  fx.seed = (fx.seed + 0x6d2b79f5) | 0;
  let t = fx.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function emitParticle(
  fx: RunnerFx,
  capacity: number,
  kind: number,
  tone: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  gravity: number,
): boolean {
  if (fx.count >= Math.min(capacity, RUNNER_FX_CAPACITY)) return false;
  const index = fx.count;
  fx.x[index] = x;
  fx.y[index] = y;
  fx.vx[index] = vx;
  fx.vy[index] = vy;
  fx.age[index] = 0;
  fx.life[index] = life;
  fx.gravity[index] = gravity;
  fx.kind[index] = kind;
  fx.tone[index] = tone;
  fx.count += 1;
  return true;
}

function emitBurst(fx: RunnerFx, capacity: number, count: number, kind: number, tones: readonly number[], x: number, y: number, speed: number, life: number, gravity: number) {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + fxRandom(fx) * 0.6;
    const power = speed * (0.55 + fxRandom(fx) * 0.45);
    const tone = tones[index % tones.length];
    emitParticle(fx, capacity, kind, tone, x, y, Math.cos(angle) * power, Math.sin(angle) * power, life * (0.75 + fxRandom(fx) * 0.25), gravity);
  }
}

function emitDust(fx: RunnerFx, capacity: number, count: number, x: number, spread: number) {
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    emitParticle(
      fx,
      capacity,
      FX_DUST,
      FX_TONE_INK,
      x + side * spread * fxRandom(fx),
      0.02,
      side * (0.6 + fxRandom(fx) * 0.9),
      0.25 + fxRandom(fx) * 0.45,
      0.32 + fxRandom(fx) * 0.12,
      1.4,
    );
  }
}

const PICKUP_TONES: Record<RunnerPickupKind, readonly number[]> = {
  petal: [FX_TONE_ACCENT, FX_TONE_PEACH, FX_TONE_CREAM],
  heart: [FX_TONE_ACCENT, FX_TONE_CREAM],
  letter: [FX_TONE_PEACH, FX_TONE_CREAM, FX_TONE_ACCENT],
};
const SHARD_TONES = [FX_TONE_ACCENT, FX_TONE_PEACH] as const;
const RING_TONES = [FX_TONE_CREAM, FX_TONE_PEACH] as const;

function pickupStillPresent(next: RunnerState, id: number): boolean {
  for (const pickup of next.pickups) if (pickup.id === id) return true;
  return false;
}

export function stepRunnerFx(fx: RunnerFx, previous: RunnerState, next: RunnerState, dt: number, reducedMotion: boolean): RunnerFx {
  const capacity = reducedMotion ? RUNNER_FX_REDUCED_CAPACITY : RUNNER_FX_CAPACITY;
  const quiet = reducedMotion ? 0 : 1;
  const feetX = RUNNER_PLAYER_X + 0.45;

  if (previous.status === "playing") {
    if (previous.velocityY > fx.lastVelocityY + 0.5) {
      if (previous.y <= 0.001) emitDust(fx, capacity, reducedMotion ? 1 : 4, feetX, 0.2);
      else emitBurst(fx, capacity, reducedMotion ? 3 : 7, FX_SPARKLE, RING_TONES, feetX, previous.y + 0.1, 1.4, 0.34, 0);
    }
    if (previous.y > 0.001 && next.y <= 0.001) emitDust(fx, capacity, reducedMotion ? 2 : 6, feetX, 0.3);
    if (next.status === "playing" && next.y <= 0.001 && !next.crouching && quiet) {
      fx.stepDust -= dt;
      if (fx.stepDust <= 0) {
        fx.stepDust = 0.18 + fxRandom(fx) * 0.12;
        emitParticle(fx, capacity, FX_DUST, FX_TONE_INK, RUNNER_PLAYER_X + 0.28, 0.02, -0.5 - fxRandom(fx) * 0.4, 0.2 + fxRandom(fx) * 0.25, 0.26, 1.2);
      }
    }
    for (const pickup of previous.pickups) {
      if (pickupStillPresent(next, pickup.id)) continue;
      if (pickup.x + pickup.width - next.speed * dt <= -0.5) continue;
      emitBurst(
        fx,
        capacity,
        reducedMotion ? 3 : 9,
        FX_SPARKLE,
        PICKUP_TONES[pickup.kind],
        pickup.x + pickup.width / 2,
        pickup.bottom + pickup.height / 2,
        pickup.kind === "letter" ? 2.2 : 1.8,
        0.5,
        0.8,
      );
    }
    if (next.combo > previous.combo && next.combo >= 3) {
      fx.comboValue = next.combo;
      fx.comboAge = 0;
    }
    if (previous.elapsed < RUNNER_DOUBLE_JUMP_START && next.elapsed >= RUNNER_DOUBLE_JUMP_START) {
      emitBurst(fx, capacity, reducedMotion ? 4 : 12, FX_SPARKLE, RING_TONES, RUNNER_PLAYER_X + 0.45, next.y + 0.55, 1.6, 0.7, 0);
    }
    if (next.lives < previous.lives) {
      fx.flash = RUNNER_FX_FLASH * quiet;
      fx.shake = RUNNER_FX_SHAKE * quiet;
      fx.comboAge = RUNNER_FX_COMBO;
      if (next.lives > 0) fx.shield = RUNNER_FX_SHIELD;
      emitBurst(fx, capacity, reducedMotion ? 3 : 8, FX_SHARD, SHARD_TONES, RUNNER_PLAYER_X + 0.6, next.y + 0.75, 2.2, 0.7, 5);
    }
  }
  fx.lastVelocityY = next.velocityY;

  if (next.status !== "playing" && next.status !== "gameover") return fx;
  const scrolling = next.status === "playing" ? next.speed : 0;
  fx.time += dt;
  fx.flash = Math.max(0, fx.flash - dt);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.shield = Math.max(0, fx.shield - dt);
  fx.comboAge = Math.min(RUNNER_FX_COMBO, fx.comboAge + dt);
  for (let index = 0; index < fx.count; index += 1) {
    const age = fx.age[index] + dt;
    if (age >= fx.life[index]) {
      const last = fx.count - 1;
      fx.x[index] = fx.x[last];
      fx.y[index] = fx.y[last];
      fx.vx[index] = fx.vx[last];
      fx.vy[index] = fx.vy[last];
      fx.age[index] = fx.age[last];
      fx.life[index] = fx.life[last];
      fx.gravity[index] = fx.gravity[last];
      fx.kind[index] = fx.kind[last];
      fx.tone[index] = fx.tone[last];
      fx.count = last;
      index -= 1;
      continue;
    }
    const kind = fx.kind[index];
    const drag = Math.max(0, 1 - KIND_DRAG[kind] * dt);
    fx.age[index] = age;
    fx.vx[index] *= drag;
    fx.vy[index] -= fx.gravity[index] * dt;
    fx.x[index] += (fx.vx[index] - KIND_DRIFT[kind] * scrolling) * dt;
    fx.y[index] = Math.max(0, fx.y[index] + fx.vy[index] * dt);
  }
  return fx;
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

export function ambientPetal(index: number, time: number, width: number, height: number, scroll: number, out: AmbientPoint): AmbientPoint {
  const a = hashUnit(index * 7.13 + 1);
  const b = hashUnit(index * 3.71 + 5);
  const c = hashUnit(index * 5.29 + 11);
  const d = hashUnit(index * 9.17 + 17);
  const span = width + 40;
  out.x = wrap(a * span - time * (14 + b * 22) - scroll * 0.35, span) - 20;
  out.y = wrap(d * height + time * (9 + c * 14) + Math.sin(time * (0.8 + b) + index) * 12, height);
  out.alpha = 0.5 + d * 0.4;
  out.frame = Math.sin(time * (2 + c * 2) + index) > 0 ? 0 : 1;
  return out;
}

export function ambientFirefly(index: number, time: number, width: number, top: number, bandHeight: number, scroll: number, out: AmbientPoint): AmbientPoint {
  const a = hashUnit(index * 4.31 + 3);
  const b = hashUnit(index * 6.07 + 7);
  const c = hashUnit(index * 2.93 + 13);
  const d = hashUnit(index * 8.41 + 19);
  out.x = wrap(a * width - scroll * 0.5 + Math.sin(time * 0.6 * (0.5 + b) + index * 2) * 28, width);
  out.y = top + c * bandHeight + Math.sin(time * (0.9 + d) + index) * 14;
  const pulse = (Math.sin(time * (1.3 + b * 1.6) + index * 1.7) + 1) / 2;
  out.alpha = pulse * pulse;
  out.frame = pulse > 0.7 ? 1 : 0;
  return out;
}

export function ambientStar(index: number, time: number, width: number, height: number, out: AmbientPoint): AmbientPoint {
  out.x = hashUnit(index * 1.37 + 9) * width;
  out.y = hashUnit(index * 2.11 + 21) * height;
  out.alpha = 0.45 + 0.55 * ((Math.sin(time * (0.8 + hashUnit(index * 3.3 + 2) * 1.8) + index * 2.3) + 1) / 2);
  out.frame = hashUnit(index * 4.9 + 31) > 0.84 ? 1 : 0;
  return out;
}

export const SHOOTING_STAR_PERIOD = 7;
export const SHOOTING_STAR_DURATION = 0.9;

export function shootingStar(time: number, out: AmbientPoint): boolean {
  const window = Math.floor(time / SHOOTING_STAR_PERIOD);
  const local = time - window * SHOOTING_STAR_PERIOD;
  if (hashUnit(window * 13.7 + 2) > 0.5 || local > SHOOTING_STAR_DURATION) return false;
  const progress = local / SHOOTING_STAR_DURATION;
  out.x = 0.45 + hashUnit(window * 5.1 + 1) * 0.5 - progress * 0.28;
  out.y = 0.05 + hashUnit(window * 9.3 + 4) * 0.22 + progress * 0.14;
  out.alpha = Math.sin(progress * Math.PI);
  out.frame = progress;
  return true;
}
