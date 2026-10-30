/** Small text helpers shared by the pages. */

/** "Section" for acts made of sections, "Article" for the Constitution and similar. */
export function provisionLabel(provisionType: string | null | undefined): "Section" | "Article" {
  return provisionType === "article" ? "Article" : "Section";
}

const SMALL_WORDS = new Set(["of", "the", "and", "to", "in", "for", "on", "by", "a", "an", "or"]);

/** "THE FIRST SCHEDULE" becomes "The First Schedule". The first word is always capitalised. */
export function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** "ministry-of-home-affairs" becomes "Ministry of Home Affairs". */
export function humanizeSlug(slug: string): string {
  return titleCase(slug.replace(/[-_]+/g, " "));
}

/** First `max` characters, cut at a word boundary with an ellipsis. */
export function excerpt(text: string, max = 500): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/** Format an ISO timestamp as "12 March 2025" in Indian English. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Escape HTML, then let only <mark> and </mark> back through. Search snippets
 * arrive with <mark> highlights from the backend and nothing else may run.
 */
export function sanitizeSnippet(html: string): string {
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped.replace(/&lt;(\/?)mark&gt;/gi, "<$1mark>");
}
