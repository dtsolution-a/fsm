import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";

// Content-Security-Policy for the shipped app. Next.js needs inline scripts/styles for its own bootstrapping.
// Map tiles come from OpenStreetMap; everything else is same-origin (the API sits behind the same proxy).
// Left off in development, where hot reload needs eval.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-contained server bundle (small Docker image, no node_modules copy)
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // the browser may use location on our own pages (the QR / request pages); camera and microphone are never used
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(prod ? [{ key: "Content-Security-Policy", value: csp }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
