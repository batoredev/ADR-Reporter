// Fictional demonstration data. Every person, case and reference here is
// invented; nothing is taken from real patients or real institutions.
//
// Run on an empty database only (`npm run db:setup` resets and seeds).
// The audit log is append-only, so the seed refuses to run twice.
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { Prisma } from "../src/generated/prisma/client";
import type { CaseStatus } from "../src/generated/prisma/enums";
import { createPrismaClient } from "../src/server/db-client";
import { formatCaseNumber } from "../src/lib/domain/labels";
import { isPotentiallySerious } from "../src/lib/domain/seriousness";
import { buildCaseSnapshot, caseSnapshotInclude } from "../src/lib/domain/snapshot";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/lib/demo";

const prisma = createPrismaClient();

/** Timestamp in Indian Standard Time, e.g. at("2026-10-18 10:30"). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+05:30`);

const json = (value: unknown) => value as Prisma.InputJsonValue;

type Users = Record<
  string,
  {
    id: string;
    name: string;
    email: string;
    occupation: string | null;
    address: string | null;
    pin: string | null;
    phone: string | null;
  }
>;

async function main() {
  if ((await prisma.institution.count()) > 0) {
    console.log("Database already contains data; seed skipped. Run `npm run db:reset` to reset and re-seed.");
    return;
  }

  const institution = await prisma.institution.create({
    data: {
      name: "Demo General Hospital (Fictional)",
      department: "Department of Pharmacy Practice",
      nextCaseNumber: 9,
    },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: Users = {};
  for (const [index, u] of DEMO_ACCOUNTS.entries()) {
    const created = await prisma.user.create({
      data: {
        institutionId: institution.id,
        email: u.email,
        name: u.name,
        passwordHash,
        roles: u.roles,
        designation: u.designation,
        occupation: u.occupation,
        address: "Demo General Hospital (Fictional), Demo City",
        pin: "000000",
        phone: `+91 00000 ${String(index + 1).padStart(5, "0")}`,
        isUrgentContact: u.isUrgentContact ?? false,
        canReassign: u.canReassign ?? false,
      },
    });
    // Short keys used below, e.g. "pharmacist", "hod", "chief.pharmacist".
    users[u.email.split("@")[0]] = created;
  }

  const audit = (
    action: string,
    createdAt: Date,
    actorId: string,
    caseId?: string,
    details?: Record<string, unknown>,
  ) =>
    prisma.auditLog.create({
      data: {
        institutionId: institution.id,
        caseId,
        actorId,
        action,
        createdAt,
        details: json({ seed: true, ...details }),
      },
    });

  const reporterSnapshot = (key: string, reportDate: string) => {
    const u = users[key];
    return {
      reporterName: u.name,
      reporterAddress: u.address,
      reporterPin: u.pin,
      reporterEmail: u.email,
      reporterPhone: u.phone,
      reporterOccupation: u.occupation,
      reportDate,
    };
  };

  type CaseInput = Omit<
    Prisma.AdrCaseUncheckedCreateInput,
    "institutionId" | "caseNumber" | "reporterId" | "investigations" | "suspectedMedicines" | "concomitantProducts"
  > & {
    reporter: string;
    investigations?: Omit<Prisma.InvestigationCreateManyAdrCaseInput, "position">[];
    suspected?: Omit<Prisma.SuspectedMedicineCreateManyAdrCaseInput, "position">[];
    concomitant?: Omit<Prisma.ConcomitantProductCreateManyAdrCaseInput, "position">[];
  };

  let sequence = 0;
  const createCase = async ({
    reporter,
    investigations = [],
    suspected = [],
    concomitant = [],
    ...fields
  }: CaseInput) => {
    sequence += 1;
    const created = await prisma.adrCase.create({
      data: {
        ...fields,
        institutionId: institution.id,
        caseNumber: formatCaseNumber(sequence),
        reporterId: users[reporter].id,
        isPotentiallySerious: isPotentiallySerious(fields.seriousAnswer, fields.seriousnessCriteria as never),
        investigations: { createMany: { data: investigations.map((row, position) => ({ ...row, position })) } },
        suspectedMedicines: { createMany: { data: suspected.map((row, position) => ({ ...row, position })) } },
        concomitantProducts: { createMany: { data: concomitant.map((row, position) => ({ ...row, position })) } },
      },
      include: caseSnapshotInclude,
    });
    await audit("CASE_CREATED", created.createdAt, created.reporterId, created.id);
    return created;
  };

  type CreatedCase = Awaited<ReturnType<typeof createCase>>;

  const saveVersion = async (
    c: CreatedCase,
    versionNo: number,
    reason: "SUBMITTED" | "RESUBMITTED" | "APPROVED",
    status: CaseStatus,
    createdById: string,
    createdAt: Date,
  ) => {
    await prisma.caseVersion.create({
      data: {
        caseId: c.id,
        versionNo,
        reason,
        snapshot: json({ ...buildCaseSnapshot(c), status }),
        createdById,
        createdAt,
      },
    });
  };

  const submit = async (c: CreatedCase, when: Date) => {
    await saveVersion(c, 1, "SUBMITTED", "SUBMITTED", c.reporterId, when);
    await audit("CASE_SUBMITTED", when, c.reporterId, c.id, { versionNo: 1 });
  };

  const claim = async (c: CreatedCase, reviewer: string, when: Date) => {
    await prisma.caseAssignment.create({
      data: {
        caseId: c.id,
        action: "CLAIMED",
        toUserId: users[reviewer].id,
        actorId: users[reviewer].id,
        createdAt: when,
      },
    });
    await audit("CASE_CLAIMED", when, users[reviewer].id, c.id);
  };

  const checklist = async (
    c: CreatedCase,
    reviewer: string,
    when: Date,
    versionNo: number,
    items: Prisma.ReviewChecklistItemCreateManyInput["item"][],
    exceptions: Partial<Record<string, string>> = {},
  ) => {
    for (const item of items) {
      const reason = exceptions[item];
      await prisma.reviewChecklistItem.create({
        data: {
          caseId: c.id,
          versionNo,
          item,
          outcome: reason ? "VERIFIED_WITH_EXCEPTION" : "VERIFIED",
          exceptionReason: reason,
          reviewerId: users[reviewer].id,
          createdAt: when,
        },
      });
    }
    await audit("CHECKLIST_RECORDED", when, users[reviewer].id, c.id, { versionNo, items });
  };

  // ADR-001: the specification's example, waiting in the queue.
  const adr001 = await createCase({
    reporter: "pharmacist",
    status: "SUBMITTED",
    patientInitials: "R.K.",
    ageValue: 34,
    ageUnit: "YEARS",
    gender: "FEMALE",
    weightKg: 58,
    reactionTerms: "Maculopapular rash",
    reactionDescription:
      "Itchy red maculopapular rash over the trunk and both arms, first noticed two days after starting amoxicillin.",
    reactionManagement:
      "Amoxicillin stopped on 15/10/2026. Cetirizine 10 mg once daily started. Rash improving by 17/10/2026.",
    reactionStartDate: "2026-10-14",
    medicalHistory: "No previous drug allergy recorded.",
    seriousAnswer: "NO",
    outcome: "RECOVERING",
    suspected: [
      {
        name: "Amoxicillin 500 mg capsule",
        dose: "500 mg",
        route: "Oral",
        frequency: "TID (three times daily)",
        startDate: "2026-10-12",
        stopDate: "2026-10-15",
        indication: "Acute sinusitis",
        actionTaken: "DRUG_WITHDRAWN",
        rechallenge: "NOT_REINTRODUCED",
        unknownFields: ["manufacturer", "batchLot", "expiryDate"],
      },
    ],
    concomitant: [
      {
        name: "Cetirizine 10 mg tablet",
        dose: "10 mg",
        route: "Oral",
        frequency: "OD (once daily)",
        startDate: "2026-10-15",
        ongoing: true,
        indication: "Treatment of the rash",
        usedToTreatReaction: true,
      },
    ],
    firstSubmittedAt: at("2026-10-18 10:30"),
    lastSubmittedAt: at("2026-10-18 10:30"),
    currentVersion: 1,
    ...reporterSnapshot("pharmacist", "2026-10-18"),
    createdAt: at("2026-10-18 09:50"),
    updatedAt: at("2026-10-18 10:30"),
  });
  await submit(adr001, at("2026-10-18 10:30"));

  // ADR-002: an unfinished draft with partial dates.
  await createCase({
    reporter: "pharmacist",
    status: "DRAFT",
    patientInitials: "S.P.",
    ageValue: 61,
    ageUnit: "YEARS",
    gender: "MALE",
    reactionTerms: "Dry cough",
    reactionStartDate: "2026-09",
    suspected: [
      {
        name: "Enalapril 5 mg tablet",
        dose: "5 mg",
        route: "Oral",
        frequency: "OD (once daily)",
        startDate: "2026-08",
        startDateApprox: true,
        ongoing: true,
        indication: "Hypertension",
      },
    ],
    createdAt: at("2026-10-20 16:05"),
    updatedAt: at("2026-10-20 16:20"),
  });

  // ADR-003: under review by the HoD.
  const adr003 = await createCase({
    reporter: "physician",
    status: "UNDER_REVIEW",
    patientInitials: "A.M.",
    ageValue: 52,
    ageUnit: "YEARS",
    gender: "MALE",
    weightKg: 81,
    reactionTerms: "Nausea; diarrhoea",
    reactionDescription:
      "Nausea and loose stools (three to four a day) starting four days after metformin was started.",
    reactionManagement: "Advised to take metformin with meals; oral fluids.",
    reactionStartDate: "2026-10-08",
    reactionOngoing: true,
    medicalHistory: "Type 2 diabetes mellitus, newly diagnosed.",
    seriousAnswer: "NO",
    outcome: "RECOVERING",
    suspected: [
      {
        name: "Metformin 500 mg tablet",
        dose: "500 mg",
        route: "Oral",
        frequency: "BD (twice daily)",
        startDate: "2026-10-04",
        ongoing: true,
        indication: "Type 2 diabetes mellitus",
        actionTaken: "DOSE_NOT_CHANGED",
        rechallenge: "NOT_REINTRODUCED",
      },
    ],
    assigneeId: users.hod.id,
    claimedAt: at("2026-10-21 09:15"),
    firstSubmittedAt: at("2026-10-20 15:40"),
    lastSubmittedAt: at("2026-10-20 15:40"),
    currentVersion: 1,
    ...reporterSnapshot("physician", "2026-10-20"),
    createdAt: at("2026-10-20 15:10"),
    updatedAt: at("2026-10-21 09:42"),
  });
  await submit(adr003, at("2026-10-20 15:40"));
  await claim(adr003, "hod", at("2026-10-21 09:15"));
  await checklist(adr003, "hod", at("2026-10-21 09:40"), 1, ["PATIENT_DATA", "REACTION_CHRONOLOGY"]);
  await prisma.reviewComment.create({
    data: {
      caseId: adr003.id,
      versionNo: 1,
      authorId: users.hod.id,
      kind: "NOTE",
      body: "Chronology is consistent with the reported start of metformin. No concomitant medicines reported.",
      createdAt: at("2026-10-21 09:42"),
    },
  });
  await audit("COMMENT_ADDED", at("2026-10-21 09:42"), users.hod.id, adr003.id, { kind: "NOTE" });

  // ADR-004: returned for correction with an open issue; stays with the same reviewer.
  const adr004 = await createCase({
    reporter: "pharmacist",
    status: "RETURNED",
    patientInitials: "N.D.",
    ageValue: 45,
    ageUnit: "YEARS",
    gender: "FEMALE",
    weightKg: 64,
    reactionTerms: "Achilles tendon pain",
    reactionDescription: "Pain and tenderness over the left Achilles tendon after starting ciprofloxacin.",
    reactionManagement: "Ciprofloxacin discontinued. Rest advised; paracetamol as needed.",
    reactionStartDate: "2026-10-11",
    seriousAnswer: "NO",
    outcome: "RECOVERING",
    suspected: [
      {
        name: "Ciprofloxacin 500 mg tablet",
        dose: "500 mg",
        route: "Oral",
        frequency: "BD (twice daily)",
        startDate: "2026-10-07",
        indication: "Urinary tract infection",
        actionTaken: "DRUG_WITHDRAWN",
        rechallenge: "NOT_REINTRODUCED",
      },
    ],
    concomitant: [
      {
        name: "Paracetamol 500 mg tablet",
        dose: "500 mg",
        route: "Oral",
        frequency: "SOS (as needed)",
        startDate: "2026-10-12",
        indication: "Pain relief for the reaction",
        usedToTreatReaction: true,
      },
    ],
    assigneeId: users.consultant.id,
    claimedAt: at("2026-10-17 09:00"),
    firstSubmittedAt: at("2026-10-16 11:00"),
    lastSubmittedAt: at("2026-10-16 11:00"),
    currentVersion: 1,
    ...reporterSnapshot("pharmacist", "2026-10-16"),
    createdAt: at("2026-10-16 10:20"),
    updatedAt: at("2026-10-17 10:05"),
  });
  await submit(adr004, at("2026-10-16 11:00"));
  await claim(adr004, "consultant", at("2026-10-17 09:00"));
  await prisma.reviewComment.create({
    data: {
      caseId: adr004.id,
      versionNo: 1,
      authorId: users.consultant.id,
      kind: "ISSUE",
      issueStatus: "OPEN",
      fieldPath: `suspectedMedicines.${adr004.suspectedMedicines[0].id}.stopDate`,
      body: "Please add the date ciprofloxacin was stopped, or mark it as unknown if it is genuinely not available.",
      createdAt: at("2026-10-17 10:00"),
    },
  });
  await audit("COMMENT_ADDED", at("2026-10-17 10:00"), users.consultant.id, adr004.id, { kind: "ISSUE" });
  await prisma.reviewDecision.create({
    data: {
      caseId: adr004.id,
      versionNo: 1,
      reviewerId: users.consultant.id,
      decision: "RETURN",
      reason: "Stop date of the suspected medicine is missing.",
      createdAt: at("2026-10-17 10:05"),
    },
  });
  await audit("CASE_RETURNED", at("2026-10-17 10:05"), users.consultant.id, adr004.id, { versionNo: 1 });

  // ADR-005: approved with one acknowledged exception.
  const adr005 = await createCase({
    reporter: "physician",
    status: "APPROVED",
    patientInitials: "K.V.",
    ageValue: 58,
    ageUnit: "YEARS",
    gender: "MALE",
    weightKg: 76,
    reactionTerms: "Myalgia",
    reactionDescription:
      "Generalised muscle aches, worst in both thighs, about three weeks after starting atorvastatin.",
    reactionManagement: "Atorvastatin withheld.",
    reactionStartDate: "2026-10-03",
    reactionStartDateApprox: true,
    reactionStopDate: "2026-10-12",
    seriousAnswer: "NO",
    outcome: "RECOVERED",
    investigations: [
      { testName: "Creatine kinase (CK)", result: "Within the laboratory reference range", date: "2026-10-06" },
    ],
    suspected: [
      {
        name: "Atorvastatin 20 mg tablet",
        dose: "20 mg",
        route: "Oral",
        frequency: "OD (once daily, at night)",
        startDate: "2026-09-12",
        stopDate: "2026-10-06",
        indication: "Dyslipidaemia",
        actionTaken: "DRUG_WITHDRAWN",
        rechallenge: "NOT_REINTRODUCED",
        unknownFields: ["manufacturer", "batchLot", "expiryDate"],
      },
    ],
    assigneeId: users["chief.pharmacist"].id,
    claimedAt: at("2026-10-10 10:00"),
    approvedAt: at("2026-10-11 12:30"),
    firstSubmittedAt: at("2026-10-09 14:00"),
    lastSubmittedAt: at("2026-10-09 14:00"),
    currentVersion: 2,
    ...reporterSnapshot("physician", "2026-10-09"),
    createdAt: at("2026-10-09 13:15"),
    updatedAt: at("2026-10-11 12:30"),
  });
  await submit(adr005, at("2026-10-09 14:00"));
  await claim(adr005, "chief.pharmacist", at("2026-10-10 10:00"));
  await prisma.reviewComment.create({
    data: {
      caseId: adr005.id,
      versionNo: 1,
      authorId: users["chief.pharmacist"].id,
      kind: "ISSUE",
      issueStatus: "ACKNOWLEDGED_UNAVAILABLE",
      fieldPath: `suspectedMedicines.${adr005.suspectedMedicines[0].id}.batchLot`,
      body: "Is the batch number of the atorvastatin strip available?",
      resolutionNote: "Patient discarded the strip; the batch number cannot be obtained.",
      resolvedById: users["chief.pharmacist"].id,
      resolvedAt: at("2026-10-11 12:10"),
      createdAt: at("2026-10-10 10:20"),
    },
  });
  await audit("COMMENT_ADDED", at("2026-10-10 10:20"), users["chief.pharmacist"].id, adr005.id, { kind: "ISSUE" });
  await audit("ISSUE_ACKNOWLEDGED_UNAVAILABLE", at("2026-10-11 12:10"), users["chief.pharmacist"].id, adr005.id);
  await checklist(
    adr005,
    "chief.pharmacist",
    at("2026-10-11 12:20"),
    1,
    [
      "PATIENT_DATA",
      "REACTION_CHRONOLOGY",
      "SUSPECTED_MEDICATION",
      "CLINICAL_EVIDENCE",
      "SERIOUSNESS_OUTCOME",
      "REPORTER_COMPLETENESS",
    ],
    { SUSPECTED_MEDICATION: "Batch number and expiry date genuinely unavailable: the patient discarded the strip." },
  );
  await prisma.reviewDecision.create({
    data: {
      caseId: adr005.id,
      versionNo: 1,
      reviewerId: users["chief.pharmacist"].id,
      decision: "APPROVE",
      createdAt: at("2026-10-11 12:30"),
    },
  });
  await saveVersion(adr005, 2, "APPROVED", "APPROVED", users["chief.pharmacist"].id, at("2026-10-11 12:30"));
  await audit("CASE_APPROVED", at("2026-10-11 12:30"), users["chief.pharmacist"].id, adr005.id, { versionNo: 2 });

  // ADR-006: potentially serious, waiting unassigned at the top of the queue.
  const adr006 = await createCase({
    reporter: "pharmacist",
    status: "SUBMITTED",
    patientInitials: "P.S.",
    ageValue: 29,
    ageUnit: "YEARS",
    gender: "FEMALE",
    weightKg: 55,
    reactionTerms: "Generalised urticaria; hypotension",
    reactionDescription:
      "Widespread urticaria with a fall in blood pressure about 20 minutes into an intravenous ceftriaxone infusion.",
    reactionManagement:
      "Infusion stopped. Intravenous hydrocortisone and intravenous fluids given. Admitted for observation.",
    reactionStartDate: "2026-10-21",
    medicalHistory: "No previous drug allergy recorded.",
    seriousAnswer: "YES",
    seriousnessCriteria: ["HOSPITALISATION"],
    outcome: "RECOVERING",
    suspected: [
      {
        name: "Ceftriaxone 1 g injection",
        dose: "1 g",
        route: "Intravenous",
        frequency: "OD (once daily)",
        startDate: "2026-10-21",
        stopDate: "2026-10-21",
        indication: "Community-acquired pneumonia",
        actionTaken: "DRUG_WITHDRAWN",
        rechallenge: "NOT_REINTRODUCED",
      },
    ],
    concomitant: [
      {
        name: "Hydrocortisone 100 mg injection",
        dose: "100 mg",
        route: "Intravenous",
        frequency: "Single dose",
        startDate: "2026-10-21",
        stopDate: "2026-10-21",
        indication: "Treatment of the reaction",
        usedToTreatReaction: true,
      },
    ],
    firstSubmittedAt: at("2026-10-22 08:10"),
    lastSubmittedAt: at("2026-10-22 08:10"),
    currentVersion: 1,
    ...reporterSnapshot("pharmacist", "2026-10-22"),
    createdAt: at("2026-10-22 07:30"),
    updatedAt: at("2026-10-22 08:10"),
  });
  await submit(adr006, at("2026-10-22 08:10"));

  // ADR-007: incomplete draft, potentially serious, escalated urgently (not yet acknowledged).
  const adr007 = await createCase({
    reporter: "physician",
    status: "DRAFT",
    patientInitials: "G.T.",
    ageValue: 38,
    ageUnit: "YEARS",
    gender: "MALE",
    reactionTerms: "Severe skin reaction with mucosal involvement",
    reactionDescription: "Blistering rash with oral ulceration. Further details are still being collected.",
    reactionStartDate: "2026-10-21",
    seriousAnswer: "YES",
    seriousnessCriteria: ["HOSPITALISATION", "OTHER_MEDICALLY_IMPORTANT"],
    suspected: [
      { name: "Carbamazepine", startDate: "2026-10", startDateApprox: true, ongoing: false, indication: "Epilepsy" },
    ],
    createdAt: at("2026-10-22 07:20"),
    updatedAt: at("2026-10-22 07:45"),
  });
  await prisma.urgentEscalation.create({
    data: {
      caseId: adr007.id,
      raisedById: users.physician.id,
      raisedAt: at("2026-10-22 07:45"),
      note: "Patient admitted with extensive blistering and oral ulceration. Full details to follow.",
      snapshot: json(buildCaseSnapshot(adr007)),
    },
  });
  await audit("ESCALATION_RAISED", at("2026-10-22 07:45"), users.physician.id, adr007.id);

  // ADR-008: approved, externally submitted and acknowledged (tracking record only).
  const adr008 = await createCase({
    reporter: "pharmacist",
    status: "ACKNOWLEDGED",
    patientInitials: "M.L.",
    ageValue: 67,
    ageUnit: "YEARS",
    gender: "FEMALE",
    weightKg: 60,
    reactionTerms: "Hyponatraemia",
    reactionDescription: "Fatigue with low serum sodium about two weeks after starting hydrochlorothiazide.",
    reactionManagement: "Hydrochlorothiazide stopped. Fluid restriction advised.",
    reactionStartDate: "2026-09-25",
    reactionStopDate: "2026-10-02",
    seriousAnswer: "NO",
    outcome: "RECOVERED",
    investigations: [
      { testName: "Serum sodium", result: "126 mmol/L", date: "2026-09-25" },
      { testName: "Serum sodium", result: "135 mmol/L", date: "2026-10-02" },
    ],
    suspected: [
      {
        name: "Hydrochlorothiazide 12.5 mg tablet",
        dose: "12.5 mg",
        route: "Oral",
        frequency: "OD (once daily)",
        startDate: "2026-09-11",
        stopDate: "2026-09-25",
        indication: "Hypertension",
        actionTaken: "DRUG_WITHDRAWN",
        rechallenge: "NOT_REINTRODUCED",
      },
    ],
    concomitant: [
      {
        name: "Amlodipine 5 mg tablet",
        dose: "5 mg",
        route: "Oral",
        frequency: "OD (once daily)",
        startDate: "2025",
        ongoing: true,
        indication: "Hypertension",
      },
    ],
    assigneeId: users["amc.coordinator"].id,
    claimedAt: at("2026-10-04 09:30"),
    approvedAt: at("2026-10-05 11:00"),
    firstSubmittedAt: at("2026-10-03 16:00"),
    lastSubmittedAt: at("2026-10-03 16:00"),
    currentVersion: 2,
    ...reporterSnapshot("pharmacist", "2026-10-03"),
    createdAt: at("2026-10-03 15:20"),
    updatedAt: at("2026-10-08 15:35"),
  });
  await submit(adr008, at("2026-10-03 16:00"));
  await claim(adr008, "amc.coordinator", at("2026-10-04 09:30"));
  await checklist(adr008, "amc.coordinator", at("2026-10-05 10:50"), 1, [
    "PATIENT_DATA",
    "REACTION_CHRONOLOGY",
    "SUSPECTED_MEDICATION",
    "CLINICAL_EVIDENCE",
    "SERIOUSNESS_OUTCOME",
    "REPORTER_COMPLETENESS",
  ]);
  await prisma.reviewDecision.create({
    data: {
      caseId: adr008.id,
      versionNo: 1,
      reviewerId: users["amc.coordinator"].id,
      decision: "APPROVE",
      createdAt: at("2026-10-05 11:00"),
    },
  });
  await saveVersion(adr008, 2, "APPROVED", "APPROVED", users["amc.coordinator"].id, at("2026-10-05 11:00"));
  await audit("CASE_APPROVED", at("2026-10-05 11:00"), users["amc.coordinator"].id, adr008.id, { versionNo: 2 });
  await prisma.externalSubmission.create({
    data: {
      caseId: adr008.id,
      kind: "ROUTINE",
      method: "AMC_EMAIL",
      destination: "AMC, Demo Medical College (Fictional)",
      submittedAt: at("2026-10-06 11:00"),
      recordedById: users["amc.coordinator"].id,
      notes: "Approved PDF emailed to the AMC.",
      acknowledgedAt: at("2026-10-08 15:30"),
      acknowledgementReference: "FICTIONAL-ACK-0001",
      acknowledgementNotes: "Receipt acknowledged by email (fictional).",
      acknowledgementRecordedById: users["amc.coordinator"].id,
      createdAt: at("2026-10-06 11:05"),
    },
  });
  await audit("EXTERNAL_SUBMISSION_RECORDED", at("2026-10-06 11:05"), users["amc.coordinator"].id, adr008.id, {
    kind: "ROUTINE",
    method: "AMC_EMAIL",
  });
  await audit("EXTERNAL_ACKNOWLEDGEMENT_RECORDED", at("2026-10-08 15:35"), users["amc.coordinator"].id, adr008.id);

  console.log(`Seeded ${DEMO_ACCOUNTS.length} fictional accounts and ${sequence} fictional cases.`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
