import { describe, expect, it } from "vitest";
import { CONFETTI_MAX, confettiParticles, deriveGiftView, giftCountdown, giftCountdownTickMs, giftWrapStyleOf } from "./gift-state";
import type { EventSummary } from "./types";

type GiftInput = Parameters<typeof deriveGiftView>[0];

function gift(overrides: Partial<EventSummary> = {}): GiftInput {
  return {
    event_kind: "gift",
    creator_id: 1,
    description: null,
    gift_state: "wrapped",
    gift_receiver_id: 2,
    gift_wrap_style: "sage",
    gift_open_at: null,
    gift_feedback: null,
    gift_responded_at: null,
    gift_masked: false,
    gift_can_open: false,
    gift_feelings: [],
    gift_rating: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("deriveGiftView", () => {
  it("shows the sender a waiting box while wrapped", () => {
    const view = deriveGiftView(gift(), 1, NOW);
    expect(view.role).toBe("sender");
    expect(view.phase).toBe("waiting");
    expect(view.canOpen).toBe(false);
  });

  it("lets the receiver open once the server allows it", () => {
    const view = deriveGiftView(gift({ gift_masked: true, gift_can_open: true, gift_open_at: "2026-12-01T00:00:00Z" }), 2, NOW);
    expect(view.phase).toBe("ready");
    expect(view.masked).toBe(true);
  });

  it("keeps the gift sealed until the open time passes", () => {
    const sealed = gift({ gift_masked: true, gift_open_at: "2026-11-14T00:00:00Z" });
    expect(deriveGiftView(sealed, 2, NOW).phase).toBe("sealed");
    expect(deriveGiftView(sealed, 2, Date.parse("2026-11-14T00:00:01Z")).phase).toBe("ready");
  });

  it("lets only the receiver respond after opening", () => {
    const opened = gift({ gift_state: "opened", gift_opened_at: "2026-11-13T10:00:00Z" });
    expect(deriveGiftView(opened, 2, NOW)).toMatchObject({ phase: "opened", canRespond: true, hasResponse: false });
    expect(deriveGiftView(opened, 1, NOW).canRespond).toBe(false);
    expect(deriveGiftView({ ...opened, gift_responded_at: "2026-11-13T11:00:00Z" }, 2, NOW).hasResponse).toBe(true);
  });

  it("reads legacy received gifts as opened gifts the creator received", () => {
    const legacy = gift({ event_kind: "gift_received", gift_state: null, gift_receiver_id: null, gift_wrap_style: null, description: "很喜欢", gift_feelings: ["happy"] });
    const view = deriveGiftView(legacy, 1, NOW);
    expect(view).toMatchObject({ legacy: true, role: "receiver", receiverId: 1, phase: "opened", wrapStyle: "peach", hasResponse: true, feedback: "很喜欢", canRespond: false });
    expect(deriveGiftView(legacy, 2, NOW).role).toBe("sender");
  });
});

describe("giftCountdown", () => {
  it("returns null once the time has passed or is missing", () => {
    expect(giftCountdown(null, NOW)).toBeNull();
    expect(giftCountdown("2026-11-13T11:59:00Z", NOW)).toBeNull();
    expect(giftCountdown("not a date", NOW)).toBeNull();
  });

  it("formats days, hours, and minutes", () => {
    expect(giftCountdown("2026-11-16T15:00:00Z", NOW)?.label).toBe("还要 3 天 3 小时");
    expect(giftCountdown("2026-11-15T12:00:00Z", NOW)?.label).toBe("还要 2 天");
    expect(giftCountdown("2026-11-13T14:30:00Z", NOW)?.label).toBe("还要 2 小时 30 分");
    expect(giftCountdown("2026-11-13T12:20:00Z", NOW)?.label).toBe("还要 20 分钟");
    expect(giftCountdown("2026-11-13T12:00:30Z", NOW)?.label).toBe("马上就能拆了");
  });

  it("ticks faster as the open time approaches", () => {
    expect(giftCountdownTickMs(5 * 3_600_000)).toBe(60_000);
    expect(giftCountdownTickMs(30 * 60_000)).toBe(20_000);
    expect(giftCountdownTickMs(30_000)).toBe(1_000);
  });
});

describe("confettiParticles", () => {
  it("is deterministic per seed and capped", () => {
    expect(confettiParticles(40, 7)).toEqual(confettiParticles(40, 7));
    expect(confettiParticles(400, 7)).toHaveLength(CONFETTI_MAX);
  });

  it("emits nothing under reduced motion", () => {
    expect(confettiParticles(40, 7, true)).toEqual([]);
  });
});

describe("giftWrapStyleOf", () => {
  it("falls back to the default paper for unknown values", () => {
    expect(giftWrapStyleOf("starry")).toBe("starry");
    expect(giftWrapStyleOf("plaid")).toBe("rose");
    expect(giftWrapStyleOf(null)).toBe("rose");
  });
});
