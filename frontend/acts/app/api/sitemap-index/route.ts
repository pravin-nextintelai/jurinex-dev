import { getSitemapEntries } from "@/lib/api";
import { appUrl } from "@/lib/route";

export const revalidate = 3600;

/**
 * Sitemap index. next.config.ts rewrites /acts/sitemap.xml to this route, so
 * robots.txt and Search Console use that single URL. It lists the per-page
 * sitemaps that app/sitemap.ts generates (/acts/sitemap/1.xml, /2.xml, ...).
 */
export async function GET(): Promise<Response> {
  let pages = 1;
  let lastmod = new Date().toISOString();
  try {
    const first = await getSitemapEntries(1);
    pages = Math.max(1, first.total_pages);
    const latest = first.entries.map((entry) => entry.lastmod).sort().at(-1);
    if (latest) lastmod = latest;
  } catch (err) {
    console.error("[bare-acts] sitemap index unavailable:", err instanceof Error ? err.message : err);
  }

  const items = Array.from({ length: pages }, (_, index) => {
    const loc = appUrl(`/sitemap/${index + 1}.xml`);
    return `  <sitemap>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
