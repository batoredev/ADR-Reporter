import { describe, expect, it } from "vitest";
import {
  dateRange,
  formatForDisplay,
  formatForOfficialForm,
  isDefinitelyBefore,
  isValidPartialDate,
  parsePartialDate,
} from "@/lib/domain/partial-date";

describe("parsePartialDate", () => {
  it("accepts year, month and day precision", () => {
    expect(parsePartialDate("2026")).toEqual({ year: 2026 });
    expect(parsePartialDate("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parsePartialDate("2026-10-14")).toEqual({ year: 2026, month: 10, day: 14 });
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of [
      "",
      "26",
      "2026-1",
      "2026-13",
      "2026-00",
      "2026-02-30",
      "2025-02-29",
      "14/10/2026",
      "2026-10-14T00:00",
    ]) {
      expect(isValidPartialDate(bad), bad).toBe(false);
    }
    expect(isValidPartialDate("2028-02-29")).toBe(true);
  });
});

describe("formatForOfficialForm", () => {
  it("prints exact dates as dd/mm/yyyy", () => {
    expect(formatForOfficialForm("2026-10-14")).toBe("14/10/2026");
  });

  it("writes partial dates in words without placeholders or invented days", () => {
    expect(formatForOfficialForm("2026-10")).toBe("Oct 2026");
    expect(formatForOfficialForm("2025")).toBe("2025");
    for (const value of ["2026-10", "2025"]) {
      const text = formatForOfficialForm(value);
      expect(text).not.toMatch(/-|\b0?1\//);
    }
  });

  it("labels approximate dates in words", () => {
    expect(formatForOfficialForm("2026-10-14", true)).toBe("approx. 14/10/2026");
    expect(formatForOfficialForm("2026-08", true)).toBe("approx. Aug 2026");
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(formatForOfficialForm(null)).toBe("");
    expect(formatForOfficialForm("not a date")).toBe("");
  });
});

describe("formatForDisplay", () => {
  it("uses full month names and marks approximate dates", () => {
    expect(formatForDisplay("2026-10-14")).toBe("14 October 2026");
    expect(formatForDisplay("2026-10", true)).toBe("October 2026 (approx.)");
  });
});

describe("date ranges and comparisons", () => {
  it("expands partial dates to the days they could mean", () => {
    expect(dateRange("2026-02")).toEqual({ earliest: "2026-02-01", latest: "2026-02-28" });
    expect(dateRange("2026")).toEqual({ earliest: "2026-01-01", latest: "2026-12-31" });
  });

  it("never treats a month as its first day", () => {
    // "October 2026" could be 31 October, so it is not certainly before 14 October.
    expect(isDefinitelyBefore("2026-10", "2026-10-14")).toBe(false);
    expect(isDefinitelyBefore("2026-09", "2026-10-14")).toBe(true);
    expect(isDefinitelyBefore("2026-10-12", "2026-10-14")).toBe(true);
    expect(isDefinitelyBefore("2026-10-14", "2026-10-14")).toBe(false);
    expect(isDefinitelyBefore(null, "2026-10-14")).toBe(false);
  });
});
