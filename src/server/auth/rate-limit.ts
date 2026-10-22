import "server-only";

// Simple in-memory limiter for failed logins. Adequate for a single local
// process; a shared store would be needed for multiple server instances.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; firstAt: number }>();

export function isLoginBlocked(key: string, now = Date.now()): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (now - entry.firstAt > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const entry = failures.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}
