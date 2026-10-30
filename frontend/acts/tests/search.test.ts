import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";

const fetchMock = vi.fn();

function get(q: string | null, headers: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/acts/api/search");
  if (q !== null) url.searchParams.set("q", q);
  return new Request(url, { headers });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/search", () => {
  it("returns 400 for a query shorter than 2 characters without calling the backend", async () => {
    const res = await GET(get("a"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "QUERY_TOO_SHORT" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when q is missing or longer than 100 characters", async () => {
    expect((await GET(get(null))).status).toBe(400);
    expect((await GET(get("x".repeat(101)))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a 429 through with its Retry-After header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down", details: null } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "17" },
      }),
    );

    const res = await GET(get("318 bns"));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    await expect(res.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("forwards the client IP and never sends the API key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], meta: { q: "cheating", total: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await GET(get("cheating", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://backend.test/api/search?q=cheating");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(headers["X-API-Key"]).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });

  it("answers 502 when the backend is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await GET(get("cheating"));
    expect(res.status).toBe(502);
  });
});
