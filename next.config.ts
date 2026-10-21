import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Cache Components is intentionally OFF: every page in this multi-tenant app is rendered
// per request, so one clinic's data can never be served from a cache to another clinic.
const nextConfig: NextConfig = {
  // PDF generation runs in Node with these libraries as-is (not bundled).
  serverExternalPackages: ["@react-pdf/renderer", "fontkit", "sharp"],
  // The PDF route reads the Arabic font files from disk: make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/consents/**": ["src/lib/pdf/fonts/**/*"],
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

export default withNextIntl(nextConfig);
