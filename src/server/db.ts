import "server-only";
import { createPrismaClient, type Db } from "./db-client";

// Reuse one client across hot reloads in development.
const globalForDb = globalThis as unknown as { adrDb?: Db };

export const db: Db = globalForDb.adrDb ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.adrDb = db;
}
