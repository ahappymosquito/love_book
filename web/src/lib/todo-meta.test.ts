import { describe, expect, it } from "vitest";
import { compareTodoByDueDate } from "./todo-meta";

type Row = { id: number; created_at: string; due: string | null };

describe("compareTodoByDueDate", () => {
  it("orders dated tasks by earliest due date and keeps undated tasks last", () => {
    const rows: Row[] = [
      { id: 1, created_at: "2026-11-01T00:00:00Z", due: null },
      { id: 2, created_at: "2026-11-02T00:00:00Z", due: "2026-11-20" },
      { id: 3, created_at: "2026-11-03T00:00:00Z", due: "2026-11-14" },
      { id: 4, created_at: "2026-10-30T00:00:00Z", due: null },
    ];
    const sorted = [...rows].sort((left, right) => compareTodoByDueDate(left, right, (row) => row.due));
    expect(sorted.map((row) => row.id)).toEqual([3, 2, 4, 1]);
  });
});
