import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

import { POST } from "@/app/api/revalidate/route";

function post(body: unknown): Request {
  return new Request("http://localhost:3000/acts/api/revalidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  cache.revalidatePath.mockClear();
});

describe("POST /api/revalidate", () => {
  it("rejects a bad secret with 401 and revalidates nothing", async () => {
    const res = await POST(post({ secret: "wrong", paths: ["/acts/bns"] }));

    expect(res.status).toBe(401);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing secret with 401", async () => {
    const res = await POST(post({ paths: ["/acts/bns"] }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects paths that do not start with /acts", async () => {
    const res = await POST(post({ secret: "test-secret", paths: ["/acts/bns", "/evil"] }));

    expect(res.status).toBe(400);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates the stripped paths plus the index and sitemap with a good secret", async () => {
    const res = await POST(
      post({
        secret: "test-secret",
        paths: ["/acts/bns-2023", "/acts/bns-2023/section-318", "/acts/bns-2023/schedules/first-schedule"],
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revalidated: 3 });

    const calls = cache.revalidatePath.mock.calls.map((call) => call[0]);
    expect(calls).toEqual(
      expect.arrayContaining(["/bns-2023", "/bns-2023/section-318", "/bns-2023/schedules/first-schedule", "/", "/sitemap.xml"]),
    );
    expect(calls).not.toContain("/acts/bns-2023");
  });
});
