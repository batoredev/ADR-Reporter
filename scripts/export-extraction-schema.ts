import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { chatExtractionSchema } from "../src/lib/domain/chat-extraction";
async function main() {
  await mkdir("ml/schema", { recursive: true });
  await writeFile(
    "ml/schema/extraction.schema.json",
    JSON.stringify(z.toJSONSchema(chatExtractionSchema), null, 2) + "\n",
  );
  console.log("Exported the shared extraction schema.");
}
void main();
