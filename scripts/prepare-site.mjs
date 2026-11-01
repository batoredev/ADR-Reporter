import { mkdirSync, copyFileSync, cpSync, readFileSync } from "node:fs";

mkdirSync("public/forms", { recursive: true });
copyFileSync("docs/reference/ADRRF_2.pdf", "public/forms/pvpi-adrrf-v1.4.pdf");
mkdirSync("public/pdfjs", { recursive: true });
const pdfVersion = JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8")).version;
// Legacy build for wide browser support; it must match the build imported in src/lib/api/prepare-pdf.ts.
copyFileSync(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  `public/pdfjs/pdf.worker-legacy-${pdfVersion}.js`,
);
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
