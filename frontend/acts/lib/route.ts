/**
 * URL helpers.
 *
 * The backend returns URLs that already start with `/acts/...`. Because this
 * app is mounted with `basePath: "/acts"`, Next.js prefixes `/acts` itself on
 * every <Link>, redirect() and revalidatePath(). Passing the backend URL
 * through unchanged would produce `/acts/acts/...`, so every internal
 * navigation goes through toRoute() first. Canonical URLs, the sitemap and
 * JSON-LD need the full public URL instead, which absoluteUrl() builds.
 */

export const BASE_PATH = "/acts";

/** Strip the leading `/acts` so the result can be given to <Link>, redirect() or revalidatePath(). */
export function toRoute(url: string): string {
  if (!url) return "/";

  let path = url;
  // Tolerate absolute URLs on our own host.
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return "/";
    }
  }

  if (path === BASE_PATH) return "/";
  if (path.startsWith(`${BASE_PATH}/`)) {
    path = path.slice(BASE_PATH.length);
  } else if (path.startsWith(`${BASE_PATH}?`) || path.startsWith(`${BASE_PATH}#`)) {
    path = path.slice(BASE_PATH.length);
  }

  if (path === "") return "/";
  if (path.startsWith("?") || path.startsWith("#")) return `/${path}`;
  return path.startsWith("/") ? path : `/${path}`;
}

/** Public origin without a trailing slash, e.g. https://jurinex.ai. */
export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Full public URL for a backend path such as `/acts/bns/section-318`. */
export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${siteUrl()}${path}`;
}

/** Public URL of a route inside this app (a path without the `/acts` prefix). */
export function appUrl(route: string): string {
  if (route === "/" || route === "") return `${siteUrl()}${BASE_PATH}`;
  const path = route.startsWith("/") ? route : `/${route}`;
  return `${siteUrl()}${BASE_PATH}${path}`;
}
