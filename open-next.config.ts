import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is rendered per request with the signed-in user's data, so no
// incremental cache (and no R2 bucket) is needed.
export default defineCloudflareConfig({});
