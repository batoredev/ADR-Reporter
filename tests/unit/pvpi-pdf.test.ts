import { PDFDocument, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import fieldMap from "../../docs/reference/adrrf-v1.4-field-map.json";
import { generatePvpiPdf, type PdfOptions } from "@/server/pdf/pvpi-form";
import { concomitant, medicine, snapshot } from "../fixtures/snapshot";

const F = fieldMap.fields;
const row = fieldMap.suspectedMedicines.rows[0];
const options: PdfOptions = {
  mode: "approved",
  caseNumber: "ADR-900",
  versionLabel: "v1",
  generatedOn: "25/10/2026",
  fictional: true,
  flatten: false,
};

const PROTECTED = [
  ...Object.values(fieldMap.neverFillAutomatically),
  F["reporter.signature"],
  ...fieldMap.suspectedMedicines.rows.map((r) => r.causalityAssessment),
];

describe("PvPI PDF generation", () => {
  it("never fills AMC/NCC identifiers, causality, receiving personnel or the signature", async () => {
    const full = snapshot({
      suspectedMedicines: [0, 1, 2, 3].map((i) => medicine({ name: `Medicine ${i + 1}`, position: i })),
    });
    const result = await generatePvpiPdf(full, options);
    for (const name of PROTECTED) expect(result.filledFields).not.toHaveProperty(name);

    // Read the produced PDF back: the protected text boxes are still empty.
    const form = (await PDFDocument.load(result.bytes)).getForm();
    for (const name of PROTECTED) {
      const field = form.getFieldMaybe(name);
      if (field instanceof PDFTextField) expect(field.getText() ?? "").toBe("");
    }
  });

  it("leaves the Initial Case and Follow-up Case boxes unticked", async () => {
    const { filledFields } = await generatePvpiPdf(snapshot(), options);
    expect(filledFields).not.toHaveProperty(F["caseType.initial"]);
    expect(filledFields).not.toHaveProperty(F["caseType.followUp"]);
  });

  it("writes partial and approximate dates without placeholders", async () => {
    const s = snapshot({
      reaction: {
        ...snapshot().reaction,
        startDate: "2026-10",
        startDateApprox: false,
        stopDate: "2026-10-23",
        stopDateApprox: true,
      },
      suspectedMedicines: [medicine({ startDate: "2025", stopDate: "2026-10-21" })],
    });
    const { filledFields } = await generatePvpiPdf(s, options);
    expect(filledFields[F["reaction.startDate"]]).toBe("Oct 2026");
    expect(filledFields[F["reaction.stopDate"]]).toBe("approx. 23/10/2026");
    expect(filledFields[row.dateStarted]).toBe("2025");
    expect(filledFields[row.dateStopped]).toBe("21/10/2026");
    expect(Object.values(filledFields).join(" ")).not.toMatch(/\b01\/10\/2026\b|01\/01\/2025/);
  });

  it("prints Unknown only where the reporter marked a field unknown", async () => {
    const marked = await generatePvpiPdf(
      snapshot({
        unknownFields: ["reactionStopDate"],
        suspectedMedicines: [medicine({ unknownFields: ["batchLot"] })],
      }),
      options,
    );
    expect(marked.filledFields[F["reaction.stopDate"]]).toBe("Unknown");
    expect(marked.filledFields[row.batchLotNo]).toBe("Unknown");

    const blank = await generatePvpiPdf(snapshot(), options);
    expect(blank.filledFields).not.toHaveProperty(F["reaction.stopDate"]);
    expect(blank.filledFields).not.toHaveProperty(row.batchLotNo);
  });

  it("ticks every selected seriousness criterion and never ticks No alongside them", async () => {
    const s = snapshot({
      seriousness: {
        answer: "YES",
        criteria: ["HOSPITALISATION", "OTHER_MEDICALLY_IMPORTANT"],
        deathDate: null,
        deathDateApprox: false,
        isPotentiallySerious: true,
      },
    });
    const { filledFields } = await generatePvpiPdf(s, options);
    expect(filledFields[F["seriousness.yes"]]).toBe("X");
    expect(filledFields[F["seriousness.hospitalization"]]).toBe("X");
    expect(filledFields[F["seriousness.otherMedicallyImportant"]]).toBe("X");
    expect(filledFields).not.toHaveProperty(F["seriousness.no"]);
    expect(filledFields).not.toHaveProperty(F["seriousness.death"]);
  });

  it("keeps full medicine names and moves anything that does not fit to the continuation sheet", async () => {
    const s = snapshot({
      suspectedMedicines: [
        medicine({ name: "Amoxicillin and potassium clavulanate 625 mg film-coated tablet" }),
        ...[1, 2, 3, 4].map((i) => medicine({ name: `Medicine ${i + 1}`, position: i })),
      ],
    });
    const { filledFields, continuation } = await generatePvpiPdf(s, options);
    expect(filledFields[row.name]).toMatch(/^See cont/);
    expect(continuation).toContainEqual({
      label: "8 (i) Name",
      text: "Amoxicillin and potassium clavulanate 625 mg film-coated tablet",
    });
    expect(continuation.some((c) => c.label === "8. Suspected medicine 5" && c.text.startsWith("Medicine 5"))).toBe(
      true,
    );
  });

  it("lists products given to treat the reaction under item 7, not item 11", async () => {
    const s = snapshot({
      concomitantProducts: [
        concomitant({ name: "Cetirizine", dose: "10 mg", usedToTreatReaction: true }),
        concomitant({ name: "Pantoprazole", dose: "40 mg" }),
      ],
    });
    const { filledFields } = await generatePvpiPdf(s, options);
    expect(filledFields[F["reaction.descriptionAndManagement"]]).toContain("Given for the reaction: Cetirizine, 10 mg");
    expect(filledFields[F["reaction.descriptionAndManagement"]]).toContain("Reaction: Urticarial rash\nItchy wheals");
    expect(filledFields[fieldMap.concomitantProducts.rows[0].name]).toBe("Pantoprazole");
  });
});
