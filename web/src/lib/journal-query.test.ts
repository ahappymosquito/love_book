import { describe, expect, it } from "vitest";
import { isIsoDate, journalApiPath, journalPageSearch, journalQueryProblem, parseJournalQuery } from "./journal-query";

const parse = (search: string) => parseJournalQuery(new URLSearchParams(search));

describe("parseJournalQuery", () => {
  it("defaults to all", () => {
    expect(parse("")).toEqual({ scope: "all", start: "", end: "", meetingId: null });
    expect(parse("scope=weird")).toMatchObject({ scope: "all" });
  });

  it("reads range and meeting params", () => {
    expect(parse("scope=range&start=2026-01-01&end=2026-02-01")).toEqual({ scope: "range", start: "2026-01-01", end: "2026-02-01", meetingId: null });
    expect(parse("scope=meeting&meeting_id=12")).toMatchObject({ scope: "meeting", meetingId: 12 });
  });

  it("drops invalid dates and ids", () => {
    expect(parse("scope=range&start=2026-02-30&end=abc")).toMatchObject({ start: "", end: "" });
    expect(parse("scope=meeting&meeting_id=-3")).toMatchObject({ meetingId: null });
    expect(parse("scope=meeting&meeting_id=1e3")).toMatchObject({ meetingId: null });
  });
});

describe("isIsoDate", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-1-1")).toBe(false);
  });
});

describe("journalQueryProblem", () => {
  it("asks for missing pieces", () => {
    expect(journalQueryProblem({ scope: "all", start: "", end: "", meetingId: null })).toBeNull();
    expect(journalQueryProblem({ scope: "range", start: "2026-01-01", end: "", meetingId: null })).not.toBeNull();
    expect(journalQueryProblem({ scope: "range", start: "2026-03-01", end: "2026-01-01", meetingId: null })).not.toBeNull();
    expect(journalQueryProblem({ scope: "meeting", start: "", end: "", meetingId: null })).not.toBeNull();
  });
});

describe("journal paths", () => {
  it("builds API path with only relevant params", () => {
    expect(journalApiPath({ scope: "all", start: "2026-01-01", end: "", meetingId: 3 })).toBe("/journal?scope=all");
    expect(journalApiPath({ scope: "range", start: "2026-01-01", end: "2026-01-31", meetingId: 3 })).toBe("/journal?scope=range&start=2026-01-01&end=2026-01-31");
    expect(journalApiPath({ scope: "meeting", start: "", end: "", meetingId: 3 })).toBe("/journal?scope=meeting&meeting_id=3");
  });

  it("keeps the page URL clean for all", () => {
    expect(journalPageSearch({ scope: "all", start: "", end: "", meetingId: null })).toBe("");
    expect(journalPageSearch({ scope: "meeting", start: "", end: "", meetingId: 5 })).toBe("?scope=meeting&meeting_id=5");
  });
});
