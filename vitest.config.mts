import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      },
    },
    test: {
      include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
      environment: "node",
      // Integration tests read the seeded test database, never the development one.
      env: env.TEST_DATABASE_URL
        ? { DATABASE_URL: env.TEST_DATABASE_URL, TEST_DATABASE_URL: env.TEST_DATABASE_URL }
        : {},
    },
  };
});
