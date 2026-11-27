// Does zooming into a strip's batch/date block help the reader? Scores the app's reading path on 30 real strip and
// pack photos (Roboflow "major project", CC BY 4.0) whose batch, manufacturing and expiry dates were read by hand,
// once on the whole photo and once on the cut-out block (ml/detector/crops.py), keeping the orientation whose
// reading has the most of batch and expiry.
//   npm run ai:evaluate-pack-dates -- --full --crops=truth      (or --crops=detector)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chatExtractionSchema } from "../src/lib/domain/chat-extraction";
import { configuredProviders } from "../src/server/ai/provider";

type Photo = { id: number; file: string; batch: string | null; mfg: string; expiry: string; upside_down: boolean };
type Read = { batch: string | null; expiry: string | null; uncertain: boolean; error?: string };
const TEST = "ml/data/pack-dates-test";
const PHOTOS = "ml/data/roboflow-major-project/dataset/valid";
const clean = (s: string | null) => s?.toUpperCase().replace(/[\s.]/g, "") || null;

async function main() {
  const provider = configuredProviders()[0];
  const full = process.argv.includes("--full");
  const crops = process.argv.find((a) => a.startsWith("--crops="))?.slice(8);
  const photos = (JSON.parse(readFileSync("samples/pack-dates-benchmark.json", "utf8")) as { photos: Photo[] }).photos;

  const read = async (path: string): Promise<Read> => {
    try {
      const { output } = await provider.generate({
        task: "extract-document",
        system: "",
        prompt: "",
        document: { bytes: new Uint8Array(readFileSync(path)), mimeType: "image/jpeg" },
        schema: chatExtractionSchema,
      });
      const m = output.medications.find((x) => x.batchLot.value || x.expiryDate.value) ?? output.medications[0];
      return {
        batch: m?.batchLot.value ?? null,
        expiry: m?.expiryDate.value ?? null,
        uncertain: !!(m?.batchLot.uncertain || m?.expiryDate.uncertain),
      };
    } catch (error) {
      return { batch: null, expiry: null, uncertain: false, error: String(error).slice(0, 80) };
    }
  };

  const modes: Record<string, (p: Photo) => Promise<Read>> = {};
  if (full) modes.full = (p) => read(`${PHOTOS}/${p.file}`);
  if (crops) {
    const files = readdirSync(`${TEST}/crops-${crops}`);
    modes[`zoom-${crops}`] = async (p) => {
      const mine = files.filter((f) => f.startsWith(`${String(p.id).padStart(2, "0")}-`)).sort();
      let best: Read = { batch: null, expiry: null, uncertain: false, error: "no crop" };
      const score = (r: Read) => Number(!!r.batch) + Number(!!r.expiry);
      for (const f of mine) {
        const r = await read(`${TEST}/crops-${crops}/${f}`);
        if (score(r) > score(best) || best.error) best = r;
      }
      return best;
    };
  }

  const results: Record<string, unknown>[] = [];
  for (const [mode, run] of Object.entries(modes)) {
    const tally = { expiry: 0, batch: 0, batchTotal: 0, wrongTrusted: 0, missed: 0 };
    const started = Date.now();
    for (const p of photos) {
      const r = await run(p);
      const expiryRight = r.expiry === p.expiry;
      const batchRight = p.batch ? clean(r.batch) === clean(p.batch) : null;
      tally.expiry += Number(expiryRight);
      if (p.batch) {
        tally.batchTotal++;
        tally.batch += Number(batchRight);
      }
      const wrong = (r.expiry && !expiryRight) || (p.batch && r.batch && !batchRight);
      if (wrong && !r.uncertain) tally.wrongTrusted++;
      if (!r.expiry) tally.missed++;
      results.push({ mode, id: p.id, upside_down: p.upside_down, want: { batch: p.batch, expiry: p.expiry }, got: r });
      console.log(
        `${mode} ${String(p.id).padStart(2, "0")}${p.upside_down ? " (upside down)" : ""}: expiry ${r.expiry ?? "-"} ${expiryRight ? "ok" : `want ${p.expiry}`}` +
          (p.batch ? ` | batch ${r.batch ?? "-"} ${batchRight ? "ok" : `want ${p.batch}`}` : "") +
          (r.uncertain ? " (flagged)" : "") +
          (r.error ? ` | ${r.error}` : ""),
      );
    }
    console.log(
      `== ${mode}: expiry ${tally.expiry}/${photos.length}, batch ${tally.batch}/${tally.batchTotal}, wrong shown as certain ${tally.wrongTrusted}, expiry missed ${tally.missed}, ${Math.round((Date.now() - started) / photos.length / 1000)}s per photo`,
    );
  }
  writeFileSync(`${TEST}/results-${Object.keys(modes).join("+")}.json`, JSON.stringify(results, null, 1));
}

void main();
