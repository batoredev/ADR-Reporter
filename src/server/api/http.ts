import "server-only";
import { encodeJson } from "@/lib/json";
import type { CurrentUser } from "@/server/auth/current-user";
import { WorkflowError } from "@/server/workflow/errors";

export interface ApiContext {
  request: Request;
  query: URLSearchParams;
  params: Record<string, string>;
  user: CurrentUser;
  token: string;
}

export interface PublicContext {
  request: Request;
  query: URLSearchParams;
  params: Record<string, string>;
}

export type Route =
  | { method: string; path: string; auth: true; handler: (ctx: ApiContext) => Promise<unknown> }
  | { method: string; path: string; auth: false; handler: (ctx: PublicContext) => Promise<unknown> };

const STATUS: Record<WorkflowError["code"], number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID: 400,
};

export const statusFor = (error: WorkflowError) => STATUS[error.code];

// Sign-in uses bearer tokens, not cookies, so any origin may call the API: a
// request without a valid token can do nothing.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Expose-Headers": "content-disposition",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): Response {
  return new Response(encodeJson(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

export function file(bytes: Uint8Array, contentType: string, filename: string, extra: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new WorkflowError("The request body must be JSON.");
  }
}

export const text = (body: Record<string, unknown>, key: string) =>
  typeof body[key] === "string" ? (body[key] as string) : "";
