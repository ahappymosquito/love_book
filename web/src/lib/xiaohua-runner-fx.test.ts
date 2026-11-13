// 覆盖花田拾光粒子池容量上限、种子可复现、起跳/落地/拾取/受击的差分发射、减弱动效降量、暂停冻结，以及环境花瓣、星星和流星的纯函数定位。

import { describe, expect, it } from "vitest";
import { createRunnerState, jumpRunner, startRunner, stepRunner, type RunnerState } from "./xiaohua-runner";
import {
  FX_DUST,
  FX_SHARD,
  FX_SPARKLE,
  RUNNER_FX_CAPACITY,
  RUNNER_FX_REDUCED_CAPACITY,
  RUNNER_FX_SHIELD,
  SHOOTING_STAR_PERIOD,
  ambientPetal,
  ambientStar,
  createRunnerFx,
  emitParticle,
  fxRandom,
  shootingStar,
  stepRunnerFx,
  type AmbientPoint,
} from "./xiaohua-runner-fx";

const STEP = 1 / 60;

function playing(overrides: Partial<RunnerState> = {}): RunnerState {
  return { ...startRunner(createRunnerState()), nextSpawnIn: 10_000, ...overrides };
}

function point(): AmbientPoint {
  return { x: 0, y: 0, alpha: 0, frame: 0 };
}

function kinds(fx: ReturnType<typeof createRunnerFx>): number[] {
  return Array.from(fx.kind.subarray(0, fx.count));
}

describe("runner particle pool", () => {
  it("never grows past its capacity", () => {
    const fx = createRunnerFx(3);
    for (let index = 0; index < RUNNER_FX_CAPACITY * 3; index += 1) {
      emitParticle(fx, RUNNER_FX_CAPACITY, FX_SPARKLE, 0, 1, 1, 0, 0, 1, 0);
    }
    expect(fx.count).toBe(RUNNER_FX_CAPACITY);
    const reduced = createRunnerFx(3);
    for (let index = 0; index < 100; index += 1) emitParticle(reduced, RUNNER_FX_REDUCED_CAPACITY, FX_DUST, 0, 1, 0, 0, 0, 1, 0);
    expect(reduced.count).toBe(RUNNER_FX_REDUCED_CAPACITY);
  });

  it("replays the same random stream for the same seed", () => {
    const left = createRunnerFx(42);
    const right = createRunnerFx(42);
    const other = createRunnerFx(43);
    const a = Array.from({ length: 8 }, () => fxRandom(left));
    const b = Array.from({ length: 8 }, () => fxRandom(right));
    expect(a).toEqual(b);
    expect(a).not.toEqual(Array.from({ length: 8 }, () => fxRandom(other)));
    for (const value of a) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("expires particles after their life and keeps the pool compact", () => {
    const fx = createRunnerFx(1);
    const state = playing({ status: "gameover" });
    emitParticle(fx, RUNNER_FX_CAPACITY, FX_SPARKLE, 0, 1, 1, 0, 0, 0.1, 0);
    emitParticle(fx, RUNNER_FX_CAPACITY, FX_SHARD, 0, 1, 1, 0, 0, 1, 0);
    for (let index = 0; index < 10; index += 1) stepRunnerFx(fx, state, state, STEP, false);
    expect(kinds(fx)).toEqual([FX_SHARD]);
  });

  it("freezes particles while paused", () => {
    const fx = createRunnerFx(1);
    const paused = playing({ status: "paused" });
    emitParticle(fx, RUNNER_FX_CAPACITY, FX_SPARKLE, 0, 1, 1, 1, 1, 0.1, 0);
    for (let index = 0; index < 30; index += 1) stepRunnerFx(fx, paused, paused, STEP, false);
    expect(fx.count).toBe(1);
    expect(fx.x[0]).toBe(1);
    expect(fx.time).toBe(0);
  });

  it("puffs dust when jumping off the ground and again on landing", () => {
    const fx = createRunnerFx(5);
    let state = playing();
    state = jumpRunner(state);
    let previous = state;
    state = stepRunner(previous, STEP, 10, () => 0.5);
    stepRunnerFx(fx, previous, state, STEP, false);
    const takeoff = kinds(fx).filter((kind) => kind === FX_DUST).length;
    expect(takeoff).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < 60 && state.y > 0; index += 1) {
      previous = state;
      state = stepRunner(previous, STEP, 10, () => 0.5);
      stepRunnerFx(fx, previous, state, STEP, false);
    }
    expect(state.y).toBe(0);
    expect(fx.count).toBeGreaterThan(0);
    expect(kinds(fx).every((kind) => kind === FX_DUST)).toBe(true);
  });

  it("bursts sparkles when a pickup is collected", () => {
    const fx = createRunnerFx(7);
    const previous = playing({ pickups: [{ id: 1, kind: "petal", x: 0.95, width: 0.34, height: 0.34, bottom: 0.3 }] });
    const next = stepRunner(previous, STEP, 10, () => 0.5);
    expect(next.petals).toBe(1);
    stepRunnerFx(fx, previous, next, STEP, true);
    expect(kinds(fx).filter((kind) => kind === FX_SPARKLE).length).toBeGreaterThanOrEqual(3);
  });

  it("flashes, shakes and raises a heart shield when a heart absorbs a hit", () => {
    const fx = createRunnerFx(9);
    const previous = playing({ lives: 2, obstacles: [{ id: 1, groupId: 1, kind: "rock", x: 0.9, width: 0.78, height: 0.57, bottom: 0, requirement: "jump" }] });
    const next = stepRunner(previous, STEP, 10, () => 0.5);
    expect(next.lives).toBe(1);
    stepRunnerFx(fx, previous, next, STEP, false);
    expect(fx.flash).toBeGreaterThan(0);
    expect(fx.shake).toBeGreaterThan(0);
    expect(fx.shield).toBeGreaterThan(RUNNER_FX_SHIELD - STEP * 2);
    expect(kinds(fx)).toContain(FX_SHARD);
  });

  it("skips flash and shake under reduced motion but keeps the shield", () => {
    const fx = createRunnerFx(9);
    const previous = playing({ lives: 2, obstacles: [{ id: 1, groupId: 1, kind: "rock", x: 0.9, width: 0.78, height: 0.57, bottom: 0, requirement: "jump" }] });
    const next = stepRunner(previous, STEP, 10, () => 0.5);
    stepRunnerFx(fx, previous, next, STEP, true);
    expect(fx.flash).toBe(0);
    expect(fx.shake).toBe(0);
    expect(fx.shield).toBeGreaterThan(0);
    expect(fx.count).toBeLessThanOrEqual(RUNNER_FX_REDUCED_CAPACITY);
  });

  it("produces the same particles for the same seed and inputs", () => {
    const run = () => {
      const fx = createRunnerFx(11);
      let state = jumpRunner(playing());
      for (let index = 0; index < 50; index += 1) {
        const previous = state;
        state = stepRunner(previous, STEP, 10, () => 0.5);
        stepRunnerFx(fx, previous, state, STEP, false);
      }
      return Array.from(fx.x.subarray(0, fx.count));
    };
    expect(run()).toEqual(run());
  });
});

describe("runner ambient motion", () => {
  it("keeps drifting petals inside the sky band", () => {
    for (let index = 0; index < 18; index += 1) {
      for (const time of [0, 3.3, 41.7]) {
        const petal = ambientPetal(index, time, 400, 700, 1200, point());
        expect(petal.x).toBeGreaterThanOrEqual(-20);
        expect(petal.x).toBeLessThanOrEqual(420);
        expect(petal.y).toBeGreaterThanOrEqual(0);
        expect(petal.y).toBeLessThanOrEqual(700);
      }
    }
  });

  it("places stars deterministically with gentle twinkle", () => {
    const first = ambientStar(4, 2, 400, 300, point());
    const again = ambientStar(4, 2, 400, 300, point());
    expect(again).toEqual(first);
    expect(first.alpha).toBeGreaterThanOrEqual(0.45);
    expect(first.alpha).toBeLessThanOrEqual(1);
  });

  it("only shows a shooting star briefly inside some windows", () => {
    let active = 0;
    for (let window = 0; window < 40; window += 1) {
      if (shootingStar(window * SHOOTING_STAR_PERIOD + 0.4, point())) active += 1;
      expect(shootingStar(window * SHOOTING_STAR_PERIOD + 3, point())).toBe(false);
    }
    expect(active).toBeGreaterThan(5);
    expect(active).toBeLessThan(35);
  });
});
