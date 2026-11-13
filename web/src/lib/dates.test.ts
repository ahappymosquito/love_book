import { describe, expect, it } from "vitest";
import { dateFromKey, shanghaiDateKey, shanghaiMonthKey } from "./dates";

describe("shanghai date keys", () => {
  it("buckets UTC instants by the Beijing calendar day", () => {
    expect(shanghaiDateKey("2026-01-31T16:30:00Z")).toBe("2026-02-01");
    expect(shanghaiDateKey("2026-01-31T15:59:59Z")).toBe("2026-01-31");
  });

  it("derives the Beijing month across month boundaries", () => {
    expect(shanghaiMonthKey("2026-03-31T17:00:00Z")).toBe("2026-04");
    expect(shanghaiMonthKey(new Date("2026-12-31T15:00:00Z"))).toBe("2026-12");
  });

  it("parses a date key into a local calendar date", () => {
    const date = dateFromKey("2026-11-13");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 10, 13]);
  });
});
