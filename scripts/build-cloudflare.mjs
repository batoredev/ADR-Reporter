// Builds the Cloudflare Workers bundle in .open-next/ (npm run cf:build).
//   1. Generates the Prisma client for workerd, which loads its WebAssembly as a
//      module: Workers cannot compile WebAssembly at runtime. The import is kept
//      out of Turbopack (whose wasm loader would trace the whole project into the
//      bundle) and left for wrangler, which bundles the .wasm file itself.
//   2. Copies the blank PvPI form into public/ so the Worker reads it as a static asset.
//   3. Builds Next.js and adapts it with OpenNext.
// The Node.js Prisma client is regenerated afterwards for local development and tests.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

const SCHEMA = "prisma/schema.prisma";
const WORKERD_SCHEMA = "prisma/.schema.workerd.prisma";

const schema = readFileSync(SCHEMA, "utf8");
const workerdSchema = schema.replace(
  /(generator client \{[^}]*?output\s*=\s*"[^"]+")/,
  '$1\n  runtime  = "workerd"\n  compilerBuild = "small"',
);
if (workerdSchema === schema) throw new Error("Could not find the Prisma client generator in prisma/schema.prisma");

mkdirSync("public/forms", { recursive: true });
copyFileSync("docs/reference/ADRRF_2.pdf", "public/forms/pvpi-adrrf-v1.4.pdf");

// The .wasm is copied to a cache folder that outlives this script, because wrangler
// reads it when deploying (or previewing), after the Node client is restored.
function keepWasmImportOutOfTurbopack(file) {
  const source = readFileSync(file, "utf8");
  const pattern = /import\("\.\/(query_compiler_\w+\.wasm)\?module"\)/;
  const match = source.match(pattern);
  if (!match) throw new Error(`No WebAssembly module import found in ${file}`);
  const cacheDir = path.resolve("node_modules/.cache/adr-reporter");
  mkdirSync(cacheDir, { recursive: true });
  const wasm = path.join(cacheDir, match[1]);
  copyFileSync(path.join(path.dirname(file), match[1]), wasm);
  const specifier = `${wasm.split(path.sep).join("/")}?module`;
  writeFileSync(file, source.replace(pattern, `import(/* turbopackIgnore: true */ "${specifier}")`));
}

let failed = false;
try {
  writeFileSync(WORKERD_SCHEMA, workerdSchema);
  run("npx", ["prisma", "generate", "--schema", WORKERD_SCHEMA]);
  keepWasmImportOutOfTurbopack("src/generated/prisma/internal/class.ts");
  run("npx", ["opennextjs-cloudflare", "build"]);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  rmSync(WORKERD_SCHEMA, { force: true });
  if (!process.env.CI && !process.env.WORKERS_CI) run("npx", ["prisma", "generate"]);
}
process.exit(failed ? 1 : 0);
