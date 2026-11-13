import { describe, expect, it } from "vitest";
import {
  CANVAS_MAX_AREA,
  CANVAS_MAX_DIMENSION,
  deterministicRotation,
  mapWithConcurrency,
  maxSegmentHeightFor,
  paginateBlocks,
  planLongImage,
  sanitizeFilename,
} from "./journal-pages";

describe("sanitizeFilename", () => {
  it("removes characters that break file systems", () => {
    expect(sanitizeFilename('我们/的:手账*?"<>|')).toBe("我们 的 手账");
    expect(sanitizeFilename("  ..秘密\u0000手账..  ")).toBe("秘密 手账");
  });

  it("falls back when nothing usable remains and caps length", () => {
    expect(sanitizeFilename("///")).toBe("我们的手账");
    expect(Array.from(sanitizeFilename("爱".repeat(100))).length).toBe(60);
  });
});

describe("deterministicRotation", () => {
  it("is stable and bounded", () => {
    expect(deterministicRotation("entry1")).toBe(deterministicRotation("entry1"));
    for (let i = 0; i < 500; i += 1) {
      const r = deterministicRotation(`entry${i}`);
      expect(Math.abs(r)).toBeLessThanOrEqual(1.5);
    }
    const unique = new Set(Array.from({ length: 50 }, (_, i) => deterministicRotation(i)));
    expect(unique.size).toBeGreaterThan(10);
  });
});

describe("paginateBlocks", () => {
  it("packs blocks greedily with gaps", () => {
    expect(paginateBlocks([{ height: 300 }, { height: 300 }, { height: 300 }], 700, 20)).toEqual([[0, 1], [2]]);
  });

  it("keeps cover and closing alone and moves headers with their next block", () => {
    const pages = paginateBlocks(
      [
        { height: 700, alone: true },
        { height: 40, keepWithNext: true },
        { height: 500 },
        { height: 40, keepWithNext: true },
        { height: 300 },
        { height: 700, alone: true },
      ],
      700,
      10,
    );
    expect(pages).toEqual([[0], [1, 2], [3, 4], [5]]);
  });

  it("puts oversized blocks on their own page", () => {
    expect(paginateBlocks([{ height: 100 }, { height: 2000 }, { height: 100 }], 700)).toEqual([[0], [1], [2]]);
  });

  it("honors breakBefore", () => {
    expect(paginateBlocks([{ height: 10 }, { height: 10, breakBefore: true }], 700)).toEqual([[0], [1]]);
  });
});

describe("planLongImage", () => {
  it("uses 2x when the whole image fits canvas limits", () => {
    expect(planLongImage(5000, 750, 2)).toMatchObject({ pixelRatio: 2, single: true });
  });

  it("lowers the pixel ratio before splitting", () => {
    const plan = planLongImage(9000, 750, 2);
    expect(plan.single).toBe(true);
    expect(plan.pixelRatio).toBeLessThan(2);
    expect(750 * plan.pixelRatio * 9000 * plan.pixelRatio).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    expect(9000 * plan.pixelRatio).toBeLessThanOrEqual(CANVAS_MAX_DIMENSION);
  });

  it("splits very long journals into segments within limits", () => {
    const plan = planLongImage(60000, 750, 2);
    expect(plan.single).toBe(false);
    expect(plan.maxSegmentHeight).toBe(maxSegmentHeightFor(750, plan.pixelRatio));
    expect(750 * plan.pixelRatio * plan.maxSegmentHeight * plan.pixelRatio).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    expect(plan.maxSegmentHeight * plan.pixelRatio).toBeLessThanOrEqual(CANVAS_MAX_DIMENSION);
  });
});

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const progress: number[] = [];
    const out = await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async (n) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running -= 1;
        return n * 2;
      },
      { onProgress: (done) => progress.push(done) },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => i * 2));
    expect(progress[progress.length - 1]).toBe(10);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mapWithConcurrency([1, 2], 2, async (n) => n, { signal: controller.signal })).rejects.toThrow();
  });
});
