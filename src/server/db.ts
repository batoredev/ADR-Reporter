import "server-only";
import { createPrismaClient, type Db } from "./db-client";

// One client per process (Node.js) or per Edge Function instance (Deno). On
// Supabase, SUPABASE_DB_URL is provided to Edge Functions automatically.
const globalForDb = globalThis as unknown as { adrDb?: Db };

function client(): Db {
  if (!globalForDb.adrDb) {
    const max = Number(process.env.DB_POOL_MAX);
    globalForDb.adrDb = createPrismaClient(
      process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
      Number.isFinite(max) && max > 0 ? { max } : {},
    );
  }
  return globalForDb.adrDb;
}

/** The shared database client, created on first use. */
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
