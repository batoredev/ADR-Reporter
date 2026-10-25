import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createPrismaClient, type Db } from "./db-client";
import { onCloudflare } from "./runtime";

// Node.js: one client, reused across requests (and across hot reloads in development).
const globalForDb = globalThis as unknown as { adrDb?: Db };

// Cloudflare Workers forbid sharing a connection between requests, so each
// request gets its own client, and each connection is used once. With a
// Hyperdrive binding, connections go through Cloudflare's pool.
const perRequest = new WeakMap<object, Db>();

function currentClient(): Db {
  if (!onCloudflare()) return (globalForDb.adrDb ??= createPrismaClient());
  const { env, ctx } = getCloudflareContext();
  let client = perRequest.get(ctx);
  if (!client) {
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    client = createPrismaClient(hyperdrive?.connectionString ?? process.env.DATABASE_URL, { maxUses: 1 });
    perRequest.set(ctx, client);
  }
  return client;
}

/** The database client for the current request. */
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const client = currentClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
