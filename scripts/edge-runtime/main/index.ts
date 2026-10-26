// Main service for running the "api" Edge Function in Supabase's own Edge Runtime
// (Docker), the way Supabase does: as a restricted user worker. See README, "Tests".
declare const EdgeRuntime: {
  userWorkers: {
    create(options: Record<string, unknown>): Promise<{ fetch(request: Request): Promise<Response> }>;
  };
};
declare const Deno: { env: { toObject(): Record<string, string> }; serve(h: (r: Request) => Promise<Response>): void };

Deno.serve(async (request) => {
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: "/home/deno/functions/api",
    memoryLimitMb: 256,
    workerTimeoutMs: 60_000,
    noModuleCache: false,
    importMapPath: null,
    envVars: Object.entries(Deno.env.toObject()),
  });
  return worker.fetch(request);
});
