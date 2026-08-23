// 覆盖像素小狗姿态、帧选择、1-bit 描边，以及障碍剪影包住内缩碰撞盒。

import { describe, expect, it } from "vitest";
import {
  CHAPTER_PALETTE,
  CHAPTER_SKY,
  collisionFitsVisual,
  hashUnit,
  OBSTACLE_KINDS,
  obstacleSprite,
  obstacleVisualBox,
  pixelScale,
  puppyAction,
  puppyPose,
  puppySprite,
  puppyVisualBox,
  unionBoxes,
  withOutline,
} from "./xiaohua-runner-draw";
import {
  createRunnerMetrics,
  createRunnerState,
  obstacleBox,
  playerBoxes,
  startRunner,
  type RunnerObstacle,
  type RunnerObstacleKind,
  type RunnerState,
} from "./xiaohua-runner";

function playingState(overrides: Partial<RunnerState> = {}): RunnerState {
  return { ...startRunner(createRunnerState()), nextSpawnIn: 10_000, ...overrides };
}

function obstacle(kind: RunnerObstacleKind): RunnerObstacle {
  const sizes: Record<RunnerObstacleKind, Pick<RunnerObstacle, "width" | "height" | "bottom">> = {
    rock: { width: 0.78, height: 0.57, bottom: 0 },
    stump: { width: 0.68, height: 0.72, bottom: 0 },
    log: { width: 1.02, height: 0.43, bottom: 0 },
    bramble: { width: 0.98, height: 0.48, bottom: 0 },
    bird: { width: 0.94, height: 0.37, bottom: 0.53 },
  };
  return {
    id: 1,
    groupId: 1,
    x: 2,
    kind,
    requirement: kind === "bird" ? "crouch" : "jump",
    ...sizes[kind],
  };
}

describe("code-drawn puppy poses", () => {
  it("keeps idle breathing and tail wag in a gentle range", () => {
    const pose = puppyPose(createRunnerState(), 1.25, false, false);
    expect(pose.action).toBe("idle");
    expect(pose.breath).toBeGreaterThan(0.96);
    expect(pose.breath).toBeLessThan(1.04);
    expect(Math.abs(pose.tail)).toBeLessThan(1);
    expect(pose.blink).toBeGreaterThanOrEqual(0);
    expect(pose.blink).toBeLessThanOrEqual(1);
  });

  it("uses opposite leg phases while running", () => {
    const pose = puppyPose(playingState({ distance: 3.2, elapsed: 1.4 }), 1.4, false, false);
    expect(pose.action).toBe("run");
    expect(Math.abs(pose.frontPhase - pose.hindPhase)).toBeGreaterThan(0.8);
  });

  it("shortens the crouch silhouette relative to standing", () => {
    const stand = puppyVisualBox(playingState(), puppyPose(playingState(), 0, false, true));
    const crouchedState = playingState({ crouching: true, crouchHeld: true });
    const crouch = puppyVisualBox(crouchedState, puppyPose(crouchedState, 0, false, true));
    expect(crouch.height).toBeLessThan(stand.height * 0.75);
    expect(puppyAction(crouchedState, false)).toBe("crouch");
  });

  it("keeps the drawn puppy overlapping its collision boxes", () => {
    const state = playingState({ y: 0.2 });
    const visual = puppyVisualBox(state, puppyPose(state, 0.5, false, true));
    const core = unionBoxes(playerBoxes(state));
    expect(visual.x).toBeLessThan(core.x + 0.01);
    expect(visual.x + visual.width).toBeGreaterThan(core.x + core.width - 0.01);
    expect(visual.bottom + visual.height).toBeGreaterThan(core.bottom + core.height * 0.6);
  });

  it("chooses celebrate and stumble from game-over state", () => {
    const ended = playingState({ status: "gameover" });
    expect(puppyAction(ended, true)).toBe("celebrate");
    expect(puppyAction(ended, false)).toBe("stumble");
  });

  it("freezes ambient motion when reduced motion is requested", () => {
    const pose = puppyPose(createRunnerState(), 2.4, false, true);
    expect(pose.bob).toBe(0);
    expect(pose.blink).toBe(0);
  });
});

describe("code-drawn obstacles", () => {
  it("covers every obstacle kind with a visual box that contains the inset hitbox", () => {
    expect(OBSTACLE_KINDS).toEqual(["rock", "stump", "log", "bramble", "bird"]);
    for (const kind of OBSTACLE_KINDS) {
      const item = obstacle(kind);
      expect(collisionFitsVisual(obstacleVisualBox(item), obstacleBox(item))).toBe(true);
    }
  });
});

describe("1-bit pixel sprites", () => {
  it("wraps a filled texel with paper outline", () => {
    expect(withOutline(["#"])).toEqual([".o.", "o#o", ".o."]);
  });

  it("picks discrete puppy frames from pose", () => {
    const idle = playingState({ status: "idle" });
    expect(puppySprite(idle, puppyPose(idle, 0, false, true)).some((row) => row.includes("#"))).toBe(true);
    const running = playingState({ distance: 3.2, elapsed: 1.4 });
    const runPose = puppyPose(running, 1.4, false, false);
    expect(puppySprite(running, runPose).length).toBeGreaterThan(20);
    const crouched = playingState({ crouching: true, crouchHeld: true });
    expect(puppySprite(crouched, puppyPose(crouched, 0, false, true))[0].length).toBeGreaterThan(40);
  });

  it("covers every obstacle kind with a filled sprite", () => {
    for (const kind of OBSTACLE_KINDS) {
      expect(obstacleSprite(kind, 1).some((row) => row.includes("#"))).toBe(true);
    }
  });

  it("keeps chapter color to paper, ink and one accent", () => {
    for (const chapter of Object.keys(CHAPTER_PALETTE) as Array<keyof typeof CHAPTER_PALETTE>) {
      expect(CHAPTER_SKY[chapter]).toBe(CHAPTER_PALETTE[chapter].paper);
      expect(CHAPTER_PALETTE[chapter].ink).toMatch(/^#/);
      expect(CHAPTER_PALETTE[chapter].accent).toMatch(/^#/);
    }
  });

  it("uses an integer pixel scale of at least 2", () => {
    const desktop = pixelScale(createRunnerMetrics({ width: 1280, height: 720 }));
    const phone = pixelScale(createRunnerMetrics({ width: 430, height: 932 }));
    expect(desktop).toBeGreaterThanOrEqual(2);
    expect(phone).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(desktop)).toBe(true);
    expect(Number.isInteger(phone)).toBe(true);
  });
});

describe("scene hash", () => {
  it("returns a stable unit interval for the same seed", () => {
    expect(hashUnit(12)).toBeGreaterThanOrEqual(0);
    expect(hashUnit(12)).toBeLessThan(1);
    expect(hashUnit(12)).toBe(hashUnit(12));
    expect(hashUnit(12)).not.toBe(hashUnit(13));
  });
});
