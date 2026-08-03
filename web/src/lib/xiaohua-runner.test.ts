// Unit coverage for fixed-step movement, jumping, collision, pause, scoring, and speed caps.

import { describe, expect, it } from "vitest";
import {
  RUNNER_MAX_SPEED,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  runnerScore,
  runnerSpeed,
  startRunner,
  stepRunner,
  type RunnerState,
} from "./xiaohua-runner";

describe("Xiaohua runner engine", () => {
  it("starts, pauses, and resumes without losing progress", () => {
    const playing = stepRunner(startRunner(createRunnerState()), 1 / 60, 430, () => 0.5);
    const paused = pauseRunner(playing);
    expect(stepRunner(paused, 1, 430)).toEqual(paused);
    expect(startRunner(paused).status).toBe("playing");
  });

  it("jumps once and lands back on the ground", () => {
    let state = jumpRunner(startRunner(createRunnerState()));
    expect(state.velocityY).toBeLessThan(0);
    expect(jumpRunner(stepRunner(state, 1 / 60, 430)).velocityY).toBeGreaterThan(state.velocityY);
    for (let index = 0; index < 120; index += 1) state = stepRunner(state, 1 / 60, 430, () => 0.8);
    expect(state.y).toBe(0);
  });

  it("clears a normal rock during one jump and lands safely", () => {
    let state: RunnerState = {
      ...jumpRunner(startRunner(createRunnerState())),
      obstacles: [{ id: 1, x: 155, width: 50, height: 38, kind: "rock" as const }],
      nextObstacleId: 2,
    };
    for (let index = 0; index < 60; index += 1) state = stepRunner(state, 1 / 60, 430, () => 0.9);
    expect(state.status).toBe("playing");
    expect(state.y).toBe(0);
  });

  it("caps speed and derives score from distance", () => {
    expect(runnerSpeed(999)).toBe(RUNNER_MAX_SPEED);
    expect(runnerScore(239.9)).toBe(9);
    expect(runnerScore(240)).toBe(10);
  });

  it("ends the run when an obstacle overlaps Xiaohua", () => {
    const state = {
      ...startRunner(createRunnerState()),
      obstacles: [{ id: 1, x: 90, width: 50, height: 38, kind: "rock" as const }],
      nextObstacleId: 2,
    };
    expect(stepRunner(state, 1 / 60, 430, () => 0.5).status).toBe("gameover");
  });
});
