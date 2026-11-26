// Scores the app's whole reading path (vision, double read, structuring, fixed rules) on drawn photos whose
// answers are known exactly (ml/vision/render.py). The expected reading is what a perfect reader produces from
// the true text: expandReading on the true answer.
//   npm run ai:evaluate-synthetic -- --data=ml/data/vision-packs [--limit=50]
// "Wrong and trusted" is the number that matters most: a wrong value shown as certain, which a reporter would not
// think to check. A wrong value marked uncertain is shown for checking at the final confirmation.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { chatExtractionSchema } from "../src/lib/domain/chat-extraction";
import { configuredProviders } from "../src/server/ai/provider";
import { compactSchema, expandReading } from "../src/server/ai/two-step";

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const data = arg("data", "ml/data/vision-packs");
const limit = Number(arg("limit", "0"));
const norm = (v: string | null | undefined) => v?.toLowerCase().replace(/®/g, "").replace(/\s+/g, " ").trim() || null;

type Reading = { value: string | null; uncertain: boolean };
type Tally = { right: number; wrongTrusted: number; wrongFlagged: number; missed: number; invented: number };
const FIELDS = ["documentType", "name", "composition", "batchLot", "expiryDate", "manufacturer"] as const;

async function main() {
  const provider = configuredProviders()[0];
  if (!provider) throw new Error("No AI provider is configured.");
  const rows = readFileSync(`${data}/labels.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { image: string; style: string; kind: string; transcript: string; target: unknown });
  const chosen = limit ? rows.slice(0, limit) : rows;
  const out = `${data}/pipeline-${provider.model.replace(/[:/+]/g, "_")}.jsonl`;
  writeFileSync(out, "");
  const tally = Object.fromEntries(
    FIELDS.map((f) => [f, { right: 0, wrongTrusted: 0, wrongFlagged: 0, missed: 0, invented: 0 }]),
  ) as Record<(typeof FIELDS)[number], Tally>;
  let refused = 0;
  const started = Date.now();

  for (const row of chosen) {
    const expected = expandReading(compactSchema.parse(row.target), row.transcript);
    const want: Record<string, string | null> = {
      documentType: expected.documentType,
      name: expected.medications[0]?.name.value ?? null,
      composition: expected.extraFields.find((e) => e.field === "composition")?.reading.value ?? null,
      batchLot: expected.medications[0]?.batchLot.value ?? null,
      expiryDate: expected.medications[0]?.expiryDate.value ?? null,
      manufacturer: expected.medications[0]?.manufacturer.value ?? null,
    };
    let got: Record<string, Reading> = {};
    try {
      const bytes = new Uint8Array(readFileSync(`${data}/${row.image}`));
      const { output } = await provider.generate({
        task: "extract-document",
        system: "",
        prompt: "",
        document: { bytes, mimeType: "image/jpeg" },
        schema: chatExtractionSchema,
      });
      const m = output.medications[0];
      const comp = output.extraFields.find((e) => e.field === "composition")?.reading;
      got = {
        documentType: { value: output.documentType, uncertain: false },
        name: { value: m?.name.value ?? null, uncertain: m?.name.uncertain ?? false },
        composition: { value: comp?.value ?? null, uncertain: comp?.uncertain ?? false },
        batchLot: { value: m?.batchLot.value ?? null, uncertain: m?.batchLot.uncertain ?? false },
        expiryDate: { value: m?.expiryDate.value ?? null, uncertain: m?.expiryDate.uncertain ?? false },
        manufacturer: { value: m?.manufacturer.value ?? null, uncertain: m?.manufacturer.uncertain ?? false },
      };
    } catch (error) {
      refused++;
      appendFileSync(out, `${JSON.stringify({ image: row.image, style: row.style, refused: String(error) })}\n`);
      console.log(`${row.image} ${row.style.padEnd(11)} refused: ${String(error).slice(0, 90)}`);
      continue;
    }
    const wrong: string[] = [];
    for (const f of FIELDS) {
      const w = norm(want[f]);
      const g = norm(got[f]?.value);
      const t = tally[f];
      if (!w && !g) continue;
      if (w === g) t.right++;
      else if (!g) t.missed++;
      else if (!w) t.invented++;
      else if (got[f].uncertain) t.wrongFlagged++;
      else t.wrongTrusted++;
      if (w !== g)
        wrong.push(
          `${f}: want ${JSON.stringify(want[f])} got ${JSON.stringify(got[f]?.value)}${got[f]?.uncertain ? " (flagged)" : ""}`,
        );
    }
    appendFileSync(out, `${JSON.stringify({ image: row.image, style: row.style, want, got, wrong })}\n`);
    console.log(`${row.image} ${row.style.padEnd(11)} ${wrong.length ? wrong.join(" | ") : "all right"}`);
  }

  console.log(
    `\n${chosen.length} photos, ${refused} refused as unreadable, ${Math.round((Date.now() - started) / chosen.length / 1000)}s each`,
  );
  console.log("field          right  wrong-trusted  wrong-flagged  missed  invented");
  for (const f of FIELDS) {
    const t = tally[f];
    const n = t.right + t.wrongTrusted + t.wrongFlagged + t.missed + t.invented;
    console.log(
      `${f.padEnd(14)} ${`${t.right}/${n}`.padEnd(6)} ${String(t.wrongTrusted).padEnd(14)} ${String(t.wrongFlagged).padEnd(14)} ${String(t.missed).padEnd(7)} ${t.invented}`,
    );
  }
}

void main();
