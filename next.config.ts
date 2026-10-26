import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The site is plain static files (Cloudflare Pages). Every page loads its data
  // in the browser from the API, the Supabase Edge Function "api".
  output: "export",
  images: { unoptimized: true },
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
