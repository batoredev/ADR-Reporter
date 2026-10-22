// Reads the seeded test database (TEST_DATABASE_URL). Run `npm run test:db:init` once first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { getDashboard } from "@/server/dashboard";

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

async function userFor(email: string): Promise<CurrentUser> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { institution: true } });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    designation: u.designation,
    roles: u.roles,
    isUrgentContact: u.isUrgentContact,
    canReassign: u.canReassign,
    institutionId: u.institutionId,
    institutionName: u.institution.name,
    department: u.institution.department,
  };
}

const caseNumbers = async (email: string) =>
  (await getDashboard(await userFor(email), { sort: "activity" })).recent.map((c) => c.caseNumber).sort();

describe.skipIf(!hasTestDb)("dashboard visibility (seeded test database)", () => {
  beforeAll(async () => {
    expect(await db.adrCase.count()).toBe(8);
  });
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
    expect((await getDashboard(await userFor("hod@demo.test"), { sort: "activity" })).metrics.openEscalations).toBe(1);
    expect(
      (await getDashboard(await userFor("consultant@demo.test"), { sort: "activity" })).metrics.openEscalations,
    ).toBeNull();
  });

  it("sorts potentially serious cases first when asked", async () => {
    const { recent } = await getDashboard(await userFor("hod@demo.test"), { sort: "serious" });
    expect(recent[0].caseNumber).toBe("ADR-006");
  });

  it("filters by status and search text", async () => {
    const hod = await userFor("hod@demo.test");
    expect((await getDashboard(hod, { sort: "activity", status: "RETURNED" })).recent.map((c) => c.caseNumber)).toEqual(
      ["ADR-004"],
    );
    expect((await getDashboard(hod, { sort: "activity", q: "amoxi" })).recent.map((c) => c.caseNumber)).toEqual([
      "ADR-001",
    ]);
  });

  it("rejects changes to the audit log", async () => {
    await expect(db.auditLog.updateMany({ data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
