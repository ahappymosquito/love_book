// Unit coverage for responsive metrics, logical-unit physics, crouch input, collisions, scoring, and fair difficulty phases.

import { describe, expect, it } from "vitest";
import {
  RUNNER_AIRTIME,
  RUNNER_JUMP_APEX,
  RUNNER_MAX_SPEED,
  createRunnerMetrics,
  createRunnerState,
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
  it("centers a capped 16:9 stage on ultrawide screens", () => {
    const metrics = createRunnerMetrics({ width: 2048, height: 1024 });
    expect(metrics.orientation).toBe("landscape");
    expect(metrics.frame).toEqual({ x: 304, y: 107, width: 1440, height: 810 });
    expect(metrics.standingHeight).toBeCloseTo(160.38, 1);
  });

  it("uses a centered 3:4 stage with portrait safe gutters", () => {
    const metrics = createRunnerMetrics({ width: 430, height: 932 });
    expect(metrics.orientation).toBe("portrait");
    expect(metrics.frame.width).toBe(414);
    expect(metrics.frame.height).toBe(552);
    expect(metrics.frame.x).toBe(8);
    expect(metrics.standingHeight).toBeCloseTo(115.92, 1);
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
    expect(runnerScore(29.99)).toBe(99);
    expect(runnerScore(30)).toBe(100);
  });
});

describe("Xiaohua runner collisions", () => {
  it("clears every ground obstacle above its hitbox", () => {
    for (const kind of ["rock", "stump", "log", "puddle"] as const) {
      const state = { ...safePlayingState(), y: 0.7, velocityY: 0 };
      expect(runnerCollides(state, obstacle({ kind }))).toBe(false);
    }
  });

  it("requires crouching for a bird and jumping for ground obstacles", () => {
    const bird = obstacle({ kind: "bird", requirement: "crouch", width: 0.92, height: 0.43, bottom: 0.53 });
    expect(runnerCollides(safePlayingState(), bird)).toBe(true);
    expect(runnerCollides({ ...safePlayingState(), crouching: true }, bird)).toBe(false);
    expect(runnerCollides({ ...safePlayingState(), y: 0.8 }, bird)).toBe(true);
    expect(runnerCollides({ ...safePlayingState(), crouching: true }, obstacle({}))).toBe(true);
  });
});

describe("Xiaohua runner obstacle generation", () => {
  it("only emits jump obstacles before 20 seconds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const group = generateObstacleGroup(19.99, 3, 1, 1, () => (seed % 97) / 97);
      expect(group.obstacles).toHaveLength(1);
      expect(group.obstacles[0].requirement).toBe("jump");
    }
  });

  it("does not emit double obstacles before 45 seconds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const values = [0, (seed % 97) / 97, 0];
      const group = generateObstacleGroup(44.99, 3.4, 1, 1, () => values.shift() ?? 0);
      expect(group.obstacles).toHaveLength(1);
    }
  });

  it("gives late double obstacles a full action window and opposite actions", () => {
    const values = [0.5, 0, 0, 0];
    const group = generateObstacleGroup(60, 4, 1, 1, () => values.shift() ?? 0);
    expect(group.obstacles).toHaveLength(2);
    expect(group.obstacles[1].x - group.obstacles[0].x).toBeCloseTo(4 * 1.18, 8);
    expect(new Set(group.obstacles.map((item) => item.requirement)).size).toBe(2);
    expect(group.nextSpawnIn).toBeGreaterThan((group.obstacles[1].x - group.obstacles[0].x) + 4 * 1.35 - 0.001);
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
      expect(second.x - first.x).toBeGreaterThanOrEqual(speed * 1.18 - 1e-8);
      expect(first.requirement).not.toBe(second.requirement);
      expect(group.nextSpawnIn - (second.x - first.x)).toBeGreaterThanOrEqual(speed * 1.35 - 1e-8);
    }
    expect(doubleGroups).toBeGreaterThan(500);
  });
});
