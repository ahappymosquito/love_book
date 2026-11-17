import { describe, expect, it } from "vitest";
import {
  buildBookMonths,
  monthCalendar,
  monthDateRange,
  monthKeyForRange,
  neighborIndex,
  packSheets,
  sheetPage,
  shiftMonthKey,
  spreadCount,
  spreadSheets,
  weekdayLabel,
  yearMonthCells,
} from "./journal-book";
import type { EventSummary } from "./types";

function event(id: number, occurredAt: string | null, extra: Partial<EventSummary> = {}): EventSummary {
  return {
    id,
    occurred_at: occurredAt,
    created_at: "2026-01-01T00:00:00Z",
    meeting_session_id: null,
    event_kind: "memory",
    image_count: 0,
    gift_masked: false,
    ...extra,
  } as EventSummary;
}

describe("buildBookMonths", () => {
  it("always has a page for the current month and orders pages old to new", () => {
    const months = buildBookMonths([event(1, "2026-09-10T04:00:00Z"), event(2, "2026-07-02T04:00:00Z")], "2026-11");
    expect(months.map((month) => month.key)).toEqual(["2026-07", "2026-09", "2026-11"]);
    expect(months[2].days).toEqual([]);
  });

  it("groups by Shanghai day with the newest day and entry first", () => {
    const months = buildBookMonths(
      [
        event(1, "2026-11-02T01:00:00Z"),
        event(2, "2026-11-01T17:30:00Z"),
        event(3, "2026-11-05T03:00:00Z"),
        event(4, "2026-11-02T09:00:00Z"),
      ],
      "2026-11",
    );
    expect(months[0].days.map((day) => day.dateKey)).toEqual(["2026-11-05", "2026-11-02"]);
    expect(months[0].days[1].events.map((item) => item.id)).toEqual([4, 1, 2]);
    expect(months[0].days[1].weekday).toBe("周一");
  });

  it("falls back to created_at and counts meetings, photos and gifts", () => {
    const months = buildBookMonths(
      [
        event(1, null, { created_at: "2026-10-03T02:00:00Z", meeting_session_id: 9, image_count: 2 }),
        event(2, "2026-10-04T02:00:00Z", { meeting_session_id: 9, event_kind: "gift", image_count: 3, gift_masked: true }),
        event(3, "2026-10-08T02:00:00Z", { meeting_session_id: 11, image_count: 1 }),
      ],
      "2026-10",
    );
    expect(months[0].stats).toEqual({ entries: 3, meetings: 2, photos: 3, gifts: 1 });
  });
});

describe("month helpers", () => {
  it("shifts across year boundaries", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(shiftMonthKey("2026-05", 14)).toBe("2027-07");
  });

  it("returns whole-month ranges and recognizes them", () => {
    expect(monthDateRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthKeyForRange("2026-11-01", "2026-11-30")).toBe("2026-11");
    expect(monthKeyForRange("2026-11-01", "2026-11-29")).toBeNull();
    expect(monthKeyForRange("2026-10-01", "2026-11-30")).toBeNull();
  });

  it("builds a Monday-first calendar padded to full weeks", () => {
    const weeks = monthCalendar("2026-11");
    expect(weekdayLabel("2026-11-01")).toBe("周日");
    expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0][6]).toEqual({ dateKey: "2026-11-01", day: 1 });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("finds neighbors only inside the book", () => {
    expect(neighborIndex(3, 0, -1)).toBeNull();
    expect(neighborIndex(3, 2, 1)).toBeNull();
    expect(neighborIndex(3, 1, 1)).toBe(2);
  });

  it("disables months outside range and empty months when entries are required", () => {
    const counts = new Map([["2026-03", 2]]);
    const cells = yearMonthCells(2026, counts, { minMonth: "2026-02", maxMonth: "2026-11", requireEntries: true });
    const state = Object.fromEntries(cells.map((cell) => [cell.month, cell.disabled]));
    expect(state[1]).toBe(true);
    expect(state[3]).toBe(false);
    expect(state[4]).toBe(true);
    expect(state[11]).toBe(false);
    expect(state[12]).toBe(true);
    const loose = yearMonthCells(2026, counts, { minMonth: "2026-02", maxMonth: "2026-11", requireEntries: false });
    expect(loose.find((cell) => cell.month === 4)?.disabled).toBe(false);
  });
});

describe("packSheets", () => {
  const metrics = { stamp: 30, stampGap: 10, entryGap: 10, dayGap: 20 };
  const month = buildBookMonths(
    [
      event(1, "2026-11-05T03:00:00Z"),
      event(2, "2026-11-05T02:00:00Z"),
      event(3, "2026-11-05T01:00:00Z"),
      event(4, "2026-11-02T03:00:00Z"),
    ],
    "2026-11",
  )[0];

  it("fills fixed-height sheets and repeats the day stamp on continued pages", () => {
    const sheets = packSheets(month.days, () => 100, () => 260, metrics);
    expect(sheets.map((sheet) => sheet.days.map((day) => [day.dateKey, day.events.map((item) => item.id), day.continued]))).toEqual([
      [["2026-11-05", [1, 2], false]],
      [
        ["2026-11-05", [3], true],
      ],
      [["2026-11-02", [4], false]],
    ]);
  });

  it("uses a smaller first sheet, keeps oversized entries alone and never returns zero sheets", () => {
    const first = packSheets(month.days, () => 100, (index) => (index === 0 ? 150 : 1000), metrics);
    expect(first[0].days[0].events.map((item) => item.id)).toEqual([1]);
    expect(first).toHaveLength(2);
    const oversized = packSheets(month.days, (id) => (id === 2 ? 900 : 50), () => 300, metrics);
    expect(oversized[1].days[0].events.map((item) => item.id)).toEqual([2]);
    expect(packSheets([], () => 0, () => 100, metrics)).toEqual([{ days: [] }]);
  });

  it("maps sheets onto spreads with the month overview first", () => {
    expect(spreadCount(1)).toBe(1);
    expect(spreadCount(2)).toBe(2);
    expect(spreadCount(4)).toBe(3);
    expect(spreadSheets(0)).toEqual({ left: null, right: 0 });
    expect(spreadSheets(2)).toEqual({ left: 3, right: 4 });
    expect(sheetPage(3, true)).toBe(2);
    expect(sheetPage(3, false)).toBe(3);
  });
});
