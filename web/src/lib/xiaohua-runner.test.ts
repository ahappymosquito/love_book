// Unit coverage for responsive metrics, device-specific input mapping, logical-unit physics, collisions, scoring, and fair difficulty phases.

import { describe, expect, it } from "vitest";
import {
  RUNNER_AIRTIME,
  RUNNER_JUMP_APEX,
  RUNNER_MAX_SPEED,
  createRunnerMetrics,
  createRunnerState,
  runnerPointerAction,
  generateObstacleGroup,
  jumpRunner,
  pauseRunner,
  runnerCollides,
  runnerScore,
  runnerSpeed,
  setRunnerCrouch,
  startRunner,
  stepRunner,
  type RunnerObstacle,
  type RunnerState,
} from "./xiaohua-runner";

describe("Xiaohua runner pointer mapping", () => {
  const bounds = { left: 0, width: 430 };

  it("uses left hold for crouch and right tap for jump on touch screens", () => {
    expect(runnerPointerAction({ pointerType: "touch", button: 0, clientX: 100, bounds })).toBe("crouch");
    expect(runnerPointerAction({ pointerType: "touch", button: 0, clientX: 330, bounds })).toBe("jump");
  });

  it("uses mouse buttons independently of screen position on desktop", () => {
    expect(runnerPointerAction({ pointerType: "mouse", button: 0, clientX: 400, bounds })).toBe("jump");
    expect(runnerPointerAction({ pointerType: "mouse", button: 2, clientX: 20, bounds })).toBe("crouch");
  });
});

const safePlayingState = (): RunnerState => ({
  ...startRunner(createRunnerState()),
  nextSpawnIn: 10_000,
});

function obstacle(overrides: Partial<RunnerObstacle>): RunnerObstacle {
  return {
    id: 1,
    groupId: 1,
    x: 1,
    width: 0.62,
    height: 0.47,
    bottom: 0,
    kind: "rock",
    requirement: "jump",
    ...overrides,
  };
}

describe("Xiaohua runner metrics", () => {
  it("fills the complete desktop viewport instead of letterboxing", () => {
    const metrics = createRunnerMetrics({ width: 2048, height: 1024 });
    expect(metrics.orientation).toBe("landscape");
    expect(metrics.frame).toEqual({ x: 0, y: 0, width: 2048, height: 1024 });
    expect(metrics.standingHeight).toBe(180);
  });

  it("fills the complete portrait viewport without side gutters", () => {
    const metrics = createRunnerMetrics({ width: 430, height: 932 });
    expect(metrics.orientation).toBe("portrait");
    expect(metrics.frame).toEqual({ x: 0, y: 0, width: 430, height: 932 });
    expect(metrics.standingHeight).toBeCloseTo(135.14, 1);
  });

  it("keeps landscape mobile Xiaohua within the 96px minimum", () => {
    expect(createRunnerMetrics({ width: 932, height: 430 }).standingHeight).toBe(96);
  });
});

describe("Xiaohua runner physics and input", () => {
  it("starts, pauses, and resumes without losing progress", () => {
    const playing = stepRunner(safePlayingState(), 1 / 60, 4);
    const paused = pauseRunner(playing);
    expect(stepRunner(paused, 1, 4)).toEqual(paused);
    expect(startRunner(paused).status).toBe("playing");
    expect(startRunner(paused).distance).toBe(playing.distance);
  });

  it("reaches a 1.45-height apex and lands in about 0.88 seconds", () => {
    let state = jumpRunner(safePlayingState());
    let maximum = 0;
    let elapsed = 0;
    while ((state.y > 0 || elapsed === 0) && elapsed < 2) {
      state = stepRunner(state, 1 / 600, 4);
      elapsed += 1 / 600;
      maximum = Math.max(maximum, state.y);
    }
    expect(maximum).toBeCloseTo(RUNNER_JUMP_APEX, 2);
    expect(elapsed).toBeCloseTo(RUNNER_AIRTIME, 2);
    expect(state.y).toBe(0);
  });

  it("holds crouch, releases it, and restores held crouch after landing", () => {
    let state = setRunnerCrouch(safePlayingState(), true);
    expect(state.crouching).toBe(true);
    state = jumpRunner(state);
    expect(state.crouching).toBe(false);
    for (let index = 0; index < 70; index += 1) state = stepRunner(state, 1 / 60, 4);
    expect(state.y).toBe(0);
    expect(state.crouching).toBe(true);
    expect(setRunnerCrouch(state, false).crouching).toBe(false);
  });

  it("uses the same score at the same elapsed time across viewport metrics", () => {
    let portrait = safePlayingState();
    let desktop = safePlayingState();
    const portraitWidth = createRunnerMetrics({ width: 430, height: 932 }).worldWidth;
    const desktopWidth = createRunnerMetrics({ width: 2048, height: 1024 }).worldWidth;
    for (let index = 0; index < 600; index += 1) {
      portrait = stepRunner(portrait, 1 / 60, portraitWidth);
      desktop = stepRunner(desktop, 1 / 60, desktopWidth);
    }
    expect(portrait.score).toBe(desktop.score);
    expect(portrait.distance).toBeCloseTo(desktop.distance, 8);
  });

  it("caps logical speed and derives stable score from logical distance", () => {
    expect(runnerSpeed(999)).toBe(RUNNER_MAX_SPEED);
    expect(runnerScore(31.49)).toBe(99);
    expect(runnerScore(31.5)).toBe(100);
  });
});

describe("Xiaohua runner collisions", () => {
  it("clears every ground obstacle above its hitbox", () => {
    for (const kind of ["rock", "stump", "log", "bramble"] as const) {
      const state = { ...safePlayingState(), y: 0.8, velocityY: 0 };
      expect(runnerCollides(state, obstacle({ kind }))).toBe(false);
    }
  });

  it("requires crouching for a bird and jumping for ground obstacles", () => {
    const bird = obstacle({ kind: "bird", requirement: "crouch", width: 0.94, height: 0.37, bottom: 0.53 });
    expect(runnerCollides(safePlayingState(), bird)).toBe(true);
    expect(runnerCollides({ ...safePlayingState(), crouching: true }, bird)).toBe(false);
    expect(runnerCollides({ ...safePlayingState(), y: 0.9 }, bird)).toBe(false);
    expect(runnerCollides({ ...safePlayingState(), crouching: true }, obstacle({}))).toBe(true);
  });
});

describe("Xiaohua runner obstacle generation", () => {
  it("only emits jump obstacles before the bird speed gate", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const group = generateObstacleGroup(17.99, 3.2, 1, 1, () => (seed % 97) / 97);
      expect(group.obstacles).toHaveLength(1);
      expect(group.obstacles[0].requirement).toBe("jump");
    }
  });

  it("does not emit double obstacles before 40 seconds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const values = [0, (seed % 97) / 97, 0];
      const group = generateObstacleGroup(39.99, 3.7, 1, 1, () => values.shift() ?? 0);
      expect(group.obstacles).toHaveLength(1);
    }
  });

  it("gives late double obstacles a full action window and opposite actions", () => {
    const values = [0, 0, 0, 0, 0];
    const group = generateObstacleGroup(60, 4, 1, 1, () => values.shift() ?? 0);
    expect(group.obstacles).toHaveLength(2);
    expect(group.obstacles[1].x - group.obstacles[0].x).toBeCloseTo(4 * 1.08, 8);
    expect(new Set(group.obstacles.map((item) => item.requirement)).size).toBe(2);
    expect(group.nextSpawnIn).toBeGreaterThan(group.obstacles[1].x - group.obstacles[0].x + group.obstacles[1].width * 4 + 1.25 - 0.001);
  });

  it("keeps thousands of seeded late groups solvable", () => {
    let doubleGroups = 0;
    for (let seed = 1; seed <= 2_000; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 1_664_525 + 1_013_904_223) >>> 0;
        return value / 2 ** 32;
      };
      const speed = 3 + (seed % 9) * 0.15;
      const group = generateObstacleGroup(60, speed, 1, 1, random);
      if (group.obstacles.length !== 2) continue;
      doubleGroups += 1;
      const [first, second] = group.obstacles;
      expect(second.x - first.x).toBeGreaterThanOrEqual(speed * 1.08 - 1e-8);
      expect(first.requirement).not.toBe(second.requirement);
      expect(group.nextSpawnIn - (second.x - first.x)).toBeGreaterThanOrEqual(second.width + second.width * speed + 1.25 - 1e-8);
    }
    expect(doubleGroups).toBeGreaterThan(20);
  });

  it("suppresses a third identical obstacle like Chrome's duplication history", () => {
    const group = generateObstacleGroup(30, 3.8, 1, 1, () => 0, ["rock", "rock"]);
    expect(group.obstacles[0].kind).not.toBe("rock");
  });
});
