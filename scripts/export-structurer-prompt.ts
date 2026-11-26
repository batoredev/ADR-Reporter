// Writes the two-step reader's structuring instructions and reply format for the training scripts in
// ml/structurer, so a fine-tuned model is trained on exactly what the app sends it.
//   npx tsx --conditions=react-server scripts/export-structurer-prompt.ts
import { writeFileSync } from "node:fs";
import { replyJsonSchema } from "../src/server/ai/json-schema";
import { compactSchema, STRUCTURE_INSTRUCTIONS } from "../src/server/ai/two-step";

writeFileSync(
  "ml/structurer/prompt.json",
  `${JSON.stringify({ system: STRUCTURE_INSTRUCTIONS, userPrefix: "Transcribed text:\n", schema: replyJsonSchema(compactSchema) }, null, 2)}\n`,
);
console.log("Wrote ml/structurer/prompt.json");
