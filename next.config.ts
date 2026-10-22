import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stays off: every page shows per-user clinical data that
  // must be read fresh on each request, so request-time rendering is used.
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
