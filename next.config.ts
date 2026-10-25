import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stays off: every page shows per-user clinical data that
  // must be read fresh on each request, so request-time rendering is used.
  experimental: {
    // Prescription uploads may be up to 10 MB; allow for form overhead.
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
