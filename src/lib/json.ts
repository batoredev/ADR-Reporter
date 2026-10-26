// JSON for the API that keeps Date values: the server tags them and the browser
// turns them back into Date objects, so components can format them as before.

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, encoded) {
    const raw = this[key];
    return raw instanceof Date ? { $date: raw.toISOString() } : encoded;
  });
}

export function decodeJson<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, value) =>
    value && typeof value === "object" && typeof value.$date === "string" && Object.keys(value).length === 1
      ? new Date(value.$date)
      : value,
  ) as T;
}
