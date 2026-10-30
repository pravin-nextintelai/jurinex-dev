import type { NextConfig } from "next";
import path from "node:path";

/**
 * A basic CSP. Next.js needs inline scripts for hydration and inline styles
 * for next/font, so both get 'unsafe-inline'. Content pages ship no third
 * party scripts, so everything else is locked to 'self'.
 */
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  // React dev tools need eval() for source-mapped stack traces; never allowed in production.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // The footer newsletter form posts to the auth service, as in the React app.
  "connect-src 'self' http://localhost:5001 https://authservice-120280829617.asia-south1.run.app",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  basePath: "/acts",
  poweredByHeader: false,
  output: "standalone",
  // Brand images are a few small PNG/JPG files; serve them as-is instead of through
  // the on-demand optimizer (which needs sharp at runtime and broke behind the proxy).
  images: { unoptimized: true },
  turbopack: {
    // Several lockfiles live above this folder; pin the workspace root to this app.
    root: path.resolve(process.cwd()),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    // app/sitemap.ts uses generateSitemaps(), which yields /sitemap/{n}.xml but no index.
    // Serve the index at the conventional URL (basePath is applied automatically).
    return [{ source: "/sitemap.xml", destination: "/api/sitemap-index" }];
  },
};

export default nextConfig;
