import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import fieldMap from "../../../docs/reference/adrrf-v1.4-field-map.json";
import type { CaseSnapshot } from "@/lib/domain/snapshot";
import { formatForOfficialForm } from "@/lib/domain/partial-date";

// Fills the official PvPI Suspected ADR Reporting Form v1.4 (ADRRF_2.pdf) using
// the verified field map. Rules (docs/ARCHITECTURE_PLAN.md, sections 2 and 9):
// - partial dates in words, approximate dates prefixed "approx.", never a placeholder
// - "Unknown" only where the reporter marked a field unknown
// - AMC/NCC identifiers, receiving personnel, causality and reporter signature never filled
// - anything that does not fit goes on a continuation sheet; nothing is cut off

export interface PdfOptions {
  mode: "draft" | "approved";
  caseNumber: string;
  versionLabel: string;
  generatedOn: string; // dd/mm/yyyy
  fictional: boolean;
  /** Tests read the filled fields back; real output is flattened. */
  flatten?: boolean;
}

export interface PdfResult {
  bytes: Uint8Array;
  filledFields: Record<string, string>;
  continuation: { label: string; text: string }[];
  replacedCharacters: boolean;
}

type FieldMap = typeof fieldMap;
const F = fieldMap.fields as FieldMap["fields"];
const PROTECTED = new Set<string>([
  ...Object.values(fieldMap.neverFillAutomatically),
  F["reporter.signature"],
  ...fieldMap.suspectedMedicines.rows.map((r) => r.causalityAssessment),
]);

// The blank official form. Node.js (tests, local API) reads it from docs/reference;
// the Edge Function installs a loader that fetches it from the website.
let template: Uint8Array | null = null;
let loader = async () => new Uint8Array(await readFile(path.join(process.cwd(), "docs/reference/ADRRF_2.pdf")));

export function setFormTemplateLoader(load: () => Promise<Uint8Array>) {
  loader = load;
  template = null;
}

async function loadTemplate(): Promise<Uint8Array> {
  template ??= await loader();
  return template;
}

const AGE_UNITS: Record<string, string> = { YEARS: "years", MONTHS: "months", WEEKS: "weeks", DAYS: "days" };
const HISTORY: Record<string, string> = {
  ALLERGY: "allergy",
  PREGNANCY: "pregnancy",
  ADDICTION: "addiction",
  HEPATIC_DYSFUNCTION: "hepatic dysfunction",
  RENAL_DYSFUNCTION: "renal dysfunction",
};
const CRITERIA: Record<string, keyof FieldMap["fields"]> = {
  DEATH: "seriousness.death",
  LIFE_THREATENING: "seriousness.lifeThreatening",
  HOSPITALISATION: "seriousness.hospitalization",
  CONGENITAL_ANOMALY: "seriousness.congenitalAnomaly",
  DISABILITY: "seriousness.disability",
  OTHER_MEDICALLY_IMPORTANT: "seriousness.otherMedicallyImportant",
};
const OUTCOMES: Record<string, keyof FieldMap["fields"]> = {
  RECOVERED: "outcome.recovered",
  RECOVERING: "outcome.recovering",
  NOT_RECOVERED: "outcome.notRecovered",
  FATAL: "outcome.fatal",
  RECOVERED_WITH_SEQUELAE: "outcome.recoveredWithSequelae",
  UNKNOWN: "outcome.unknown",
};
const ACTION_COLUMNS: Record<string, keyof FieldMap["actionTakenAfterReaction"]["rows"][number]> = {
  DRUG_WITHDRAWN: "drugWithdrawn",
  DOSE_INCREASED: "doseIncreased",
  DOSE_REDUCED: "doseReduced",
  DOSE_NOT_CHANGED: "doseNotChanged",
  NOT_APPLICABLE: "notApplicable",
  UNKNOWN: "unknown",
};
const RECHALLENGE_COLUMNS: Record<string, "yes" | "no" | "effectUnknown"> = {
  YES: "yes",
  NO: "no",
  EFFECT_UNKNOWN: "effectUnknown",
};
const ROMAN = ["i", "ii", "iii", "iv"];

/** Replaces characters the standard PDF font cannot print (WinAnsi), so generation never fails. */
function printable(font: PDFFont, text: string, flag: { replaced: boolean }) {
  const replacements: Record<string, string> = { "≤": "<=", "≥": ">=", "→": "->", "×": "x", "≈": "~", "\t": " " };
  let out = "";
  for (const ch of text.replace(/\r/g, "")) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    const candidate = replacements[ch] ?? ch;
    try {
      font.encodeText(candidate);
      out += candidate;
    } catch {
      out += "?";
      flag.replaced = true;
    }
  }
  return out;
}

export async function generatePvpiPdf(s: CaseSnapshot, options: PdfOptions): Promise<PdfResult> {
  const pdf = await PDFDocument.load(await loadTemplate());
  const form = pdf.getForm();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const flag = { replaced: false };
  const filled: Record<string, string> = {};
  const continuation: { label: string; text: string }[] = [];
  const clean = (t: string) => printable(helv, t, flag);
  const rectOf = (name: string) => form.getField(name).acroField.getWidgets()[0].getRectangle();

  const guard = (name: string) => {
    if (PROTECTED.has(name)) throw new Error(`Refusing to fill protected box ${name}`);
  };

  function wrap(text: string, size: number, width: number) {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (helv.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** One-line box: 8 pt, shrinking to 6 pt; longer text goes to the continuation sheet. */
  const cell = (name: string, raw: string | null | undefined, label: string) => {
    if (!raw) return;
    guard(name);
    const text = clean(raw);
    const field = form.getTextField(name);
    const { width } = rectOf(name);
    field.disableMultiline();
    let size = 8;
    while (size > 6 && helv.widthOfTextAtSize(text, size) > width - 3) size -= 0.5;
    let shown = text;
    if (helv.widthOfTextAtSize(text, size) > width - 3) {
      continuation.push({ label, text });
      shown = helv.widthOfTextAtSize("See cont. sheet", 6) <= width - 3 ? "See cont. sheet" : "See cont.";
      size = 6;
    }
    field.setText(shown);
    field.setFontSize(size);
    filled[name] = shown;
  };

  /** Multi-line box at 8 pt; lines that do not fit continue on the continuation sheet. */
  const box = (name: string, raw: string, label: string) => {
    if (!raw.trim()) return;
    guard(name);
    const text = clean(raw);
    const field = form.getTextField(name);
    const { width, height } = rectOf(name);
    field.enableMultiline();
    const lines = wrap(text, 8, width - 6);
    const maxLines = Math.max(1, Math.floor((height - 4) / (8 * 1.17)));
    let shown = lines;
    if (lines.length > maxLines) {
      shown = [...lines.slice(0, maxLines - 1), "(continued on the continuation sheet)"];
      continuation.push({ label, text: lines.slice(maxLines - 1).join(" ") });
    }
    field.setText(shown.join("\n"));
    field.setFontSize(8);
    filled[name] = shown.join("\n");
  };

  const tick = (name: string) => {
    guard(name);
    form.getCheckBox(name).check();
    filled[name] = "X";
  };

  const unknownCase = new Set(s.unknownFields ?? []);
  const orUnknown = (value: string | null | undefined, unknown: boolean) => (value ? value : unknown ? "Unknown" : "");
  const date = (v: string | null | undefined, approx?: boolean | null) =>
    formatForOfficialForm(v ?? null, Boolean(approx));

  // A. Patient
  cell(F["patient.initials"], s.patient.initials, "1. Patient initials");
  cell(
    F["patient.ageOrDateOfBirth"],
    s.patient.ageValue != null
      ? `${s.patient.ageValue} ${AGE_UNITS[s.patient.ageUnit ?? "YEARS"]}`
      : date(s.patient.dateOfBirth, s.patient.dateOfBirthApprox),
    "2. Age or date of birth",
  );
  if (s.patient.gender === "MALE") tick(F["patient.gender.male"]);
  if (s.patient.gender === "FEMALE") tick(F["patient.gender.female"]);
  if (s.patient.gender === "OTHER") tick(F["patient.gender.other"]);
  if (!s.patient.gender && unknownCase.has("gender")) continuation.push({ label: "3. Gender", text: "Unknown" });
  cell(
    F["patient.weightKg"],
    orUnknown(s.patient.weightKg != null ? String(s.patient.weightKg) : null, unknownCase.has("weightKg")),
    "4. Weight (kg)",
  );

  // B. Reaction
  cell(F["reaction.startDate"], date(s.reaction.startDate, s.reaction.startDateApprox), "5. Reaction start date");
  cell(
    F["reaction.stopDate"],
    s.reaction.ongoing
      ? "Ongoing"
      : orUnknown(date(s.reaction.stopDate, s.reaction.stopDateApprox), unknownCase.has("reactionStopDate")),
    "6. Reaction stop date",
  );
  const treated = s.concomitantProducts.filter((p) => p.usedToTreatReaction);
  const item7 = [
    s.reaction.terms ? `Reaction: ${s.reaction.terms}` : "",
    s.reaction.description ?? "",
    s.reaction.management ? `Management: ${s.reaction.management}` : "",
    ...treated.map(
      (p) =>
        `Given for the reaction: ${[p.name, p.dose, p.route, p.frequency].filter(Boolean).join(", ")}` +
        (p.startDate ? `, from ${date(p.startDate, p.startDateApprox)}` : "") +
        (p.ongoing ? ", ongoing" : p.stopDate ? ` to ${date(p.stopDate, p.stopDateApprox)}` : "") +
        ".",
    ),
  ].filter(Boolean);
  box(F["reaction.descriptionAndManagement"], item7.join("\n"), "7. Event/reaction and management");
  box(
    F["investigations"],
    s.investigations
      .map((i) => {
        const when = i.date
          ? ` (${date(i.date, i.dateApprox)})`
          : i.unknownFields?.includes("date")
            ? " (date unknown)"
            : "";
        return `${i.testName ?? "Test"}: ${i.result ?? "result not recorded"}${when}`;
      })
      .join("\n"),
    "12. Relevant investigations",
  );
  const flags = (s.history.flags ?? []).map((f) => HISTORY[f]);
  box(
    F["medicalHistory"],
    unknownCase.has("medicalHistory")
      ? "Unknown"
      : [s.history.text ?? "", flags.length ? `Relevant: ${flags.join(", ")}.` : ""].filter(Boolean).join("\n"),
    "13. Medical/medication history",
  );
  const criteria = s.seriousness.criteria ?? [];
  if (s.seriousness.answer === "NO" && criteria.length === 0) tick(F["seriousness.no"]);
  if (s.seriousness.answer === "YES" || criteria.length) tick(F["seriousness.yes"]);
  for (const c of criteria) tick(F[CRITERIA[c]]);
  cell(F["seriousness.deathDate"], date(s.seriousness.deathDate, s.seriousness.deathDateApprox), "14. Date of death");
  if (s.outcome) tick(F[OUTCOMES[s.outcome]]);

  // C. Suspected medicines (items 8-10)
  s.suspectedMedicines.forEach((m, i) => {
    const u = new Set(m.unknownFields ?? []);
    const summary = () =>
      [
        m.name,
        m.dose,
        m.route,
        m.frequency,
        m.startDate && `from ${date(m.startDate, m.startDateApprox)}`,
        m.indication && `for ${m.indication}`,
      ]
        .filter(Boolean)
        .join(", ");
    if (i >= 4) {
      continuation.push({ label: `8. Suspected medicine ${i + 1}`, text: summary() });
      return;
    }
    const row = fieldMap.suspectedMedicines.rows[i];
    const r = ROMAN[i];
    cell(row.name, m.name, `8 (${r}) Name`);
    cell(row.manufacturer, orUnknown(m.manufacturer, u.has("manufacturer")), `8 (${r}) Manufacturer`);
    cell(row.batchLotNo, orUnknown(m.batchLot, u.has("batchLot")), `8 (${r}) Batch/lot`);
    cell(
      row.expiryDate,
      orUnknown(date(m.expiryDate, m.expiryDateApprox), u.has("expiryDate")),
      `8 (${r}) Expiry date`,
    );
    cell(row.dose, orUnknown(m.dose, u.has("dose")), `8 (${r}) Dose`);
    cell(row.route, orUnknown(m.route, u.has("route")), `8 (${r}) Route`);
    cell(row.frequency, orUnknown(m.frequency, u.has("frequency")), `8 (${r}) Frequency`);
    cell(row.dateStarted, orUnknown(date(m.startDate, m.startDateApprox), u.has("startDate")), `8 (${r}) Date started`);
    cell(
      row.dateStopped,
      m.ongoing ? "Ongoing" : orUnknown(date(m.stopDate, m.stopDateApprox), u.has("stopDate")),
      `8 (${r}) Date stopped`,
    );
    cell(row.indication, orUnknown(m.indication, u.has("indication")), `8 (${r}) Indication`);
    if (m.actionTaken) cell(fieldMap.actionTakenAfterReaction.rows[i][ACTION_COLUMNS[m.actionTaken]], "X", `9 (${r})`);
    const rechallenge = m.rechallenge ? RECHALLENGE_COLUMNS[m.rechallenge] : undefined;
    if (rechallenge) cell(fieldMap.reactionReappearedOnReintroduction.rows[i][rechallenge], "X", `10 (${r})`);
    if (m.rechallengeDose)
      cell(fieldMap.reactionReappearedOnReintroduction.rows[i].reintroducedDose, m.rechallengeDose, `10 (${r}) Dose`);
  });

  // Item 11: concomitant products, excluding those used to treat the reaction
  s.concomitantProducts
    .filter((p) => !p.usedToTreatReaction)
    .forEach((p, i) => {
      const u = new Set(p.unknownFields ?? []);
      if (i >= 3) {
        continuation.push({
          label: `11. Concomitant product ${i + 1}`,
          text: [p.name, p.dose, p.route, p.frequency, p.indication].filter(Boolean).join(", "),
        });
        return;
      }
      const row = fieldMap.concomitantProducts.rows[i];
      const r = ROMAN[i];
      cell(row.name, p.name, `11 (${r}) Name`);
      cell(row.dose, orUnknown(p.dose, u.has("dose")), `11 (${r}) Dose`);
      cell(row.route, orUnknown(p.route, u.has("route")), `11 (${r}) Route`);
      cell(row.frequency, orUnknown(p.frequency, u.has("frequency")), `11 (${r}) Frequency`);
      cell(
        row.dateStarted,
        orUnknown(date(p.startDate, p.startDateApprox), u.has("startDate")),
        `11 (${r}) Date started`,
      );
      cell(
        row.dateStopped,
        p.ongoing ? "Ongoing" : orUnknown(date(p.stopDate, p.stopDateApprox), u.has("stopDate")),
        `11 (${r}) Date stopped`,
      );
      cell(row.indication, orUnknown(p.indication, u.has("indication")), `11 (${r}) Indication`);
    });

  box(F["additionalInformation"], s.additionalInformation ?? "", "Additional information");

  // D. Reporter (snapshot taken at submission). The signature stays blank for handwriting.
  cell(F["reporter.nameAndAddressLine1"], s.reporter.name, "16. Name");
  cell(F["reporter.nameAndAddressLine2"], s.reporter.address, "16. Address");
  cell(F["reporter.pin"], s.reporter.pin, "16. PIN");
  cell(F["reporter.email"], s.reporter.email, "16. Email");
  cell(F["reporter.contactNo"], s.reporter.phone, "16. Contact number");
  cell(F["reporter.occupation"], s.reporter.occupation, "16. Occupation");
  cell(F["reporter.dateOfReport"], date(s.reporter.reportDate), "17. Date of this report");

  form.updateFieldAppearances(helv);
  if (options.flatten !== false) form.flatten();

  const grey = rgb(0.35, 0.39, 0.45);
  if (continuation.length) {
    let page = pdf.addPage([595.2, 841.92]);
    let y = 800;
    const heading = () => {
      page.drawText("SUSPECTED ADVERSE DRUG REACTION REPORTING FORM: CONTINUATION SHEET", {
        x: 40,
        y,
        size: 11,
        font: bold,
      });
      y -= 18;
      page.drawText(`Case ${options.caseNumber}. Entries that did not fit their box on page 1.`, {
        x: 40,
        y,
        size: 9,
        font: helv,
        color: grey,
      });
      y -= 24;
    };
    heading();
    for (const entry of continuation) {
      const lines = wrap(entry.text, 9, 515);
      if (y - 13 - lines.length * 12 < 60) {
        page = pdf.addPage([595.2, 841.92]);
        y = 800;
        heading();
      }
      page.drawText(entry.label, { x: 40, y, size: 9, font: bold });
      y -= 13;
      for (const line of lines) {
        page.drawText(line, { x: 52, y, size: 9, font: helv });
        y -= 12;
      }
      y -= 6;
    }
  }

  const reference = clean(
    `Internal ref ${options.caseNumber} · ${options.versionLabel} · generated ${options.generatedOn} · ADR Reporter${options.fictional ? " (fictional prototype)" : ""}`,
  );
  const marks = [
    ...(options.mode === "draft" ? ["DRAFT - NOT FOR SUBMISSION"] : []),
    ...(options.fictional ? ["FICTIONAL - DEMONSTRATION ONLY"] : []),
  ];
  const angle = (40 * Math.PI) / 180;
  for (const page of pdf.getPages()) {
    page.drawText(reference, { x: 30, y: 14, size: 7, font: helv, color: grey });
    const { width: pw, height: ph } = page.getSize();
    marks.forEach((text, i) => {
      const w = bold.widthOfTextAtSize(text, 34);
      const offset = (i - (marks.length - 1) / 2) * 52;
      page.drawText(text, {
        x: pw / 2 + offset * Math.sin(angle) - (w / 2) * Math.cos(angle),
        y: ph / 2 - offset * Math.cos(angle) - (w / 2) * Math.sin(angle),
        size: 34,
        font: bold,
        color: rgb(0.75, 0.1, 0.1),
        opacity: 0.1,
        rotate: degrees(40),
      });
    });
  }

  pdf.setTitle(`Suspected ADR report ${options.caseNumber} (${options.versionLabel})`);
  pdf.setProducer("ADR Reporter prototype");
  return { bytes: await pdf.save(), filledFields: filled, continuation, replacedCharacters: flag.replaced };
}

/** dd/mm/yyyy for the margin reference. */
export function ddmmyyyy(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
