import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * A full nonce-based Content-Security-Policy is intentionally NOT set here:
 * it has to be generated per request in middleware to carry a fresh nonce,
 * and Clerk's hosted components need their origins allow-listed. Phase 1
 * ships the headers that are correct as static values; the CSP is tracked in
 * docs/SECURITY.md as an explicit follow-up rather than being half-applied.
 */
const securityHeaders = [
  // Stop MIME sniffing turning an uploaded file into executable script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: nothing in Life OS is meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop ambient access to hardware the app never uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Only meaningful over HTTPS; browsers ignore it on plain http://localhost.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Never leak the framework version in a response header.
  poweredByHeader: false,

  typedRoutes: true,

  // Next.js otherwise writes AGENTS.md / CLAUDE.md into the repo root on
  // every build. The project's documentation lives in docs/, so these are
  // just generated clutter.
  agentRules: false,

  images: {
    // Clerk-hosted avatars are the only remote images Phase 1 renders.
    remotePatterns: [{ protocol: "https", hostname: "img.clerk.com" }],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
