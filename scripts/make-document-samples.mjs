import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const directory = "samples/documents";
await mkdir(directory, { recursive: true });
const samples = {
  "fictional-lab-report.pdf": [
    "FICTIONAL LAB REPORT - TRAINING SAMPLE ONLY",
    "Patient initials: R.K.    Age: 34 years    Gender: Female",
    "Sample date: approximately October 2026 (day not recorded)",
    "Serum creatinine: 2.1 mg/dL (reference 0.6-1.2 mg/dL)",
    "ALT: 82 U/L (reference 7-56 U/L)",
    "No medicines or adverse reaction are described in this report.",
  ],
  "fictional-discharge-summary.pdf": [
    "FICTIONAL DISCHARGE SUMMARY - TRAINING SAMPLE ONLY",
    "Patient initials: R.K.    Age: 34 years    Gender: Female",
    "Medical history: No known prior drug allergies recorded.",
    "Amoxicillin 500 mg capsule, oral, three times daily, for acute sinusitis.",
    "Amoxicillin started 12 October 2026; stopped 15 October 2026.",
    "Itchy rash on both arms began 14 October 2026.",
    "Cetirizine 10 mg orally once daily given from 15 October 2026 for the rash.",
    "Rash improved by 17 October 2026; complete resolution date not recorded.",
    "No causality assessment is recorded in this summary.",
  ],
};
for (const [name, lines] of Object.entries(samples)) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  lines.forEach((text, index) =>
    page.drawText(text, { x: 35, y: 790 - index * 32, font, size: index === 0 ? 12 : 10, color: rgb(0, 0, 0) }),
  );
  pdf.setTitle(lines[0]);
  await writeFile(`${directory}/${name}`, await pdf.save());
  console.log(`Wrote ${directory}/${name}`);
}
