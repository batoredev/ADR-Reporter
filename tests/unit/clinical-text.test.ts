import { describe, expect, it } from "vitest";
import { parseIndianDate, parsePatientLine } from "@/lib/domain/clinical-text";

describe("dates as written in Indian hospitals", () => {
  const today = new Date("2026-11-24");
  it("reads numeric dates day first, with two-digit years", () => {
    expect(parseIndianDate("10/11/26", today)).toBe("2026-11-10");
    expect(parseIndianDate("14-10-2026", today)).toBe("2026-10-14");
    expect(parseIndianDate("14.10.2026", today)).toBe("2026-10-14");
    expect(parseIndianDate("on 12/11/26", today)).toBe("2026-11-12");
  });
  it("reads month names and partial dates", () => {
    expect(parseIndianDate("14 Oct 2026", today)).toBe("2026-10-14");
    expect(parseIndianDate("14th October 2026", today)).toBe("2026-10-14");
    expect(parseIndianDate("Oct 14, 2026", today)).toBe("2026-10-14");
    expect(parseIndianDate("Oct 2026", today)).toBe("2026-10");
    expect(parseIndianDate("10/2026", today)).toBe("2026-10");
    expect(parseIndianDate("2026", today)).toBe("2026");
  });
  it("rejects impossible dates and anything that is not just a date", () => {
    expect(parseIndianDate("31/02/2026", today)).toBeNull();
    expect(parseIndianDate("yesterday", today)).toBeNull();
    expect(parseIndianDate("rash on 14/10/2026", today)).toBeNull();
  });
});

describe("a patient typed in one line", () => {
  it("reads initials, age, gender and weight however they are written", () => {
    expect(parsePatientLine("R.K., 34, female")).toEqual({
      initials: "R.K.",
      age: "34",
      ageUnit: "YEARS",
      gender: "FEMALE",
    });
    expect(parsePatientLine("RK 34/F")).toEqual({ initials: "R.K.", age: "34", ageUnit: "YEARS", gender: "FEMALE" });
    expect(parsePatientLine("Pt R.K, 34/F")).toMatchObject({ initials: "R.K.", age: "34", gender: "FEMALE" });
    expect(parsePatientLine("A.K, 24 yrs, M, 54 kg")).toEqual({
      initials: "A.K.",
      age: "24",
      ageUnit: "YEARS",
      gender: "MALE",
      weightKg: "54",
    });
    expect(parsePatientLine("8 months, male")).toEqual({ age: "8", ageUnit: "MONTHS", gender: "MALE" });
  });
  it("returns nothing for text that is not a patient line", () => {
    expect(parsePatientLine("rash")).toEqual({});
  });
});
