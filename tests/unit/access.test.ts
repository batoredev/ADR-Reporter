import { describe, expect, it } from "vitest";
import { describeAccess, navigationFor, type AccessSubject } from "@/lib/domain/access";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { formatCaseNumber } from "@/lib/domain/labels";
import { isPotentiallySerious } from "@/lib/domain/seriousness";

const subject = (email: string): AccessSubject => {
  const account = DEMO_ACCOUNTS.find((a) => a.email === email);
  if (!account) throw new Error(`No demo account ${email}`);
  return {
    roles: account.roles,
    isUrgentContact: account.isUrgentContact ?? false,
    canReassign: account.canReassign ?? false,
  };
};

const labels = (email: string) => navigationFor(subject(email)).map((item) => item.label);

describe("demo accounts", () => {
  it("has two reporters and seven reviewers", () => {
    expect(DEMO_ACCOUNTS.filter((a) => a.roles.includes("REPORTER"))).toHaveLength(2);
    expect(DEMO_ACCOUNTS.filter((a) => a.roles.includes("REVIEWER"))).toHaveLength(7);
  });

  it("assigns urgent-contact, queue-lead and coordinator authority explicitly", () => {
    expect(DEMO_ACCOUNTS.filter((a) => a.isUrgentContact).map((a) => a.email)).toEqual([
      "hod@demo.test",
      "chief.pharmacist@demo.test",
      "amc.coordinator@demo.test",
    ]);
    expect(DEMO_ACCOUNTS.filter((a) => a.canReassign).map((a) => a.email)).toEqual(["hod@demo.test"]);
    expect(DEMO_ACCOUNTS.filter((a) => a.roles.includes("COORDINATOR")).map((a) => a.email)).toEqual([
      "amc.coordinator@demo.test",
      "pv.officer@demo.test",
    ]);
  });
});

describe("navigationFor", () => {
  it("gives reporters reporting pages only", () => {
    expect(labels("pharmacist@demo.test")).toEqual(["Dashboard", "New ADR report", "My reports", "Profile"]);
  });

  it("gives reviewers the queue and read access to submissions", () => {
    expect(labels("pharmacologist@demo.test")).toEqual([
      "Dashboard",
      "Review queue",
      "External submissions",
      "Profile",
    ]);
  });

  it("shows urgent escalations only to urgent contacts", () => {
    expect(labels("hod@demo.test")).toContain("Urgent escalations");
    expect(labels("pv.officer@demo.test")).not.toContain("Urgent escalations");
  });
});

describe("describeAccess", () => {
  it("summarises roles and flags", () => {
    expect(describeAccess(subject("hod@demo.test"))).toBe("Reviewer · Queue lead · Urgent contact");
    expect(describeAccess(subject("amc.coordinator@demo.test"))).toBe("Reviewer · Coordinator · Urgent contact");
  });
});

describe("isPotentiallySerious", () => {
  it("follows only what the reporter recorded", () => {
    expect(isPotentiallySerious("YES", [])).toBe(true);
    expect(isPotentiallySerious(null, ["HOSPITALISATION"])).toBe(true);
    expect(isPotentiallySerious("NO", [])).toBe(false);
    expect(isPotentiallySerious("UNKNOWN", null)).toBe(false);
  });
});

describe("formatCaseNumber", () => {
  it("pads to three digits", () => {
    expect(formatCaseNumber(1)).toBe("ADR-001");
    expect(formatCaseNumber(1234)).toBe("ADR-1234");
  });
});
