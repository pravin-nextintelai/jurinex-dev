import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/lib/api";
import { absoluteUrl, appUrl } from "@/lib/route";

export const revalidate = 3600;

/**
 * The backend serves 10,000 entries per page. One sitemap file is produced per
 * backend page at /acts/sitemap/{id}.xml. The index that lists them is served
 * at /acts/sitemap.xml by app/api/sitemap-index/route.ts (via a rewrite), which
 * is the URL robots.txt points at.
 */
export async function generateSitemaps(): Promise<{ id: number }[]> {
  try {
    const first = await getSitemapEntries(1);
    const pages = Math.max(1, first.total_pages);
    return Array.from({ length: pages }, (_, index) => ({ id: index + 1 }));
  } catch (err) {
    console.warn("[bare-acts] sitemap index unavailable:", err instanceof Error ? err.message : err);
    return [{ id: 1 }];
  }
}

/** Act pages have two path segments (/acts/{act}); sections and schedules have more. */
function priorityFor(url: string): number {
  const segments = url.split("/").filter(Boolean);
  return segments.length <= 2 ? 0.8 : 0.6;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const page = Number(id) || 1;
  const index: MetadataRoute.Sitemap =
    page === 1 ? [{ url: appUrl("/"), changeFrequency: "daily", priority: 1.0 }] : [];

  try {
    const data = await getSitemapEntries(page);
    const entries: MetadataRoute.Sitemap = data.entries.map((entry) => ({
      url: absoluteUrl(entry.url),
      lastModified: entry.lastmod,
      changeFrequency: "monthly",
      priority: priorityFor(entry.url),
    }));
    return [...index, ...entries];
  } catch (err) {
    console.error("[bare-acts] sitemap page unavailable:", page, err instanceof Error ? err.message : err);
    return index;
  }
}
