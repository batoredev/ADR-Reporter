import { describe, expect, it } from "vitest";
import { parseIndianDate, parsePatientLine, resolveRelativeDate } from "@/lib/domain/clinical-text";

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

describe("dates written in words", () => {
  const anchors = {
    today: "2026-11-25",
    prescriptions: ["2026-11-20"],
    medicineStarts: [{ name: "Amoxicillin 500 mg", date: "2026-11-21" }],
    reactionStart: "2026-11-23",
  };
  const date = (text: string) => resolveRelativeDate(text, anchors)?.date ?? null;
  it("counts from the day the words were written", () => {
    expect(date("today")).toBe("2026-11-25");
    expect(date("yesterday")).toBe("2026-11-24");
    expect(date("last night")).toBe("2026-11-24");
    expect(date("day before yesterday")).toBe("2026-11-23");
    expect(date("3 days ago")).toBe("2026-11-22");
    expect(date("two days back")).toBe("2026-11-23");
    expect(date("since 3 days")).toBe("2026-11-22");
    expect(date("last Monday")).toBe("2026-11-23");
    expect(date("2 weeks ago")).toBe("2026-11-11");
    expect(date("3 months ago")).toBe("2026-08");
    expect(date("last year")).toBe("2025");
  });
  it("counts from the prescription, a medicine's start or the reaction", () => {
    expect(date("2 days from the day of prescription")).toBe("2026-11-22");
    expect(date("2 days after the prescription")).toBe("2026-11-22");
    expect(date("the next day after the prescription")).toBe("2026-11-21");
    expect(date("same day as the prescription")).toBe("2026-11-20");
    expect(date("a day after starting amoxicillin")).toBe("2026-11-22");
    expect(date("on day 3 of amoxicillin")).toBe("2026-11-23");
    expect(date("2 days after the rash started")).toBe("2026-11-25");
    expect(date("a week before the rash")).toBe("2026-11-16");
  });
  it("gives a day and month with no year the most recent such date", () => {
    expect(date("on 14/10")).toBe("2026-10-14");
    expect(date("28 Dec")).toBe("2025-12-28");
  });
  it("marks approximate words and refuses what cannot be worked out", () => {
    expect(resolveRelativeDate("about 4 days ago", anchors)).toMatchObject({ date: "2026-11-21", approximate: true });
    expect(date("a few days ago")).toBeNull();
    expect(date("the next day")).toBeNull();
    expect(date("2 days after the prescription")).not.toBeNull();
    expect(
      resolveRelativeDate("2 days after the prescription", { ...anchors, prescriptions: ["2026-11-20", "2026-11-22"] }),
    ).toBeNull();
    expect(resolveRelativeDate("2 days after the prescription", { today: "2026-11-25" })).toBeNull();
  });
});
