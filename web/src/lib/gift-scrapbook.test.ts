import { describe, expect, it } from "vitest";
import { MAX_CARD_TILT_DEG, cardTilt, monthTabLabel, paperPatternFor, stickerFor, washiFor } from "./gift-scrapbook";

const ids = Array.from({ length: 500 }, (_, index) => index + 1);

describe("scrapbook decoration", () => {
  it("keeps card tilt small and stable per event", () => {
    for (const id of ids) {
      const tilt = cardTilt(id);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(MAX_CARD_TILT_DEG);
      expect(cardTilt(id)).toBe(tilt);
    }
    expect(new Set(ids.map(cardTilt)).size).toBeGreaterThan(5);
  });

  it("places washi tape deterministically within a gentle angle", () => {
    expect(washiFor(42)).toEqual(washiFor(42));
    for (const id of ids) expect(Math.abs(washiFor(id).angle)).toBeLessThanOrEqual(6);
  });

  it("gives only some cards a sticker, always the same one", () => {
    const stickers = ids.map(stickerFor);
    const withSticker = stickers.filter(Boolean).length;
    expect(withSticker).toBeGreaterThan(150);
    expect(withSticker).toBeLessThan(400);
    expect(stickerFor(7)).toEqual(stickerFor(7));
  });

  it("derives month paper and tab labels", () => {
    expect(paperPatternFor("2026-11")).toBe(paperPatternFor("2026-11"));
    expect(["dots", "grid", "lines"]).toContain(paperPatternFor("2026-03"));
    expect(monthTabLabel("2026-03")).toEqual({ year: "2026", month: "3 月" });
  });
});
