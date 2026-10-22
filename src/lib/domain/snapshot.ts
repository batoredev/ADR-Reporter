// Builds the frozen JSON copy of a case stored in CaseVersion and
// UrgentEscalation. Pure function: no database or framework access.
import type { Prisma } from "@/generated/prisma/client";

export const caseSnapshotInclude = {
  investigations: { orderBy: { position: "asc" } },
  suspectedMedicines: { orderBy: { position: "asc" } },
  concomitantProducts: { orderBy: { position: "asc" } },
} satisfies Prisma.AdrCaseInclude;

export type CaseForSnapshot = Prisma.AdrCaseGetPayload<{ include: typeof caseSnapshotInclude }>;

const SNAPSHOT_SCHEMA_VERSION = 1;

export function buildCaseSnapshot(c: CaseForSnapshot) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    caseNumber: c.caseNumber,
    status: c.status,
    patient: {
      initials: c.patientInitials,
      ageValue: c.ageValue,
      ageUnit: c.ageUnit,
      dateOfBirth: c.dateOfBirth,
      dateOfBirthApprox: c.dateOfBirthApprox,
      gender: c.gender,
      weightKg: c.weightKg,
    },
    reaction: {
      terms: c.reactionTerms,
      description: c.reactionDescription,
      management: c.reactionManagement,
      startDate: c.reactionStartDate,
      startDateApprox: c.reactionStartDateApprox,
      stopDate: c.reactionStopDate,
      stopDateApprox: c.reactionStopDateApprox,
      ongoing: c.reactionOngoing,
    },
    history: { text: c.medicalHistory, flags: c.historyFlags },
    seriousness: {
      answer: c.seriousAnswer,
      criteria: c.seriousnessCriteria,
      deathDate: c.deathDate,
      deathDateApprox: c.deathDateApprox,
      isPotentiallySerious: c.isPotentiallySerious,
    },
    outcome: c.outcome,
    additionalInformation: c.additionalInformation,
    unknownFields: c.unknownFields,
    investigations: c.investigations.map(({ caseId, ...row }) => row),
    suspectedMedicines: c.suspectedMedicines.map(({ caseId, ...row }) => row),
    concomitantProducts: c.concomitantProducts.map(({ caseId, ...row }) => row),
    reporter: {
      name: c.reporterName,
      address: c.reporterAddress,
      pin: c.reporterPin,
      email: c.reporterEmail,
      phone: c.reporterPhone,
      occupation: c.reporterOccupation,
      reportDate: c.reportDate,
    },
  };
}

export type CaseSnapshot = ReturnType<typeof buildCaseSnapshot>;
