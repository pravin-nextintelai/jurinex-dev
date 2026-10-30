import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { BASE_PATH, toRoute } from "@/lib/route";

export const dynamic = "force-dynamic";

const MAX_PATHS = 500;

/** Constant-time comparison. Hashing first makes the lengths equal, so no length leaks either. */
function secretMatches(provided: unknown): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || typeof provided !== "string" || provided.length === 0) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isActsPath(value: unknown): value is string {
  return typeof value === "string" && (value === BASE_PATH || value.startsWith(`${BASE_PATH}/`)) && !value.includes("..");
}

/**
 * POST /acts/api/revalidate
 * Body: { "secret": "...", "paths": ["/acts/{act}", "/acts/{act}/{section}", ...] }
 * Called by bare-acts-service after every publish, withdraw or edit.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { secret?: unknown; paths?: unknown };
  try {
    body = (await request.json()) as { secret?: unknown; paths?: unknown };
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Body must be JSON" } }, { status: 400 });
  }

  if (!secretMatches(body.secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid secret" } }, { status: 401 });
  }

  const paths = body.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS || !paths.every(isActsPath)) {
    return Response.json(
      { error: { code: "INVALID_PATHS", message: `paths must be 1-${MAX_PATHS} strings starting with ${BASE_PATH}` } },
      { status: 400 },
    );
  }

  const routes = [...new Set(paths.map((p) => toRoute(p)))];
  for (const route of routes) revalidatePath(route);
  // The list page and the sitemap change whenever any act changes.
  revalidatePath("/");
  revalidatePath("/sitemap.xml");

  return Response.json({ revalidated: routes.length });
}
