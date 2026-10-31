import { mkdirSync, copyFileSync, cpSync, readFileSync } from "node:fs";

mkdirSync("public/forms", { recursive: true });
copyFileSync("docs/reference/ADRRF_2.pdf", "public/forms/pvpi-adrrf-v1.4.pdf");
mkdirSync("public/pdfjs", { recursive: true });
const pdfVersion = JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8")).version;
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `public/pdfjs/pdf.worker-${pdfVersion}.js`);
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
