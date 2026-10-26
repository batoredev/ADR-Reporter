// Prisma client factory. Kept free of "server-only" so the seed script and
// tests can create their own clients; application code imports `db` from ./db.
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * node-postgres currently treats sslmode=require as verify-full. This applies
 * PostgreSQL's own meaning (encrypted; the certificate is checked only with
 * verify-ca/verify-full), as Prisma Migrate does, so one connection string works
 * for both. Hosts such as Supabase sign their certificates with their own CA.
 */
export function withLibpqSslModes(connectionString: string): string {
  if (!/[?&]sslmode=/.test(connectionString) || /[?&]uselibpqcompat=/.test(connectionString)) return connectionString;
  return `${connectionString}&uselibpqcompat=true`;
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL, pool: PoolConfig = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ ...pool, connectionString: withLibpqSslModes(connectionString) }),
  });
}

export type Db = ReturnType<typeof createPrismaClient>;
