// 覆盖花田拾光天色时钟端点、暖色关键帧插值端点与缓存、Bayer 阈值，以及抖动天空像素的确定性和端点颜色。

import { describe, expect, it } from "vitest";
import { RUNNER_CHAPTER_AT } from "./xiaohua-runner";
import {
  SKY_BANDS,
  WORLD_KEYFRAMES,
  bayerThreshold,
  buildSkyPixels,
  ditherLevel,
  mixRgb,
  parseHex,
  rgbToHex,
  runnerDayClock,
  runnerWorldPalette,
} from "./xiaohua-runner-sky";

describe("runner day clock", () => {
  it("starts at dawn, ends at night and lands on each chapter shortly after it begins", () => {
    expect(runnerDayClock(0)).toBe(0);
    expect(runnerDayClock(RUNNER_CHAPTER_AT.noon + 1)).toBeCloseTo(1, 6);
    expect(runnerDayClock(RUNNER_CHAPTER_AT.dusk + 1)).toBeCloseTo(2, 6);
    expect(runnerDayClock(RUNNER_CHAPTER_AT.night + 1)).toBeCloseTo(3, 6);
    expect(runnerDayClock(10_000)).toBe(3);
  });

  it("moves monotonically through the transitions", () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= 100; elapsed += 0.5) {
      const clock = runnerDayClock(elapsed);
      expect(clock).toBeGreaterThanOrEqual(previous);
      previous = clock;
    }
  });
});

describe("runner world palette", () => {
  it("matches the dawn and night keyframes at the endpoints", () => {
    const dawn = runnerWorldPalette(0);
    const night = runnerWorldPalette(3);
    expect(dawn.skyTop).toBe(WORLD_KEYFRAMES[0].skyTop);
    expect(dawn.horizon).toBe(WORLD_KEYFRAMES[0].horizon);
    expect(night.skyTop).toBe(WORLD_KEYFRAMES[3].skyTop);
    expect(night.ground).toBe(WORLD_KEYFRAMES[3].ground);
    expect(runnerWorldPalette(-4).skyTop).toBe(WORLD_KEYFRAMES[0].skyTop);
    expect(runnerWorldPalette(9).skyTop).toBe(WORLD_KEYFRAMES[3].skyTop);
  });

  it("shows stars only toward night and petals only before dusk ends", () => {
    expect(runnerWorldPalette(0).stars).toBe(0);
    expect(runnerWorldPalette(3).stars).toBe(1);
    expect(runnerWorldPalette(0).petals).toBe(1);
    expect(runnerWorldPalette(3).petals).toBe(0);
    expect(runnerWorldPalette(0).fireflies).toBe(0);
    expect(runnerWorldPalette(2.2).fireflies).toBeGreaterThan(0.5);
  });

  it("interpolates halfway between keyframes and reuses quantized palettes", () => {
    const half = runnerWorldPalette(0.5);
    const expected = rgbToHex(mixRgb(parseHex(WORLD_KEYFRAMES[0].skyTop), parseHex(WORLD_KEYFRAMES[1].skyTop), 0.5));
    expect(half.skyTop).toBe(expected);
    expect(runnerWorldPalette(0.5)).toBe(half);
    expect(runnerWorldPalette(0.501)).toBe(half);
  });

  it("round-trips hex colors", () => {
    for (const frame of WORLD_KEYFRAMES) expect(rgbToHex(parseHex(frame.sun))).toBe(frame.sun);
  });
});

describe("ordered dithering", () => {
  it("uses 16 distinct thresholds that repeat every 4 cells", () => {
    const values = new Set<number>();
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const threshold = bayerThreshold(x, y);
        expect(threshold).toBeGreaterThan(0);
        expect(threshold).toBeLessThan(1);
        expect(bayerThreshold(x + 4, y + 8)).toBe(threshold);
        values.add(threshold);
      }
    }
    expect(values.size).toBe(16);
  });

  it("clamps dither levels to the available bands", () => {
    expect(ditherLevel(0, SKY_BANDS, 1, 2)).toBe(0);
    expect(ditherLevel(1, SKY_BANDS, 3, 1)).toBe(SKY_BANDS - 1);
    expect(ditherLevel(2, SKY_BANDS, 0, 0)).toBe(SKY_BANDS - 1);
  });

  it("builds identical sky pixels for identical input with top and horizon stops", () => {
    const palette = runnerWorldPalette(1);
    const cols = 41;
    const rows = 30;
    const first = buildSkyPixels(cols, rows, palette.skyStops);
    const second = buildSkyPixels(cols, rows, palette.skyStops);
    expect(first).toEqual(second);
    const center = Math.floor(cols / 2);
    const top = palette.skyStops[0];
    const horizon = palette.skyStops[2];
    const topOffset = center * 4;
    const bottomOffset = ((rows - 1) * cols + center) * 4;
    expect([first[topOffset], first[topOffset + 1], first[topOffset + 2]]).toEqual(top.map(Math.round));
    expect([first[bottomOffset], first[bottomOffset + 1], first[bottomOffset + 2]]).toEqual(horizon.map(Math.round));
    expect(first[topOffset + 3]).toBe(255);
  });

  it("writes into a provided buffer without reallocating", () => {
    const buffer = new Uint8ClampedArray(8 * 6 * 4);
    expect(buildSkyPixels(8, 6, runnerWorldPalette(2).skyStops, buffer)).toBe(buffer);
  });
});
