import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createDraft, loadCase, saveDraft, submitCase } from "@/server/workflow/cases";
import {
  applyExtraction,
  discardExtraction,
  getExtraction,
  pendingExtractions,
  runExtraction,
  uploadDocument,
  type ExtractionView,
} from "@/server/workflow/extraction";
import {
  checkConsistency,
  discardNarrative,
  draftNarrative,
  getAiHistory,
  keepFinding,
  recordNarrativeUse,
} from "@/server/workflow/ai-assist";
import { guidedFollowups, saveGuidedStep } from "@/server/workflow/guided";
import { toFormValues } from "@/lib/domain/case-form";
import { documentExtractionSchema } from "@/lib/domain/extraction";
import { createFixtureProvider } from "@/server/ai/fixture";
import * as providers from "@/server/ai/provider";
import { form } from "../fixtures/form";
import { hasTestDb, userFor } from "./helpers";

async function setup() {
  const user = await userFor("pharmacist@demo.test");
  const { id } = await createDraft(user);
  const saved = await saveDraft(user, id, 0, form());
  return { user, id, saved };
}
async function document(user: Awaited<ReturnType<typeof userFor>>, id: string) {
  const bytes = await readFile("samples/prescriptions/fictional-prescription-clean.png");
  return uploadDocument(user, id, new File([bytes], "fictional.png", { type: "image/png" }));
}
function choices(view: ExtractionView) {
  const field = (p: ExtractionView["singles"][number]["proposal"]) => ({
    itemId: p.itemId,
    use: Boolean(p.value),
    value: p.value ?? "",
    confirmedUncertain: false,
    approximate: p.approximate,
  });
  return {
    lockVersion: view.lockVersion,
    verifiedAgainstSource: true,
    confirmedPatientMatch: true,
    singles: [],
    investigations: [],
    medications: view.medications.map((m) => ({
      index: m.index,
      target: "SUSPECTED",
      fields: Object.entries(m.fields)
        .filter(([f]) => ["name", "dose", "frequency", "startDate", "stopDate"].includes(f))
        .map(([, p]) => field(p!)),
    })),
  };
}

describe.skipIf(!hasTestDb)("AI workflows against PostgreSQL", () => {
  beforeEach(() => vi.stubEnv("AI_PROVIDER", "fixture"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(() => db.$disconnect());

  it("serializes simultaneous autosaves instead of overwriting one", async () => {
    const { user, id, saved } = await setup();
    const results = await Promise.allSettled([
      saveDraft(user, id, saved.lockVersion, { ...form(), reactionTerms: "First edit" }),
      saveDraft(user, id, saved.lockVersion, { ...form(), reactionTerms: "Second edit" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("persists extraction suggestions, requires uncertainty confirmation and applies each run only once", async () => {
    const { user, id } = await setup();
    const doc = await document(user, id);
    const run = await runExtraction(user, id, doc.id);
    expect((await pendingExtractions(user, id)).map((r) => r.id)).toContain(run.runId);
    expect((await getExtraction(user, id, run.runId)).medications).toHaveLength(2);
    const input = choices(run);
    await expect(applyExtraction(user, id, run.runId, input)).rejects.toThrow(/Confirm.*unclear/i);
    input.medications.forEach((m) =>
      m.fields.forEach((f) => {
        f.confirmedUncertain = true;
      }),
    );
    const results = await Promise.allSettled([
      applyExtraction(user, id, run.runId, input),
      applyExtraction(user, id, run.runId, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { c } = await loadCase(user, id);
    expect(c.suspectedMedicines.filter((m) => m.name?.includes("Paracetamol"))).toHaveLength(1);
    expect(await db.fieldProvenance.count({ where: { caseId: id } })).toBeGreaterThan(0);
    expect(await pendingExtractions(user, id)).toHaveLength(0);
  });
  it("rejects stale extraction previews and can resume or discard them without another AI request", async () => {
    const { user, id } = await setup();
    const doc = await document(user, id);
    const run = await runExtraction(user, id, doc.id);
    await saveDraft(user, id, run.lockVersion, {
      ...toFormValues((await loadCase(user, id)).c),
      reactionTerms: "Edited while reading",
    });
    await expect(applyExtraction(user, id, run.runId, choices(run))).rejects.toThrow(/report changed/i);
    const current = await getExtraction(user, id, run.runId);
    expect(current.lockVersion).toBe(run.lockVersion + 1);
    await discardExtraction(user, id, run.runId);
    await expect(getExtraction(user, id, run.runId)).rejects.toThrow(/already decided/i);
  });
  it("requires source verification and explicit confirmation of different patient initials", async () => {
    const { user, id } = await setup();
    const doc = await document(user, id);
    const run = await runExtraction(user, id, doc.id);
    expect(run.patientMatch).toBe("DIFFERENT");
    await expect(
      applyExtraction(user, id, run.runId, { ...choices(run), verifiedAgainstSource: false }),
    ).rejects.toThrow(/Verify the selected/);
    await expect(
      applyExtraction(user, id, run.runId, { ...choices(run), confirmedPatientMatch: false }),
    ).rejects.toThrow(/different patient initials/);
    expect((await loadCase(user, id)).c.lockVersion).toBe(run.lockVersion);
  });
  it("applies lab results, approximate dates and explicitly written medication stop dates", async () => {
    const { user, id } = await setup();
    const doc = await document(user, id);
    const p = createFixtureProvider();
    const { output } = await p.generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: documentExtractionSchema,
    });
    const read = (value: string, approximate = false) => ({ value, sourceText: value, uncertain: false, approximate });
    output.documentType = "DISCHARGE_SUMMARY";
    output.investigations = [
      { testName: read("Serum creatinine"), result: read("2.1 mg/dL"), date: read("2026-10", true) },
    ];
    output.medications = [output.medications[0]];
    output.medications[0].stopDate = { ...read("2026-10-15"), sourceText: "Amoxicillin stopped 15 October 2026" };
    vi.spyOn(providers, "generateWithFallback").mockResolvedValue({
      output,
      provider: "fixture",
      model: "discharge-fixture",
      attempts: [],
      meta: {},
    });
    const run = await runExtraction(user, id, doc.id);
    const input = {
      ...choices(run),
      investigations: run.investigations.map((inv) => ({
        index: inv.index,
        add: true,
        fields: Object.values(inv.fields).map((p) => ({
          itemId: p.itemId,
          use: true,
          value: p.value!,
          confirmedUncertain: true,
          approximate: p.approximate,
        })),
      })),
    };
    await applyExtraction(user, id, run.runId, input);
    const { c } = await loadCase(user, id);
    expect(c.investigations.at(-1)).toMatchObject({ result: "2.1 mg/dL", date: "2026-10", dateApprox: true });
    expect(c.suspectedMedicines.at(-1)?.stopDate).toBe("2026-10-15");
  });
  it("saves a verified narrative atomically, audits the final wording and prevents repeat use", async () => {
    const { user, id } = await setup();
    const draft = await draftNarrative(user, id, { notes: "Rash improved", useReport: true });
    expect((await getAiHistory(user, id)).narrative?.draftId).toBe(draft.draftId);
    const input = {
      draftId: draft.draftId,
      text: "The rash improved.",
      mode: "replace" as const,
      lockVersion: draft.lockVersion,
      verified: false,
    };
    await expect(recordNarrativeUse(user, id, input)).rejects.toThrow(/Verify/);
    input.verified = true;
    const used = await recordNarrativeUse(user, id, input);
    expect((await loadCase(user, id)).c.reactionDescription).toBe(input.text);
    expect((await getAiHistory(user, id)).narrative).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: id, action: "AI_NARRATIVE_USED" } });
    expect(audit.details).toMatchObject({ finalText: input.text, edited: true, verified: true });
    await expect(recordNarrativeUse(user, id, { ...input, lockVersion: used.lockVersion })).rejects.toThrow(
      /already used/,
    );
  });
  it("rejects overlong appended narratives without silently truncating and supports durable discard", async () => {
    const { user, id } = await setup();
    const current = (await loadCase(user, id)).c;
    await saveDraft(user, id, current.lockVersion, {
      ...toFormValues(current),
      reactionDescription: "Existing description.",
    });
    const draft = await draftNarrative(user, id, { notes: "Notes", useReport: true });
    await expect(
      recordNarrativeUse(user, id, {
        draftId: draft.draftId,
        text: "x".repeat(4000),
        mode: "append",
        lockVersion: draft.lockVersion,
        verified: true,
      }),
    ).rejects.toThrow(/exceeds/);
    await discardNarrative(user, id, draft.draftId);
    expect((await getAiHistory(user, id)).narrative).toBeNull();
  });
  it("persists finding decisions and exposes them to the reviewer without changing clinical fields", async () => {
    const { user, id } = await setup();
    const before = (await loadCase(user, id)).c.reactionTerms;
    const check = await checkConsistency(user, id);
    await expect(
      keepFinding(user, id, { checkId: check.checkId, index: 0, reason: "", decision: "KEPT" }),
    ).rejects.toThrow(/Explain/);
    await keepFinding(user, id, {
      checkId: check.checkId,
      index: 0,
      reason: "Original notes unavailable",
      decision: "UNSURE",
    });
    await submitCase(user, id, { lockVersion: (await loadCase(user, id)).c.lockVersion, declaration: true });
    const reviewer = await userFor("hod@demo.test");
    expect((await getAiHistory(reviewer, id)).check?.decisions[0].decision).toBe("UNSURE");
    expect((await loadCase(reviewer, id)).c.reactionTerms).toBe(before);
    await expect(draftNarrative(user, id, { notes: "Notes", useReport: false })).rejects.toThrow(/no longer/);
  });
  it("keeps guided answers in the same saved report, restores the current group and falls back to fixed questions", async () => {
    const { user, id } = await setup();
    await saveGuidedStep(user, id, "medicine-dose");
    expect((await getAiHistory(user, id)).guidedStep).toBe("medicine-dose");
    const ai = await guidedFollowups(user, id);
    expect(ai.stepIds).toContain("seriousness");
    vi.stubEnv("AI_PROVIDER", "none");
    const fallback = await guidedFollowups(user, id);
    expect(fallback.provider).toBe("rules");
    const other = await userFor("physician@demo.test");
    await expect(getAiHistory(other, id)).rejects.toThrow(/not found/i);
  });
});
