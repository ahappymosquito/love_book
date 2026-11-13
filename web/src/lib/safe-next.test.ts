import { describe, expect, it } from "vitest";
import { sanitizeNext } from "./safe-next";

describe("sanitizeNext", () => {
  it("keeps in-app paths exactly as URLSearchParams decoded them", () => {
    expect(sanitizeNext("/habits?date=2026-11-12")).toBe("/habits?date=2026-11-12");
    expect(sanitizeNext("/todo?q=%E5%90%83")).toBe("/todo?q=%E5%90%83");
  });

  it("rejects external and protocol-relative targets", () => {
    expect(sanitizeNext("https://evil.example")).toBeNull();
    expect(sanitizeNext("//evil.example")).toBeNull();
    expect(sanitizeNext("/\\evil.example")).toBeNull();
    expect(sanitizeNext("/\tevil")).toBeNull();
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext(null)).toBeNull();
  });
});
