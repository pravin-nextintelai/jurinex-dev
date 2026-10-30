const MIN_CHARS = 2;
const MAX_CHARS = 100;
const TIMEOUT_MS = 10_000;

export const dynamic = "force-dynamic";

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, details: null } }, { status });
}

/** Best-effort client IP so the backend can rate-limit per user, not per Next server. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "";
  return request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? "";
}

/**
 * GET /acts/api/search?q=...
 * Proxies the backend's public search (no API key). The status, JSON body and
 * Retry-After header are passed through unchanged so a 429 reaches the browser.
 */
export async function GET(request: Request): Promise<Response> {
  const base = process.env.BARE_ACTS_API_URL?.trim().replace(/\/+$/, "");
  if (!base) return jsonError(500, "NOT_CONFIGURED", "BARE_ACTS_API_URL is not set");

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_CHARS || q.length > MAX_CHARS) {
    return jsonError(400, "QUERY_TOO_SHORT", `q must be between ${MIN_CHARS} and ${MAX_CHARS} characters`);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const ip = clientIp(request);
  if (ip) {
    headers["X-Forwarded-For"] = ip;
    headers["X-Real-IP"] = ip;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[bare-acts] search upstream failed:", err instanceof Error ? err.message : err);
    return jsonError(502, "UPSTREAM_UNAVAILABLE", "Search is unavailable right now");
  }

  const body = await upstream.text();
  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) responseHeaders.set("Retry-After", retryAfter);

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
