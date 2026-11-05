import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Cache Components is intentionally OFF: every page in this multi-tenant app is rendered
// per request, so one clinic's data can never be served from a cache to another clinic.
const nextConfig: NextConfig = {
  // The floating dev-mode badge would cover the phone's bottom menu during local testing.
  devIndicators: false,
  // PDF generation runs in Node with these libraries as-is (not bundled).
  serverExternalPackages: ["@react-pdf/renderer", "fontkit", "sharp"],
  // The PDF route reads the Arabic font files from disk: make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/consents/**": ["src/lib/pdf/fonts/**/*"],
  },
  // Security headers for every page. Camera/microphone stay allowed (AI scribe dictation,
  // the video call frame); everything else a clinic app never needs is switched off.
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), interest-cohort=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ];
    // Signed patient links (/visit, /sign): never cached, never leaked in a Referer, never indexed.
    const tokenPages = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/:path*", headers: common },
      { source: "/visit/:token", headers: tokenPages },
      { source: "/sign/:token", headers: tokenPages },
    ];
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
