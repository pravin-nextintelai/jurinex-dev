import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/route";

/**
 * Served at /acts/robots.txt. Google only reads robots.txt at the domain
 * root, so the React app's public/robots.txt also lists this sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: appUrl("/sitemap.xml"),
  };
}
