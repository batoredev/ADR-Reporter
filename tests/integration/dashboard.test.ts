// Reads the seeded test database (TEST_DATABASE_URL). Run `npm run test:db:init` once first.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getDashboard, visibleCasesWhere } from "@/server/dashboard";
import { hasTestDb, SEEDED, userFor } from "./helpers";

// Visibility is checked on the seeded cases; other tests may add cases of their own.
const caseNumbers = async (email: string) =>
  (await db.adrCase.findMany({ where: visibleCasesWhere(await userFor(email)), select: { caseNumber: true } }))
    .map((c) => c.caseNumber)
    .filter((n) => SEEDED.has(n))
    .sort();

describe.skipIf(!hasTestDb)("dashboard visibility (seeded test database)", () => {
  afterAll(() => db.$disconnect());

  it("shows a reporter only their own reports, including drafts", async () => {
    expect(await caseNumbers("pharmacist@demo.test")).toEqual(["ADR-001", "ADR-002", "ADR-004", "ADR-006", "ADR-008"]);
    expect(await caseNumbers("physician@demo.test")).toEqual(["ADR-003", "ADR-005", "ADR-007"]);
  });

  it("shows reviewers every submitted case but no one else's drafts", async () => {
    const seen = await caseNumbers("pharmacologist@demo.test");
    expect(seen).toEqual(["ADR-001", "ADR-003", "ADR-004", "ADR-005", "ADR-006", "ADR-008"]);
  });

  it("counts open urgent escalations only for urgent contacts", async () => {
    expect(
      (await getDashboard(await userFor("hod@demo.test"), { sort: "activity" })).metrics.openEscalations,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await getDashboard(await userFor("consultant@demo.test"), { sort: "activity" })).metrics.openEscalations,
    ).toBeNull();
  });

  it("sorts potentially serious cases first when asked", async () => {
    const { recent } = await getDashboard(await userFor("hod@demo.test"), { sort: "serious" });
    const flags = recent.map((c) => c.isPotentiallySerious);
    expect(flags[0]).toBe(true);
    expect(flags.indexOf(false) === -1 || flags.slice(flags.indexOf(false)).every((f) => !f)).toBe(true);
  });

  it("filters by status and search text", async () => {
    const hod = await userFor("hod@demo.test");
    const returned = (await getDashboard(hod, { sort: "activity", status: "RETURNED" })).recent;
    expect(returned.every((c) => c.status === "RETURNED")).toBe(true);
    expect(returned.map((c) => c.caseNumber)).toContain("ADR-004");
    // Ciprofloxacin appears only in the seeded data, so the result cannot be crowded out by test cases.
    const cipro = (await getDashboard(hod, { sort: "activity", q: "ciproflox" })).recent;
    expect(cipro.map((c) => c.caseNumber)).toEqual(["ADR-004"]);
    expect((await getDashboard(hod, { sort: "activity", q: "ADR-001" })).recent.map((c) => c.caseNumber)).toEqual([
      "ADR-001",
    ]);
  });

  it("rejects changes to the audit log", async () => {
    await expect(db.auditLog.updateMany({ data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
