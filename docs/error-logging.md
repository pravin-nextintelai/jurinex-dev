# Central error logging

Every JuriNex backend service writes the errors its users actually hit into one
PostgreSQL table, `error_logs`, in **Document_DB**. Each row holds both the exact
message the user saw and the exact internal error with its stack trace, plus the
failed Gemini or external call behind it when there was one. Admins review and
resolve rows there.

The capture is central: no route, controller or service function was changed.
Each service carries its own independent copy of a small module named `errorlog`
(Python package `Backend/<service>/errorlog/`, Node module
`Backend/<service>/errorlog/`) and makes one `install(...)` call next to its app
object. There is no shared folder; every service is a separate module.

## What gets stored

The default is **genuine errors only** (`ERROR_LOG_CAPTURE_ALL=false`). Set
`ERROR_LOG_CAPTURE_ALL=true` to also keep 4xx and recovered internals.

| Situation | Stored as |
|---|---|
| Response status 5xx (unhandled exception, `HTTPException(500)`, or a route that catches its error and answers 500 itself) | one row, ERROR |
| Any 4xx response (401 token expired, 404, 422 validation, 400 bad signature…) | one WARNING row (`HttpErrorResponse4xx` / `HTTPException4xx`) with the exact `user_message`; the errors recorded during that request ride along |
| A failed Gemini / citation / other external call inside a request that ended 5xx | merged into that one row (external fields + final status and user message) |
| A failure the request recovered from (final status 2xx/3xx): a Gemini quota error a fallback hid, a logged exception, a safety block | kept, severity WARNING, `payload.recovered = true` |
| The same failure retried in one request (same fingerprint) | one row, `payload.attempts = N` |
| Failure after the response started (an SSE stream that dies, a FastAPI `BackgroundTask` that raises) | one row, `payload.after_response_start = true`, `status_code` is the status already sent |
| Background jobs, threads, cron, asyncio tasks, process-level crashes (no request) | `source = JOB` or `PROCESS` |
| Error log lines (`logger.error(..., exc_info=True)`, `logger.exception`, `console.error(err)`) | `source = LOGGER`, attached to the request they happen in |
| Browser-side errors (uncaught exceptions, unhandled rejections, failed requests, render crashes, cancelled or failed Razorpay checkouts) | reported by the frontend, see "Browser errors" below |

Statuses listed in `ERROR_LOG_SKIP_STATUS` are the only ones left out, and that
list is empty by default. `ERROR_LOG_CAPTURE_ALL=false` switches to the stricter
"only what the user got" rule: 5xx and non-skipped 4xx only, recovered errors
dropped, default skip list `400,401,403,404,409,422`.

Nothing stored is ever sent to a client. Error responses keep the service's
existing shape, with a safe message and `request_id`.

## The table

`Backend/agentic-document-service/db/migrations/183_error_logs.sql` is the
canonical DDL. agentic-document-service owns the table. The direct-DB writer in
every service also runs `CREATE TABLE IF NOT EXISTS` on first connect, so the
table exists on first use.

| Column | Meaning |
|---|---|
| `id`, `created_at` | row id, time of the error (UTC) |
| `service_name`, `environment` | from `install(service_name=...)` / `SERVICE_NAME`, and `ENVIRONMENT` |
| `source` | `HTTP` request failure, `EXTERNAL_API` failed outgoing call, `JOB` background work, `LOGGER` an error log line, `PROCESS` process-level |
| `category` | `INTERNAL`, `DATABASE`, `TIMEOUT`, `AI_PROVIDER`, `AI_SAFETY_BLOCK`, `AI_EMPTY_RESPONSE`, `AI_INVALID_OUTPUT`, `CITATION_PROVIDER`, `EXTERNAL_API` |
| `severity` | `CRITICAL` for DB connection failures, out-of-memory, Gemini auth/quota (401/403/429, RESOURCE_EXHAUSTED); `WARNING` for safety blocks and MAX_TOKENS; `ERROR` otherwise |
| `request_id` | the `x-request-id` the client received (incoming header kept, else generated; services that already issue one keep theirs) |
| `user_id`, `user_email`, `ip_address` | from `req.user` / the JWT payload / `x-user-id`; `x-forwarded-for` aware |
| `endpoint`, `http_method` | request path and method; the route template is in `payload.route` |
| `method` | `module.function` (Python) or `path/to/file.fn` (Node) of the first frame in the service's own code; for a route that answered 5xx without an exception, the route handler |
| `action`, `resource_type`, `resource_id` | same values as the audit row: ACTION (`VIEW`/`CREATE`/`UPDATE`/`DELETE` from the HTTP verb), RESOURCE TYPE (`STORAGE FOLDER`, `CASE`, `FILE`, … from the path), and the resource id when a `*_id` / `*_name` path param is present |
| `status_code`, `user_message` | HTTP status returned and the exact `detail` / `message` / `error` the client saw (max 1000 chars) |
| `error_type`, `error_message`, `stack_trace` | exception class, exact internal message (max 4000), the last 10000 chars of the stack. A route that answers 5xx with no exception gets `error_type = HttpErrorResponse500` |
| `error_code`, `what_happened`, `suggested_fix` | the admin detail view's fields (migration 188): a stable code such as `AUTH_EXPIRED`, `PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `AI_QUOTA_EXCEEDED`, `AI_SAFETY_BLOCK`, `UPSTREAM_AUTH_FAILED`, `UPSTREAM_TIMEOUT`, `DATABASE_UNAVAILABLE`, `PAYMENT_CANCELLED`, `BROWSER_NETWORK_ERROR`, `JOB_FAILED`; "The user tried to open the plan details, but the request was refused (HTTP 403)."; "User: log in again. Developers: renew the token before it expires …". `payload.display` says how the browser showed the message (`toast`, `banner`, `inline`) when the frontend reported it |
| `error_summary` | one plain-language sentence a non-technical reader understands, derived from the category, provider, status and type (migration 187): "The payment gateway (Razorpay) rejected our credentials (API key or token), so the call was refused.", "The request failed because the user was not logged in or the session had expired (HTTP 401).", "A programming error in the code caused this (KeyError): 'missing'". Also on failed `api_audit_logs` rows |
| `external_provider` | `GEMINI`, `CITATION`, `ANTHROPIC`, `DEEPSEEK`, `PAYMENT_SERVICE`, `AUTH_SERVICE`, … (hosts mapped from `*_URL` env vars and `EXTERNAL_PROVIDERS`) |
| `external_endpoint` | URL without query string (API keys travel in `?key=`), or the SDK method such as `genai.models.generate_content` |
| `external_model`, `external_status_code`, `external_error_code`, `external_response`, `latency_ms` | Gemini model, upstream HTTP status, `RESOURCE_EXHAUSTED` / `DEADLINE_EXCEEDED` / block reason / finish reason, sanitized upstream body (max 2000), call time |
| `payload` | sanitized metadata only: `route`, `user_agent`, `duration_ms`, `attempts`, `tokens` (Gemini usage), `finish_reasons`, `output_chars`, `related` (other distinct errors merged into this row), `internal_error` / `internal_stack` (the exception behind a merged external row), `http_detail`, `logger`, `cause` |
| `fingerprint` | `sha256(service_name|error_type|method|first own-code frame file:line|external_provider|external_error_code)`; groups recurrences |
| `is_resolved`, `resolved_by`, `resolved_at`, `resolution_note` | admin workflow; resolved rows are purged after `ERROR_LOG_RETENTION_DAYS` |

Secrets are masked everywhere (`***`): keys named password, token, api_key, key,
secret, otp, authorization, cookie and the like; Bearer tokens, `?key=` values,
Google `AIza…` keys, `sk-…` keys, JWTs and DSN passwords inside strings. Request
headers are never stored except `user-agent`. Case content, document text,
prompts, chat messages and model output are never stored unless
`ERROR_LOG_STORE_AI_CONTENT=true`; by default only lengths, counts, model names
and token counts are kept. Payload strings are capped at 500 chars, depth 3,
20 items per list.

## Reading a row

- An unhandled exception: `source=HTTP`, `error_type=KeyError`, `error_message`
  the real message, `stack_trace`, `user_message="Internal server error"`,
  `status_code=500`.
- A route that raised `HTTPException(500, detail=f"... {e}")` from an except
  block: the row carries the **cause** (`error_type`, `stack_trace` of the real
  exception) and `payload.http_detail` holds the detail the user saw.
- A Gemini quota failure behind a 500: `source=EXTERNAL_API`,
  `category=AI_PROVIDER`, `severity=CRITICAL`, `external_provider=GEMINI`,
  `external_status_code=429`, `external_error_code=RESOURCE_EXHAUSTED`,
  `external_model`, `latency_ms`, and `status_code=500`, `user_message` from the
  response. The route's own exception, if different, is in `payload.related` and
  `payload.internal_stack`.
- A safety block in a request that failed: `category=AI_SAFETY_BLOCK`,
  `severity=WARNING`, `external_error_code=SAFETY` (or the prompt block reason).
- `category=AI_EMPTY_RESPONSE` with `external_error_code=MAX_TOKENS` is a
  truncated answer (`payload.partial` says whether any text came back);
  `EMPTY_RESPONSE` / `NO_CANDIDATES` means a 200 from Gemini with nothing in it.
- A citation API 500 or timeout behind a 502: `category=CITATION_PROVIDER` or
  `TIMEOUT`, `external_provider=CITATION`, `external_endpoint` without the token.

Useful queries:

```sql
-- what is hurting users right now
SELECT created_at, service_name, severity, category, error_type, left(error_message, 120), user_message, request_id
FROM error_logs WHERE NOT is_resolved ORDER BY created_at DESC LIMIT 100;

-- recurring problems
SELECT fingerprint, service_name, error_type, method, count(*) AS hits, max(created_at) AS last_seen
FROM error_logs WHERE NOT is_resolved GROUP BY 1,2,3,4 ORDER BY hits DESC LIMIT 50;

-- everything one request did (follow the x-request-id across services)
SELECT * FROM error_logs WHERE request_id = '…' ORDER BY created_at;

-- resolve a fingerprint
UPDATE error_logs SET is_resolved = true, resolved_by = 'admin@jurinex', resolved_at = now(),
       resolution_note = 'fixed in …' WHERE fingerprint = '…' AND NOT is_resolved;
```

## Where each hook lives

Python (every FastAPI service, and Flask for Visual-Service), inside the
service's `errorlog/` package:

| Hook | File | What it does |
|---|---|---|
| Request context + request id + response hook | `asgi.py` | Pure ASGI middleware wrapped **outside** Starlette's `ServerErrorMiddleware` (via `app.build_middleware_stack`), so it sees the final status and body of every response. Reads or generates `x-request-id` and returns it; stores ip / endpoint / method / user (JWT payload or `x-user-id`) in contextvars with a per-request `pending` list; peeks up to 4 KB of 4xx/5xx bodies for `user_message`; never buffers `text/event-stream` / ndjson; catches exceptions raised after the response started; flushes on completion |
| Global exception handlers | `handlers.py` | `Exception` and `HTTPException` (Starlette and FastAPI classes) handlers that record and then delegate to the service's existing handler, or answer `{"detail": "Internal server error", "request_id"}` with the app's CORS headers mirrored. `HTTPException(≥500)` records its `__cause__` / `__context__` |
| Gemini | `gemini.py` | Patches `google.genai.models.Models` and `AsyncModels` (`generate_content`, `generate_content_stream`, `embed_content`, `count_tokens`, `compute_tokens`) once at install, which also covers Google ADK; and the legacy `google.generativeai` `GenerativeModel` / `ChatSession`. Records exceptions, block reasons, finish reasons, empty responses, MAX_TOKENS, token counts, latency; stream iterators are proxied |
| External HTTP | `httpclients.py` | Patches `httpx.Client.send`, `httpx.AsyncClient.send`, `requests.Session.send`, `aiohttp.ClientSession._request`, `urllib.request.OpenerDirector.open`. Records ≥400, timeouts, connection errors; forwards `x-request-id`; strips query strings; skips Gemini hosts while the SDK wrapper is active and in-process ASGI transports |
| Logger | `loghook.py` | `logging.Handler` at ERROR on the root logger and `uvicorn`, `uvicorn.error`, `gunicorn.error`, `fastapi`, `starlette`, `asyncio`; only records with `exc_info`; the logger's own `errorlog` loggers are excluded; one exception object is recorded once however many hooks see it |
| Jobs / process | `jobs.py` | `sys.excepthook`, `threading.excepthook`, the asyncio loop exception handler (installed on first use), and contextvars propagation into `ThreadPoolExecutor.submit` so a Gemini call made through `run_in_executor` still belongs to its request |
| Model-output parsers | `parsehook.py` | Wraps the shared parse helpers listed per service in `install(parse_helpers=...)`: a raise or a `None` result is `AI_INVALID_OUTPUT` (WARNING) |
| Writer | `writer.py` | Bounded queue (10000; overflow drops with a warning once a minute) drained by a daemon thread in batches of 50 every 2 s on its own connection (psycopg 3, psycopg2 or asyncpg, whichever the service has) or by POSTing to the ingest endpoint; failed batches retry 3 times with backoff; flushes at exit; never raises |
| Ingest endpoint | `ingest.py` | `POST /internal/error-logs` on agentic-document-service only, hidden from OpenAPI, header `X-Internal-Key = ERROR_LOG_INGEST_KEY`, one object or up to 100, validated and sanitized, then queued |
| Retention | `writer.py` | Daily (owner only): `DELETE … WHERE is_resolved AND resolved_at < now() - retention days` |
| Debug routes | `debug_routes.py` | `GET /internal/error-logs/_debug/*` when `ENVIRONMENT` is not production |
| Flask | `flask_ext.py` | `before_request` / `after_request` / `teardown_request` and an `Exception` error handler answering `{"error": "Internal server error", "request_id"}` |

Node (every Express service), inside the service's `errorlog/` module:

| Hook | File | What it does |
|---|---|---|
| Request context + response hook | `hooks/express.js` `requestMiddleware` | First middleware: `AsyncLocalStorage` with request id, ip, endpoint, method, user (JWT payload / `x-user-id`, replaced by `req.user` once auth ran), `pending` list; returns `x-request-id`; wraps `res.write` / `res.end` once to peek ≤4 KB of 4xx/5xx bodies (never for event streams); flushes on `finish` / `close` |
| Error handler | `hooks/express.js` `errorHandler` | Registered **just before** the service's own error handler with `passThrough: true`, so the existing response format is untouched; where no handler existed (chat-draft-backend) it answers in that service's shape with a safe message and `request_id`, never a stack |
| Express 4 async errors | `hooks/asyncErrors.js` | Patches the router `Layer` once so a rejected async handler calls `next(err)` (what `express-async-errors` does); Express 5 is left alone |
| Gemini | `hooks/gemini.js` | `@google/genai` `Models.prototype.generateContentInternal`, `generateContentStreamInternal`, `embedContentInternal`, `countTokens`, `computeTokens` (the public methods and `Chat` delegate to these); legacy `@google/generative-ai` `GenerativeModel` / `ChatSession` prototypes |
| External HTTP | `hooks/http.js` | `http.request` / `http.get` / `https.request` / `https.get` observed through `emit` (covers axios, node-fetch, got, googleapis, http-proxy-middleware, raw http without adding listeners) and a `globalThis.fetch` wrapper (undici, OpenAI/Anthropic SDKs). Records ≥400, timeouts, network errors; forwards `x-request-id`; strips query strings |
| Logger | `hooks/logger.js` | `console.error` wrapper (records when an argument is an `Error`) and `winston.transports.Console.prototype.log` for error-level entries carrying an error |
| Process / jobs | `hooks/process.js` | `unhandledRejection`, `uncaughtException` (record, flush, keep the default crash when no other listener exists), `SIGTERM` / `SIGINT` flush, a `process.exit` wrapper that waits up to 1.5 s for queued rows, `node-cron.schedule` wrapper (`endpoint = cron:<expr>`) |
| Writer | `writer.js` | Queue (10000) written every 2 s or 50 rows to `pg` (separate pool, max 2, idle errors swallowed) or POSTed to the ingest endpoint; retries; flushes on signals; never throws |

### Where install is called

| Service | Language | Wiring | Sink (local `.env`) |
|---|---|---|---|
| agentic-document-service | FastAPI | `main.py` after `app = create_app()`; `owner=True` (ingest + retention); parse helpers `learning_agent_controller.parse_model_json`, `document_ai.repair_json` | own `DATABASE_URL` (Document_DB) |
| agentic-chat-service | FastAPI | `main.py` after `app = create_app()` | `ERROR_LOG_DATABASE_URL` |
| agent-draft-service | FastAPI | `api/app.py` after CORS; parse helper `agent_modifier_service._clean_json` | `ERROR_LOG_DATABASE_URL` |
| citation-service | FastAPI | `main.py` after the request-logging middleware; parse helpers `_jsonsafe.loads_lenient`, `runner._parse_json_loose` | `ERROR_LOG_DATABASE_URL` |
| judgement-service | FastAPI | `api.py` after CORS | `ERROR_LOG_DATABASE_URL` |
| ai-chatbot | FastAPI | `main.py` after the global error handler | `ERROR_LOG_DATABASE_URL` |
| Template Analyzer Agent | FastAPI | `src/app.py` after the routers; parse helper `AgentService._parse_json` | `ERROR_LOG_DATABASE_URL` (asyncpg) |
| citation-testing | FastAPI | `main.py` after CORS | `ERROR_LOG_INGEST_URL` (no DB driver) |
| Visual-Service | Flask | `main.py` after the blueprint | `ERROR_LOG_DATABASE_URL` (psycopg2) |
| gateway-service | Express 5 | `src/app.js` after `express()`, pass-through handler before the general error handler | `ERROR_LOG_INGEST_URL` (no pg) |
| authservice | Express 4 | `index.js` | `ERROR_LOG_DATABASE_URL` |
| payment-service | Express 5 | `index.js` | `ERROR_LOG_DATABASE_URL` |
| chat-draft-backend | Express 5 | `src/server.js`; had no error handler, ours answers `{message, request_id}` | `ERROR_LOG_INGEST_URL` (no pg) |
| drafting-service | Express 5 | `index.js` | `ERROR_LOG_DATABASE_URL` |
| draft-service | Express 4 | `index.js` | `ERROR_LOG_DATABASE_URL` |
| zoho-service | Express 4 | `src/app.js` | `ERROR_LOG_DATABASE_URL` |
| support-service | Express 5 | `index.js` | `ERROR_LOG_DATABASE_URL` |
| Translation-service | Express 4 | `server.js` | `ERROR_LOG_INGEST_URL` (no pg) |
| ChatModel | Express 4 | `index.js` | `ERROR_LOG_DATABASE_URL` |

`Backend/document-service` is an empty shell (no entry point) and is not wired.

## Configuration

All values have safe defaults. With no sink configured the logger stays enabled,
counts errors and warns once at startup.

| Variable | Default | Meaning |
|---|---|---|
| `SERVICE_NAME` | the `install(service_name=...)` argument, else the folder / package name | `service_name` column |
| `ENVIRONMENT` | `APP_ENV`, `NODE_ENV`, `ENV`, else `development` | `environment` column; `production` / `prod` / `live` disables the debug routes |
| `ERROR_LOG_ENABLED` | `true` | master switch |
| `ERROR_LOG_DATABASE_URL` | unset (the owner falls back to its `DATABASE_URL`) | direct writes with a separate pool of 2 |
| `ERROR_LOG_INGEST_URL` | unset | Node services without a DB POST here. Gateway defaults to `FILE_SERVICE_URL` origin + `/internal/error-logs` (never `/audit`) |
| `ERROR_LOG_INGEST_KEY` | `jurinex-errorlog-dev` outside production | shared secret (`X-Internal-Key`). Production must set it on the owner and every ingest client |
| `ERROR_LOG_RETENTION_DAYS` | `90` | resolved rows older than this are deleted daily (owner) |
| `ERROR_LOG_STORE_AI_CONTENT` | `false` | store prompt / output previews |
| `ERROR_LOG_CAPTURE_ALL` | `false` | `true` stores every 4xx/5xx and recovered internals (WARNING). Default `false` = only genuine failures the user got (5xx / unhandled) |
| `ERROR_LOG_SKIP_STATUS` | empty (`400,401,403,404,409,422` when capture-all is off) | statuses that never produce a row; set it to e.g. `404` to drop bot noise |
| `ERROR_LOG_STORE_RECOVERED_EXTERNAL` | `false` | (capture-all off only) also keep external / AI failures the request recovered from |
| `ERROR_LOG_AUDIT_ENABLED` | `true` | one `api_audit_logs` row per request |
| `ERROR_LOG_AUDIT_SKIP_PREFIXES` | `/health,/internal/error-logs,/internal/audit-logs,/docs,/openapi.json,/redoc,/favicon.ico` | endpoints never audited |
| `ERROR_LOG_AUDIT_RETENTION_DAYS` | `90` | audit rows older than this are deleted daily (owner) |
| `ERROR_LOG_STORE_4XX_PREFIXES` | unset (`/api/payments` on payment-service) | endpoint prefixes whose 4xx answers are stored as WARNING rows even though 4xx is normally skipped (never 401/403/404). Keeps "Invalid payment signature" and "Missing verification data" |
| `EXTERNAL_PROVIDERS` | built-in map | extra `host=PROVIDER,host2=PROVIDER` (or JSON). Built in: `generativelanguage.googleapis.com`, `*.aiplatform.googleapis.com` → `GEMINI`; `indiankanoon.org` → `CITATION`; Anthropic, OpenAI, DeepSeek, Document AI, GCS, Brevo, Razorpay, Zoho, Microsoft; plus the host of every `*_URL` / `*_SERVICE_URL` env var named after that variable (`PAYMENT_SERVICE_URL` → `PAYMENT_SERVICE`, `IK_API_URL` → `CITATION`) |
| `ERROR_LOG_QUEUE_MAX`, `ERROR_LOG_BATCH_SIZE`, `ERROR_LOG_FLUSH_INTERVAL_S` (`_MS` in Node) | `10000`, `50`, `2` s | writer tuning |
| `ERROR_LOG_DEBUG_ROUTES` | not production | force the debug routes on or off (Python) |

Local `.env` files were given these settings; production deployments (Cloud Run)
need `ERROR_LOG_DATABASE_URL` (or `ERROR_LOG_INGEST_URL` + `ERROR_LOG_INGEST_KEY`),
`ENVIRONMENT=production` and `ERROR_LOG_INGEST_KEY` on the owner.

The Python module reads `os.environ` first and then the service's own `.env`
file for `ERROR_LOG_*`, `SERVICE_NAME`, `ENVIRONMENT`, `EXTERNAL_PROVIDERS` and
`*_URL` keys. That matters for services that load `.env` through
pydantic-settings (agentic-chat-service, judgement-service), which never export
it to the process environment.

## Audit log of API usage (`api_audit_logs`)

Every request to every service also writes one row to `api_audit_logs` in
Document_DB: who used which service and which API, how it went, and the error
row behind it when it failed. ACTION / RESOURCE TYPE / METHOD match the admin
Audit Logs table (VIEW, STORAGE FOLDER, FolderService.get…). Migrations
[184_api_audit_logs.sql](../Backend/agentic-document-service/db/migrations/184_api_audit_logs.sql),
[185_api_audit_logs_method.sql](../Backend/agentic-document-service/db/migrations/185_api_audit_logs_method.sql)
and [185_api_audit_logs_error_columns.sql](../Backend/agentic-document-service/db/migrations/185_api_audit_logs_error_columns.sql)
(all idempotent, all also applied on first connect). Genuine errors still go to
`error_logs`; the failed audit row stores `error_log_id` and a copy of the error
(`error_type`, `error_message`, `user_message`), which stay empty on success.

| Column | Meaning |
|---|---|
| `created_at`, `service_name`, `environment` | when the request finished, which service answered |
| `request_id` | the `x-request-id` the client received; the same id is on the `error_logs` rows of that request and on the browser report, so one request can be followed across services |
| `user_id`, `user_email`, `ip_address`, `user_agent` | who (from the service's auth, `req.user`, the JWT payload or `x-user-id`); null for unauthenticated and service-to-service calls |
| `http_method`, `endpoint`, `route` | which API: the actual path and the route template (`/api/files/{folder_name}/upload`) |
| `status_code`, `status`, `duration_ms` | result: `SUCCESS` for < 400, `FAILED` for 4xx/5xx or when an error row was written, and how long it took |
| `error_log_id` | id of the `error_logs` row for a failed request (`payload.error_log_ids` when there were several) |
| `error_type`, `error_message`, `user_message`, `stack_trace` | the failure itself, copied from that error row (exact internal error, what the user saw, the stack); all NULL when the request succeeded (migrations 185, 186) |

`api_audit_logs` is therefore the one table that holds both normal activity and
errors. Errors with no request of their own (background jobs, process crashes,
browser reports) also get a `FAILED` row there, with `endpoint` such as
`job:nightly` or `client:chat` and `payload.source`, linked to `error_logs` by
`error_log_id`. The `POST …/client-errors` call that carries a browser report is
not itself audited; the report is.
| `action`, `method` | `VIEW` / `CREATE` / `UPDATE` / `DELETE` from the HTTP verb, and the handler shown by the admin console (`FolderService.list_folders`), derived by `errorlog/auditmeta` |
| `resource_type`, `resource_id`, `action` | RESOURCE TYPE (`STORAGE FOLDER`, `CASE`, `FILE`, `USER`, … from the path or a `*_id` param), the id when present, ACTION (`VIEW` from GET, `CREATE` from POST, `UPDATE` from PUT/PATCH, `DELETE` from DELETE) |
| `method` | handler label for the METHOD column (`FolderService.list_folders`, `CaseService.get_all_cases`), not the HTTP verb |
| `payload` | `streaming`, `method` (same handler label), `error_log_ids` when several errors were stored |

Not audited: `OPTIONS` and `HEAD`, and endpoints under
`ERROR_LOG_AUDIT_SKIP_PREFIXES` (default `/health`, `/internal/error-logs`,
`/internal/audit-logs`, `/docs`, `/openapi.json`, `/redoc`, `/favicon.ico`).
`ERROR_LOG_AUDIT_ENABLED=false` turns the audit log off for a service. Rows older
than `ERROR_LOG_AUDIT_RETENTION_DAYS` (90) are deleted daily by the owner.
Services without a database driver post their audit rows to
`POST /internal/audit-logs` on agentic-document-service (same key as the error
ingest). Browser-side, `GET /internal/error-logs/_debug/audit-recent` shows the
latest rows outside production.

Useful queries:

```sql
-- what one user did today, with failures highlighted (admin table columns)
SELECT created_at AS timestamp, user_email AS user, action, resource_type, method, ip_address,
       status, status_code, error_log_id
FROM api_audit_logs WHERE user_id = '76' AND created_at > now() - interval '1 day' ORDER BY created_at;

-- which APIs are used most, and their failure rate
SELECT service_name, http_method, route, count(*) AS calls,
       count(*) FILTER (WHERE status = 'FAILED') AS failed, round(avg(duration_ms)) AS avg_ms
FROM api_audit_logs WHERE created_at > now() - interval '7 days'
GROUP BY 1,2,3 ORDER BY calls DESC LIMIT 50;

-- a failed request and its error, side by side
SELECT a.created_at, a.service_name, a.endpoint, a.status_code, e.error_type, e.error_message, e.user_message
FROM api_audit_logs a JOIN error_logs e ON e.id = a.error_log_id
WHERE a.user_id = '76' ORDER BY a.created_at DESC LIMIT 20;
```

## Browser errors (client reports)

Everything that goes wrong in the frontend is reported to the central log with
the signed-in user's id by [frontend/src/services/clientErrorReporter.js](../frontend/src/services/clientErrorReporter.js),
installed once in `main.jsx`:

| Browser event | kind | Row |
|---|---|---|
| uncaught exception (`window` "error") | `unhandled` | `source=HTTP`, `error_type` = the JS error name, `stack_trace`, `endpoint=client:app` |
| unhandled promise rejection | `unhandled` | same, `endpoint=client:promise` |
| `fetch` that never got a response (offline, DNS, CORS, server down) | `network` | `source=EXTERNAL_API`, `external_provider` from the host, `external_endpoint` without query string |
| script / stylesheet / image failed to load | `network` | `endpoint=client:asset` |
| `console.error(..., err)` with an Error object | `error` | `endpoint=client:console` |
| React render crash (error boundaries call `reportClientError`) | `render` | `endpoint=client:<boundary>`, `payload.details.componentStack` |
| Razorpay cancelled / failed / verify failed (see below) | `cancelled` / `failed` / `verify-failed` | `external_provider=RAZORPAY` |

Reports go to `POST /api/files/client-errors` on agentic-document-service,
mounted by `install(client_report_path=..., client_report_dependency=get_current_user)`
and served by `errorlog/clientreport.py` behind the service's verified-JWT
dependency. Backend 5xx responses are not reported from the browser: the backend
already recorded them with the same `request_id`. Reports are de-duplicated for
10 s, capped at 30 per minute per browser and 60 per minute per user on the
server, and need a login token; without one nothing is sent. The endpoint's own
refusals (401, 429) are never rows.

Any component can report explicitly:

```js
import { reportClientError } from '../services/clientErrorReporter';
reportClientError({ kind: 'error', flow: 'upload', error: err, message: 'Upload failed', details: { fileName } });
```

### Payment failures (Razorpay)

A Razorpay checkout the user closes, a card the bank declines, or a verify
call that fails happens in the browser: the backend never sees it. These are
reported with the payment details:

- payment-service mounts `POST /api/payments/client-errors` from the error-log
  module itself (`errorlog/hooks/clientReport.js`), behind its own `protect`
  middleware, so the row carries the caller's `user_id` and `user_email`.
  Body: `flow` (`token-topup`, `storage-addon`, `subscription`), `kind`
  (`cancelled`, `failed`, `verify-failed`, `error`), `message` (what the user
  saw), the Razorpay `payment.failed` payload, `order_id`, `plan_id`,
  `plan_name`, `amount`, `currency`. Answers `202 {success, request_id}`;
  `401` without a valid token.
- The frontend helper [frontend/src/services/paymentErrorReport.js](../frontend/src/services/paymentErrorReport.js)
  is called from the three Razorpay flows (`TokenTopupModal`, `StorageAddonModal`,
  landing `PricingSection`) on `modal.ondismiss`, `payment.failed`, a failed
  verify and a failed start. It is fire-and-forget and never affects checkout.

Stored as `source = EXTERNAL_API`, `external_provider = RAZORPAY`,
`error_type = PaymentCancelled` (WARNING, `external_error_code = USER_CANCELLED`)
or `PaymentFailed` / `PaymentVerifyFailed` (ERROR, Razorpay's `code`,
`description` in `external_response`, `reason` / `step` / `source` /
`order_id` / `payment_id` / plan and amount in `payload`), `endpoint = client:<flow>`.
These rows are written immediately, independent of the HTTP status of the
report request.

Backend-side payment errors answered with 4xx (signature mismatch, missing
verification data) are kept too through `ERROR_LOG_STORE_4XX_PREFIXES=/api/payments`.

## Ingest endpoint

`POST /internal/error-logs` on agentic-document-service, header
`X-Internal-Key: <ERROR_LOG_INGEST_KEY>`, body one row object or a list of up to
100 rows using the column names above (`service_name` and `error_message` are
required; `created_at` ISO-8601; unknown `source` / `category` / `severity`
fall back to `HTTP` / `INTERNAL` / `ERROR`). Rows are sanitized the same way as
local ones. Response: `{"accepted": n, "dropped": n, "rejected": [...], "rejected_count": n}`.
`401` on a bad key, `413` above 100 rows, `503` when no key is configured. Not in
the OpenAPI schema, not proxied by the gateway.

## Verifying

Debug routes (any FastAPI service when `ENVIRONMENT` is not production), under
`GET /internal/error-logs/_debug/`:

| Route | Expectation |
|---|---|
| `raise` | 500, one row with `user_message`, `error_message`, `stack_trace` |
| `http-500` | one row carrying the `KeyError` cause and `payload.http_detail` |
| `return-500` | one row (`HttpErrorResponse500`, or the logged exception) |
| `logged-and-ok` | 200, **no** row |
| `external-fail` | exactly one merged row: connection failure to `127.0.0.1:9` with the query string stripped, `status_code=500` |
| `gemini-fail` | one merged row with `external_provider=GEMINI` (needs network) |
| `stream-fail` | one row with `payload.after_response_start=true` |
| `background-fail` | one row after the 200 response |
| `not-found` | 404, no row |
| `stats` | writer and hook counters |
| `recent?limit=20` | the latest rows from the database (`X-Internal-Key` required on the owner) |

Tests:

```powershell
# Python (needs pytest, fastapi, httpx in the interpreter)
cd Backend\agentic-document-service
python -m pytest tests\test_errorlog.py -q
# add ERROR_LOG_TEST_DATABASE_URL=<Document_DB url> to also exercise the real table

# Node
cd Backend\payment-service;  node --test test\errorlog.test.js   # Express 5
cd Backend\authservice;      node --test test\errorlog.test.js   # Express 4
```

They prove: unhandled exception → row with user and internal message and
stack; route answering 500 itself → row; Gemini exception, safety block, empty
response, MAX_TOKENS → rows with provider fields; citation 500 and timeout →
rows with the query string stripped; Gemini failure + 500 in one request →
exactly one merged row; retries → one row with `attempts`; 404/422 → no row;
recovered errors → no row; failure after response start → row; `x-request-id`
echoed and forwarded; secrets masked; ingest auth and batch limits; the logger
keeps working and counts failures when the database is down; the real
Document_DB roundtrip (Python, when the URL is given).

## Updating the module

Each service's `errorlog/` directory is an independent copy. A fix made in one
copy has to be copied to the others that need it; the Python copies are
identical to each other, and so are the Node copies. Docker builds use the
service folder as context, so the directory ships with every image. The
`.dockerignore` and `.gcloudignore` files do not exclude it.

## Limits and what could not be hooked centrally

- **Audit integration.** Each request writes `api_audit_logs` with ACTION,
  RESOURCE TYPE and METHOD filled for the admin table. Failed requests also
  write `error_logs` and set `error_log_id` on the audit row. `error_logs.method`
  still prefers the first own-code stack frame; the audit METHOD column is the
  route handler (`FolderService.list_folders`).
- **Fire-and-forget futures.** `ThreadPoolExecutor.submit(...)` results that
  nobody awaits keep their exception on the future; nothing central sees it unless
  the worker logs it. Sites: agentic-document-service `chat_summary.py:160`,
  `chunk_autoheal.py:48`, `chunk_pages.py:125`, `memory/chat_index.py:72`,
  `memory/recall.py:390`, `memory/reread.py:50`, `memory/seed.py:793`,
  `memory/writer.py:125`, `personalization_service.py:112`,
  `folder_service.py:2722`; agent-draft-service `services/job_queue.py:86`,
  `services/ingestion_queue.py:163`; citation-service
  `pipeline/stages/retrieve_candidates.py:240`.
- **Context in thread pools.** Context is copied into every executor job, so a
  job that fails *before* its request finishes counts for that request; one that
  fails later is written with the request's attribution.
- **Google Cloud gRPC SDKs** (Document AI, Speech, Translation, Secret Manager,
  GCS) do not go through httpx or `http.request`; their failures surface only
  through the exception that reaches a handler or a logger.
- **Legacy `google.generativeai` streaming** (`stream=True`) is not proxied; only
  its exceptions are recorded.
- **Node routes that answer 5xx without logging the error** produce a row with
  `HttpErrorResponse5xx` and the body message, but no stack (there is no
  exception object to capture). Most controllers do `console.error(err)` first,
  which supplies it.
- **Model-output parsing is scattered.** Shared helpers are hooked where they
  exist (see the wiring table). Inline `json.loads` + regex copies that are not
  hooked: agentic-document-service `document_ai.py:3336`, `chat_summary.py:615`,
  `clarification.py:60`, `deep_research/orchestrator.py:193`,
  `deep_research/agent.py:59`, `memory/answer_facts.py:183`,
  `memory/consolidate.py:156`, `memory/polish.py:79`, `memory/profile.py:200`,
  `memory/same_fact.py:413`, `memory/seed.py:165`, `memory/synthesis.py:253`,
  `memory/writer.py:672`, `secret_prompt_display.py:338`,
  `template_drafting.py:343/359`, `structured_case.py:92`, `files.py:1287`,
  `folder_service.py:3679`; agentic-chat-service `pipeline.py:105/131/161/185`,
  `agents/tools/chat_tools.py:25`, `chat_helpers.py:114` (Pydantic
  `model_validate_json` sites raise `ValidationError`, which is captured as a
  normal exception); agent-draft-service `autopopulation_agent.py:98`,
  `injection_agent.py:551`, `drafter/tools.py:533`, `critic/tools.py:218/337`,
  `citation/tools.py:67`; judgement-service `tools.py:2845`; Visual-Service
  `gemini_service.py:351/369`; ChatModel `llmService.js:364/504-557`;
  zoho-service `draftFromChatController.js:76-85`.

## Appendix: catch blocks that swallow errors

Listed only, not changed. These are places where an error is caught with no
log, no rethrow and no 5xx, so nothing central can see it.

**agentic-document-service** (336 silent except blocks found; the relevant ones):
`files.py:834/852/878` role and plan lookups return None; `files.py:996`,
`llm_chat_policy.py:34`, `payment_token_guard.py:55`, `batch.py:136`,
`cases.py:50` JWT decode failures; `files.py:1696/1749/2098`;
`files.py:3096` folder status falls back to a stub; `files.py:5373-5500`
Claude/DeepSeek/Kimi stream exceptions appended to a list;
`files.py:5526/5556/6187/6693/606`; `batch.py:459`; `custom_prompts.py:44/53`;
`folder_service.py:155/1740/2300/2760/3690`;
`batch_document_processor.py:155` marking a file failed is itself swallowed;
`batch_service.py:52/85/784`; `llm_policy_service.py:252` top-up limit check;
`pipeline_service.py:247/259/647/730`; `agent_config_service.py:331/371/551`;
`chat_summary.py:380`; `memory/writer.py:1068`; `memory/reread.py:224`;
`memory/recall.py:420`; `memory/profile.py:379`;
`deep_research/gemini.py:96/114/148/200/241/349`; `deep_research/agent.py:445`;
`embeddings.py:82`; `document_ai.py:418/3645`; `ocr.py:1390`;
`template_drafting.py:2876/2921`; `agents/legal_case_management/agent.py:29`.

**agentic-chat-service** (72 found): `chat.py:102`; `drafting.py:73`;
`agents/adk_app.py:183`; `agents/drafting_adk.py:128`;
`chat_orchestrator.py:677`; `gemini_cache_service.py:339/436/1454/1545`;
`llm_policy_service.py:66/102/199`;
`llm_service.py:182/301/368/397/598/860/1214/1249`;
`drafting_service.py:1151/1676/1691/2822/3241`; `draft_ingestion.py:71/91/106`;
`draft_invariants.py:430/499`; `draft_provenance.py:57`;
`draft_repairs.py:1063`; `drafting_monolithic.py:783`;
`judgement_search_service.py:181/317`; `payment_token_guard.py:68`;
`secret_prompt_service.py:93/102/133`; `pipeline.py` (4 JSON parses).

**agent-draft-service**: `api/librarian_routes.py:108`; `api/app.py:96`;
`services/claude_client.py:81` and `services/deepseek_client.py:115`
(usage log lost); `services/draft_db.py:34/350/417/625`;
`services/gcs_signed_url.py:50`; `services/document_ai.py:231`;
`services/docx_export.py:441`; `services/agent_config_service.py:61/75`;
`services/payment_token_guard.py:39`;
`agents/ingestion/autopopulation_agent.py:104`;
`api/section_routes.py:1264/1346`; `api/template_routes.py:96/616/706`.

**citation-service** (about 70): `pipeline/stages/retrieve_candidates.py:240`
failed IK query future dropped; `runner.py:51/144`;
`grounding_search.py:181`; `services/indiankanoon_client.py:563/667`;
`main.py:114/2182/2383/2431/2433`; `legacy_pipeline.py:309`;
`db/client.py:1244/1338/1434/1805` plus about 10 rollback/close blocks;
`db/connections.py:79/116/130/146/189/418/452`;
`services/payment_guard.py:39/93`; `citation_verifier.py:83/163`.

**judgement-service**: `stores.py:118/450/834/968/979`; `tools.py:1490/2858`;
`agents.py:1167`; `agent_config.py:272/285/294/308/369/481`.

**ai-chatbot**: `calendar_service.py:43`; `search.py:154`.

**Template Analyzer Agent**: `auth_service.py:48`;
`document_ai_service.py:19/173/199`; `analysis.py:426`; `generate.py:216/269`;
`agent_service.py:268`.

**Visual-Service**: `gemini_service.py:375/393`; `document_service.py:121`;
`main.py:20`.

**citation-testing**: `runner.py:69/146/355/419/772/972/1699`;
`claude_runner.py:114`; `gemini_runner.py:47/49/70/196`; `main.py:114/187`.

**gateway-service**: `mockUserResourcesRoutes.js:38/96` fake success;
`app.js:161-165` ping 4xx turned into 200.

**authservice**: `authController.js:111/233/371/454/897`;
`sessionController.js:31/41`; `models/ContactEnquiry.js:88`;
`utils/deviceInfo.js:82`; `utils/jwt.js:98/108`.

**payment-service**: `monthlyPlansController.js:110/245/300/313` (245 defaults
a payment to captured); `storageAddonController.js:287`;
`storageController.js:59`; `proformaPdf.js:129/284`;
`storageStatsService.js:169/241/243`; `userPlanSyncService.js:37/101`;
`utils/jwt.js:10`.

**chat-draft-backend**: `chatDraftRoutes.js:239/241`;
`documentProcessor.js:42/55/75/87`; `freeTierModel.js:24/53`.

**drafting-service**: none fully silent; `webhookController.js:34/161`
answers 200 before processing and only logs later failures.

**draft-service**: `auth.controller.js:158/234/243`.

**zoho-service**: `oiController.js:1137/1353` (save callback always answers
200 to Zoho); `draftFromChatController.js:267`; `utils/logger.js:42`.

**support-service**: `services/supportService.js:35`.

**Translation-service**: `controllers/translationController.js:26/42`;
`utils/fileDetector.js:127`.

**ChatModel**: `config/gcs.js:45/57`;
`chatController.js:289/330/1510/2325/2740/2819`;
`storageController.js:49/76/123/167/181`;
`geminiCacheService.js:474/507`; `llmConfigService.js:14/256`;
`llmChatPolicyService.js:201`; `llmService.js:548`.
