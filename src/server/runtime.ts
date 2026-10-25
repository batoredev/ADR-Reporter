/** True when running on Cloudflare Workers (workerd) rather than Node.js. */
export function onCloudflare(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}
