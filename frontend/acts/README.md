# bare-acts-web

Public, SEO-friendly **Bare Acts** site built with Next.js (App Router, TypeScript, Tailwind).
It is served under the main domain at `/acts`: `jurinex.ai/acts/...` is this app, everything
else is the existing React (Vite) app in `frontend/`.

```
                       jurinex.ai
                            │
         /acts/* ───────────┴─────────── everything else
            ▼                                   ▼
   Next.js (bare-acts-web)               React app (frontend/)
            │ X-API-Key (server only)
            ▼
   bare-acts-service  /api/*   (FastAPI, :8096)
```

Every content page is a server component. The backend is only ever called from the server
(`lib/api.ts` starts with `import "server-only"`). The single exception is search, which the
browser reaches through the proxy route `/acts/api/search`.

## Routes

| URL | File | Backend call |
|---|---|---|
| `/acts` | `app/page.tsx` | `GET /api/acts?page&limit=50&category&q` |
| `/acts/{act}` | `app/[actSlug]/page.tsx` | `GET /api/acts/{act}` |
| `/acts/{act}/{section}` | `app/[actSlug]/[sectionSlug]/page.tsx` | `GET /api/acts/{act}/sections/{section}` |
| `/acts/{act}/schedules/{part}` | `app/[actSlug]/schedules/[partSlug]/page.tsx` | `GET /api/acts/{act}/parts/{part}` |
| `/acts/sitemap.xml`, `/acts/sitemap/{n}.xml` | `app/sitemap.ts` | `GET /api/sitemap-entries?page` |
| `/acts/robots.txt` | `app/robots.ts` | none |
| `/acts/api/search?q=` | `app/api/search/route.ts` | `GET /api/search?q=` (no key, proxied) |
| `/acts/api/revalidate` | `app/api/revalidate/route.ts` | called **by** the backend after publish/edit |

Backend URLs already start with `/acts`. `toRoute()` in `lib/route.ts` strips that prefix before
anything is passed to `<Link>`, `permanentRedirect()` or `revalidatePath()`, otherwise basePath
would double it to `/acts/acts/...`. Canonical URLs, the sitemap and JSON-LD use `absoluteUrl()`.

Caching: list page 1 h, act/section/schedule pages 24 h, plus on-demand revalidation through
`/acts/api/revalidate`. Moved slugs (backend 301) become a permanent redirect; unknown slugs
(backend 404) render the 404 page with HTTP 404; 5xx renders `app/error.tsx`.

## Environment variables

Copy `.env.example` to `.env.local`:

| Name | Purpose |
|---|---|
| `BARE_ACTS_API_URL` | Backend base URL, e.g. `http://localhost:8096` |
| `BARE_ACTS_API_KEY` | Sent as `X-API-Key` on every server-side call |
| `REVALIDATE_SECRET` | Shared secret for `/acts/api/revalidate`; equals the backend's `NEXT_REVALIDATE_SECRET` |
| `SITE_URL` | Public origin, no trailing slash, e.g. `https://jurinex.ai` |

No variable with the `NEXT_PUBLIC_` prefix holds a secret, and none is used.

## Running locally

Three processes, three ports:

```bash
# 1. backend (real service) on :8096
#    or the stand-in:  BARE_ACTS_API_KEY=devkey node scripts/mock-backend.mjs

# 2. this app on :3000
cd frontend/acts
cp .env.example .env.local      # set BARE_ACTS_API_URL=http://localhost:8096 and the key
npm install
npm run dev                     # http://localhost:3000/acts

# 3. the React app on its own port (Vite picks 5173 by default)
cd frontend
npm run dev                     # http://localhost:5173/acts is proxied to :3000
```

Checks:

```bash
npm run build && npm run lint && npm test && npm run typecheck
curl -s localhost:3000/acts/bharatiya-nyaya-sanhita-2023/section-318 | grep -o "<h1[^>]*>[^<]*"
curl -sI localhost:3000/acts/does-not-exist | head -1            # HTTP/1.1 404
curl -sI localhost:3000/acts/bns | head -1                       # HTTP/1.1 308 (moved slug)
grep -rl "BARE_ACTS_API_KEY\|X-API-Key" .next/static || echo "key not in client bundle"
```

## Deploying

### Cloud Run (Docker)

```bash
docker build -t bare-acts-web --build-arg SITE_URL=https://jurinex.ai frontend/acts
docker run -p 3000:3000 \
  -e BARE_ACTS_API_URL=https://bare-acts.internal \
  -e BARE_ACTS_API_KEY=... -e REVALIDATE_SECRET=... -e SITE_URL=https://jurinex.ai \
  bare-acts-web
```

The image is multi-stage, uses `output: "standalone"` and runs as a non-root user on port 3000.
On Cloud Run set the four env vars on the service and point the domain proxy at it (below).

### Vercel

Import `frontend/acts` as the project root, framework Next.js, and set the same four env vars.
Then add the proxy rule on the main domain so `/acts/*` reaches the Vercel deployment.

## Proxy rules on the main domain

The React app owns the domain. One rule must send `/acts/*` to this app **before** the SPA fallback.

Netlify (`frontend/netlify.toml`, already added):

```toml
[[redirects]]
  from = "/acts/*"
  to = "https://<next-app-host>/acts/:splat"
  status = 200
  force = true
```

nginx:

```nginx
location /acts/ {
  proxy_pass http://nextjs:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Vite dev server (`frontend/vite.config.js`, already added):

```js
server: { proxy: { "/acts": { target: "http://localhost:3000", changeOrigin: true } } }
```

## Backend settings

In bare-acts-service's `.env`:

```
NEXT_REVALIDATE_URL=https://jurinex.ai/acts/api/revalidate
NEXT_REVALIDATE_SECRET=<same value as REVALIDATE_SECRET here>
SITE_URL=https://jurinex.ai
```

After every publish, withdraw or edit the backend POSTs
`{ "secret": "...", "paths": ["/acts/{act}", "/acts/{act}/{section}", ...] }` and the pages
are rebuilt on the next request.

### Known constraint: search rate limit behind the proxy

The backend rate-limits `/api/search` to 30 requests per minute **per client IP**
(`request.client.host`). Behind this proxy every search arrives from the Next.js server's IP, so
all visitors would share one bucket. The proxy forwards the visitor's address in
`X-Forwarded-For`; make the backend trust it:

```
uvicorn app:app --proxy-headers --forwarded-allow-ips=<next-server-ip>
```

## SEO notes

- `metadataBase` is `SITE_URL`; every page sets `alternates.canonical`. Filtered or searched list
  views (`?q=`, `?category=`) are `noindex, follow`.
- One `<h1>` per page, semantic `<article>`, `<nav aria-label="Breadcrumb">`, `<ol>` footnotes.
- JSON-LD: `CollectionPage` + `ItemList` on the index; `Legislation` + `BreadcrumbList` on act,
  section and schedule pages; `FAQPage` only when a section has FAQs.
- Null AI fields (overview, summary, key points, FAQs, change note) render nothing.
- Content pages ship no client JavaScript except the search box.
- Google reads `robots.txt` at the domain root only, so `frontend/public/robots.txt` lists
  `https://jurinex.ai/acts/sitemap.xml` as well.

## Tests

`npm test` runs Vitest over `tests/`: the API client (key header, 301, 404, 5xx, retry),
`toRoute`, the revalidate route (401 / stripped paths), the search proxy (400 / 429 pass-through)
and the JSON-LD builders.
