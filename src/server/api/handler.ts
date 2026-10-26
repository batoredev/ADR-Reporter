import "server-only";
import { userForToken } from "@/server/auth/current-user";
import { WorkflowError } from "@/server/workflow/errors";
import { CORS_HEADERS, json, statusFor, type Route } from "./http";
import { routes } from "./routes";

/** The path after ".../api", e.g. "/functions/v1/api/cases/1" or "/api/cases/1" -> "/cases/1". */
function apiPath(pathname: string): string {
  const match = pathname.match(/\/api(\/.*)?$/);
  return (match ? (match[1] ?? "/") : pathname).replace(/\/+$/, "") || "/";
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((segment, i) => {
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return segment === parts[i];
    });
    if (matches) return { route, params };
  }
  return null;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token || null;
}

/** Handles one API request (Supabase Edge Function in production, Node.js locally). */
export async function handleApiRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const url = new URL(request.url);
  const match = matchRoute(request.method, apiPath(url.pathname));
  if (!match) return json({ error: "Not found." }, 404);
  try {
    const base = { request, query: url.searchParams, params: match.params };
    let result: unknown;
    if (match.route.auth) {
      const token = bearerToken(request);
      const user = await userForToken(token);
      if (!user || !token) throw new WorkflowError("Your session has ended. Sign in again.", "UNAUTHORIZED");
      result = await match.route.handler({ ...base, user, token });
    } else {
      result = await match.route.handler(base);
    }
    return result instanceof Response ? result : json(result ?? null);
  } catch (error) {
    if (error instanceof WorkflowError) return json({ error: error.message, code: error.code }, statusFor(error));
    console.error(error);
    return json({ error: "Something went wrong on the server. Please try again." }, 500);
  }
}
