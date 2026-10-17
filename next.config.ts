import type { NextConfig } from "next";

// Cache Components is intentionally OFF: every page in this multi-tenant app is rendered
// per request, so one clinic's data can never be served from a cache to another clinic.
const nextConfig: NextConfig = {
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
