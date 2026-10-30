import "server-only";
import { notFound, permanentRedirect } from "next/navigation";
import { toRoute } from "@/lib/route";
import type {
  ActDetail,
  ActsPage,
  ActSummary,
  ApiErrorBody,
  Envelope,
  ListMeta,
  PartDetail,
  SectionDetail,
  SitemapPage,
  StaticParam,
} from "@/lib/types";

/** Thrown for every non-2xx answer that is not a 301 or a 404. error.tsx renders it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

export const REVALIDATE = {
  list: 3600,
  act: 86_400,
  section: 86_400,
  part: 86_400,
  sitemap: 3600,
} as const;

function baseUrl(): string {
  const raw = process.env.BARE_ACTS_API_URL?.trim();
  if (!raw) {
    throw new Error(
      "BARE_ACTS_API_URL is not set. Copy frontend/acts/.env.example to .env.local and point it at bare-acts-service " +
        "(or run the stand-in: BARE_ACTS_API_KEY=devkey node scripts/mock-backend.mjs), then restart `npm run dev`.",
    );
  }
  return raw.replace(/\/+$/, "");
}

function apiKey(): string {
  return process.env.BARE_ACTS_API_KEY ?? "";
}

function isNetworkError(err: unknown): boolean {
  // undici reports connection failures as TypeError("fetch failed"); timeouts as AbortError/TimeoutError.
  if (err instanceof TypeError) return true;
  if (err instanceof Error) return err.name === "AbortError" || err.name === "TimeoutError";
  return false;
}

async function rawFetch(url: string, revalidate: number): Promise<Response> {
  return fetch(url, {
    headers: { "X-API-Key": apiKey(), Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate },
  });
}

/**
 * One typed fetch for every public endpoint.
 *  - sends the API key (server only; the key never reaches the browser)
 *  - retries once on a network error
 *  - 301 -> permanentRedirect(toRoute(new_path))
 *  - 404 -> notFound()
 *  - any other error -> throws ApiError, so error.tsx renders
 * Errors are logged with the path only; the key is never logged.
 */
export async function apiFetch<T>(path: string, revalidate: number): Promise<T> {
  const url = `${baseUrl()}${path}`;

  let res: Response;
  try {
    res = await rawFetch(url, revalidate);
  } catch (first) {
    if (!isNetworkError(first)) throw first;
    try {
      res = await rawFetch(url, revalidate);
    } catch (second) {
      console.error(`[bare-acts] network error for ${path}:`, second instanceof Error ? second.message : second);
      throw new ApiError(0, "NETWORK_ERROR", `Could not reach bare-acts-service for ${path}`);
    }
  }

  if (res.status === 301) {
    const body = (await res.json().catch(() => null)) as { data?: { new_path?: string } } | null;
    const newPath = body?.data?.new_path;
    if (newPath) permanentRedirect(toRoute(newPath));
    throw new ApiError(301, "MOVED_WITHOUT_PATH", `301 for ${path} had no new_path`);
  }

  if (res.status === 404) {
    notFound();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const code = body?.error?.code ?? "UPSTREAM_ERROR";
    const message = body?.error?.message ?? res.statusText;
    console.error(`[bare-acts] ${res.status} ${code} for ${path}: ${message}`);
    throw new ApiError(res.status, code, message);
  }

  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* P1 to P6                                                            */
/* ------------------------------------------------------------------ */

export interface ListActsParams {
  page?: number;
  limit?: number;
  category?: string;
  q?: string;
}

export async function getActs({ page = 1, limit = 50, category, q }: ListActsParams = {}): Promise<ActsPage> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (category) qs.set("category", category);
  if (q) qs.set("q", q);
  const res = await apiFetch<Envelope<ActSummary[], ListMeta>>(`/api/acts?${qs}`, REVALIDATE.list);
  return {
    acts: res.data,
    meta: res.meta ?? { page, limit, total: res.data.length },
  };
}

export async function getAct(actSlug: string): Promise<ActDetail> {
  const res = await apiFetch<Envelope<ActDetail>>(`/api/acts/${encodeURIComponent(actSlug)}`, REVALIDATE.act);
  return res.data;
}

export async function getSection(actSlug: string, sectionSlug: string): Promise<SectionDetail> {
  const res = await apiFetch<Envelope<SectionDetail>>(
    `/api/acts/${encodeURIComponent(actSlug)}/sections/${encodeURIComponent(sectionSlug)}`,
    REVALIDATE.section,
  );
  return res.data;
}

export async function getPart(actSlug: string, partSlug: string): Promise<PartDetail> {
  const res = await apiFetch<Envelope<PartDetail>>(
    `/api/acts/${encodeURIComponent(actSlug)}/parts/${encodeURIComponent(partSlug)}`,
    REVALIDATE.part,
  );
  return res.data;
}

export async function getSitemapEntries(page = 1): Promise<SitemapPage> {
  const res = await apiFetch<Envelope<SitemapPage>>(`/api/sitemap-entries?page=${page}`, REVALIDATE.sitemap);
  return res.data;
}

export async function getStaticParams(limit = 500, perAct = 50): Promise<StaticParam[]> {
  const res = await apiFetch<Envelope<StaticParam[]>>(
    `/api/static-params?limit=${limit}&per_act=${perAct}`,
    REVALIDATE.sitemap,
  );
  return res.data;
}

/**
 * generateStaticParams runs at build time, often with no backend reachable
 * (CI, Docker build). Return [] then and let dynamicParams build pages on
 * first visit instead of failing the build.
 */
export async function getStaticParamsSafe(): Promise<StaticParam[]> {
  if (!process.env.BARE_ACTS_API_URL) return [];
  try {
    return await getStaticParams();
  } catch (err) {
    console.warn("[bare-acts] static-params unavailable at build time:", err instanceof Error ? err.message : err);
    return [];
  }
}
