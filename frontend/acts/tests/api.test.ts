import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => navigation);

import { ApiError, apiFetch, getAct, getActs, getSection } from "@/lib/api";

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  fetchMock.mockReset();
  navigation.notFound.mockClear();
  navigation.permanentRedirect.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("sends the X-API-Key header and the backend base URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    await apiFetch("/api/acts", 60);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe("http://backend.test/api/acts");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
    expect(init.redirect).toBe("manual");
    expect(init.next?.revalidate).toBe(60);
  });

  it("turns a 301 with new_path into permanentRedirect(toRoute(new_path))", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(301, { data: { new_path: "/acts/bns-2023/section-318" } }));

    await expect(getSection("bns", "section-318")).rejects.toThrow("NEXT_REDIRECT:/bns-2023/section-318");
    expect(navigation.permanentRedirect).toHaveBeenCalledWith("/bns-2023/section-318");
  });

  it("turns a 404 into notFound()", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: "ACT_NOT_FOUND", message: "no such act", details: null } }),
    );

    await expect(getAct("missing")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError on a 5xx so error.tsx renders", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: { code: "DB_DOWN", message: "database unavailable", details: null } }),
    );

    const promise = getActs();
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((err: ApiError) => {
      expect(err.status).toBe(503);
      expect(err.code).toBe("DB_DOWN");
    });
    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  it("retries once on a network error and then succeeds", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [], meta: { page: 1, limit: 50, total: 0 } }));

    const result = await getActs();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.acts).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("gives up after the second network error without leaking the key", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getActs()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("test-key");
  });

  it("builds the list query string from the filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [], meta: { page: 2, limit: 50, total: 60 } }));

    await getActs({ page: 2, category: "ministry-of-home-affairs", q: "nyaya" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://backend.test/api/acts?page=2&limit=50&category=ministry-of-home-affairs&q=nyaya");
  });
});
