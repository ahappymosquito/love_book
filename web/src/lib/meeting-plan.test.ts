import { describe, expect, it } from "vitest";
import { gridStartHour, layoutLanes, meetingDays, minuteLabel, parseMinute, slotLabel, snapMinute } from "./meeting-plan";

describe("meetingDays", () => {
  it("lists every day of the meeting with weekday labels, across month ends", () => {
    const days = meetingDays("2026-11-28", "2026-12-01");
    expect(days.map((day) => day.key)).toEqual(["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(days[0]).toMatchObject({ month: 11, day: 28, weekday: "周六", index: 0 });
    expect(days[3]).toMatchObject({ month: 12, day: 1, weekday: "周二", index: 3 });
  });

  it("caps very long ranges", () => {
    expect(meetingDays("2026-01-01", "2026-12-31")).toHaveLength(31);
  });
});

describe("minutes", () => {
  it("formats, parses and snaps", () => {
    expect(minuteLabel(18 * 60 + 5)).toBe("18:05");
    expect(minuteLabel(1440)).toBe("24:00");
    expect(parseMinute("9:30")).toBe(570);
    expect(parseMinute("24:00")).toBe(1440);
    expect(parseMinute("24:30")).toBeNull();
    expect(parseMinute("abc")).toBeNull();
    expect(snapMinute(607)).toBe(600);
    expect(snapMinute(608)).toBe(615);
    expect(slotLabel(null, null)).toBe("全天");
    expect(slotLabel(600, null)).toBe("10:00–11:00");
  });

  it("starts the grid at 8 unless something is earlier", () => {
    expect(gridStartHour([])).toBe(8);
    expect(gridStartHour([600])).toBe(8);
    expect(gridStartHour([6 * 60 + 30])).toBe(6);
  });
});

describe("layoutLanes", () => {
  it("puts overlapping entries side by side and resets after a gap", () => {
    const lanes = layoutLanes([
      { id: 1, start: 600, end: 720 },
      { id: 2, start: 660, end: 690 },
      { id: 3, start: 700, end: 760 },
      { id: 4, start: 800, end: 860 },
    ]);
    expect(lanes.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(2)).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(3)).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(4)).toEqual({ lane: 0, lanes: 1 });
  });
});
