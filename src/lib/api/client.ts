// Talks to the API (the Supabase Edge Function "api"). Sign-in gives a bearer
// token, kept in this browser's localStorage and sent with every request.
import { decodeJson } from "@/lib/json";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/+$/, "");

// Supabase runs an Edge Function in the region nearest the visitor. The API
// queries the database several times per page, so it is kept next to the
// database instead (the database's region, e.g. ap-south-1).
const API_REGION = process.env.NEXT_PUBLIC_API_REGION;

function apiUrl(path: string): string {
  const url = `${API_URL}${path}`;
  if (!API_REGION) return url;
  return `${url}${url.includes("?") ? "&" : "?"}forceFunctionRegion=${encodeURIComponent(API_REGION)}`;
}

const TOKEN_KEY = "adr_session";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers });
  } catch {
    throw new ApiError("The server could not be reached. Check your connection and try again.", 0);
  }
  if (response.status === 401 && token) {
    clearToken();
    // A full page load clears every component's state after the session ended.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
  }
  if (!response.ok) {
    let message = `The request failed (${response.status}).`;
    let code: string | undefined;
    try {
      const body = decodeJson<{ error?: string; code?: string }>(await response.text());
      message = body.error ?? message;
      code = body.code;
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new ApiError(message, response.status, code);
  }
  return response;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await request(path, { method: "GET" });
  return decodeJson<T>(await response.text());
}

export async function apiSend<T>(method: "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await request(path, {
    method,
    headers: isForm || body === undefined ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  return decodeJson<T>(await response.text());
}

export async function apiBlob(path: string): Promise<Blob> {
  const response = await request(path, { method: "GET" });
  return response.blob();
}

/** Opens a signed-in-only file (PDF, uploaded document) in a new tab. */
export async function openFile(path: string) {
  // Opened before the download so pop-up blockers allow it.
  const tab = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await apiBlob(path));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (error) {
    tab?.close();
    window.alert(error instanceof ApiError ? error.message : "The file could not be opened.");
  }
}
