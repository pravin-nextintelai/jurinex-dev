# Error and audit logging: the complete workflow

Companion to [error-logging.md](error-logging.md) (the column-by-column reference).
This page follows a request from the browser to the database and explains every
decision the system makes on the way.

## 1. The pieces

| Piece | Where | Job |
|---|---|---|
| `errorlog/` module | one independent copy inside each of the 19 backend services (Python package or Node module) | captures, classifies, batches and writes |
| `error_logs` table | Document_DB | one row per genuine error with full detail (stack, upstream fields) |
| `api_audit_logs` table | Document_DB | one row per API call (activity) and one row per error that had no request; failed rows carry the error too |
| `clientErrorReporter.js` | frontend, installed in `main.jsx` | sends browser-side failures to the backend |
| `POST /api/files/client-errors` (agentic-document-service), `POST /api/payments/client-errors` (payment-service) | owner services | receive browser reports behind the normal login |
| `POST /internal/error-logs`, `POST /internal/audit-logs` (agentic-document-service) | owner service | receive rows from services that have no database driver (gateway, chat-draft-backend, Translation, citation-testing) |

Tables are created by migrations 183 to 186 and also by the module itself on its
first connection, so a fresh database works without running anything by hand.

## 2. Startup: what `install()` does once per process

1. Reads configuration from the environment, then from the service's own `.env`
   (`ERROR_LOG_*`, `SERVICE_NAME`, `ENVIRONMENT`, every `*_URL`).
2. Builds the host-to-provider map: `generativelanguage.googleapis.com` is GEMINI,
   `api.indiankanoon.org` is CITATION, the host of `PAYMENT_SERVICE_URL` is
   PAYMENT_SERVICE, and so on.
3. Starts the writer: a bounded queue (10 000 rows) drained in batches of 50 every
   2 seconds on its own database connection (pool of 2), or by POST to the ingest
   endpoints. It never blocks a request and never raises.
4. Patches the libraries once, at class level, so no call site changes:
   - Gemini: `google.genai` `Models` / `AsyncModels` methods (also what Google ADK
     uses), the legacy `google.generativeai`, `@google/genai`, `@google/generative-ai`;
   - outgoing HTTP: `httpx`, `requests`, `aiohttp`, `urllib` in Python;
     `http.request`, `https.request`, `fetch` in Node;
   - logging: a handler on the root, uvicorn and gunicorn loggers; `console.error`
     and winston in Node;
   - process: `sys.excepthook`, `threading.excepthook`, the asyncio loop handler,
     `unhandledRejection`, `uncaughtException`, `node-cron`, `process.exit`.
5. Wraps the web app: a pure ASGI middleware outside Starlette's error middleware
   (Python) or the first Express middleware plus an error middleware placed just
   before the service's own one (Node). Existing error responses keep their shape.
6. On agentic-document-service only: mounts the ingest routes, the browser-report
   route (moved to the front of the router so no wildcard shadows it) and the
   daily retention job.
7. Outside production: mounts `GET /internal/error-logs/_debug/*` for checks.

## 3. One request, step by step

Take a user pressing "Upload" in Create Case. The browser calls
`POST /api/files/temp-abc/generate-upload-url` on agentic-document-service.

1. **Request arrives.** The middleware reads or creates `x-request-id`, records
   the ip (`x-forwarded-for` aware), method, path, user agent, and the user from
   the JWT payload or `x-user-id`. It opens an empty list of *pending errors* for
   this request.
2. **The route runs.** Whatever happens inside is observed by the patches:
   - the service calls payment-service for the user plan and gets a 401: the HTTP
     hook records an EXTERNAL_API event with provider PAYMENT_SERVICE, the status,
     the URL without its query string, and the latency. It also forwards the
     request id so the payment-service row carries the same id;
   - a Gemini call that fails, is blocked, or returns nothing records an
     AI_PROVIDER / AI_SAFETY_BLOCK / AI_EMPTY_RESPONSE event with model, token
     counts and the Gemini error code;
   - a `logger.exception(...)` or `console.error(err)` records a LOGGER event;
   - an exception that escapes the route is recorded by the exception handler,
     which then returns the existing error format plus `request_id`, never a stack.
   Each error is recorded once even if three hooks see it (a marker on the
   exception object), and a Gemini failure retried three times becomes one event
   with `attempts = 3`.
3. **Response goes out.** The middleware notes the status, peeks at most 4 KB of a
   4xx/5xx body to keep the exact message the user saw, and adds `x-request-id`
   (and exposes it for browsers).
4. **Flush, capture-all mode (default).** Everything recorded is kept:
   - if the request ended 5xx and an external/AI failure is among the events, they
     are merged into one `error_logs` row: the external fields, the final status,
     the user message, and the internal exception in `payload.related`;
   - otherwise one `error_logs` row per distinct error;
   - a 4xx/5xx with no recorded error gets a synthetic row (`HttpErrorResponse404`)
     carrying the message the user saw;
   - a request that answered 2xx despite an error keeps the error as WARNING with
     `payload.recovered = true` (quota errors stay CRITICAL);
   - the request's own refusals from the logging routes (401/429) are never rows.
   With `ERROR_LOG_CAPTURE_ALL=false` only 5xx, non-skipped 4xx and failures after
   the response started are kept; recovered errors are dropped.
5. **Audit row.** Unless the method is OPTIONS/HEAD or the path is in
   `ERROR_LOG_AUDIT_SKIP_PREFIXES` (`/health`, `/internal`, the client-report routes
   and the API docs), one `api_audit_logs` row is written: user, service, method,
   endpoint, route template, action (VIEW / CREATE / UPDATE / DELETE), resource type
   (STORAGE FOLDER, CASE, FILE, …), handler name, status code, duration, and
   `status = SUCCESS` or `FAILED`. On FAILED it also copies `error_type`,
   `error_message`, `user_message` and `stack_trace` from the primary error row
   and links it through `error_log_id`.
6. **Writing.** Both rows go to the queue; the writer inserts them in the next
   batch on its own connection, so a rolled-back transaction in the route does not
   lose them. If the database is down, the batch is retried three times with
   backoff and the service keeps running.

The same request produced rows in two other services: payment-service wrote its
own 401 audit row, and if the gateway was in the path it wrote one too. All three
share the `request_id`, so one query follows the call across services.

## 4. Errors outside a request

- **Background jobs, threads, cron, asyncio tasks, process crashes** are caught by
  the process hooks. The error is written immediately as `error_logs` with
  `source = JOB` or `PROCESS` and `endpoint` such as `job:nightly` or
  `thread:worker-3`, and, because there is no request to audit, a `FAILED`
  `api_audit_logs` row is written for it as well, with the same error text.
- **Streaming and background tasks that fail after the response started** (an SSE
  chat stream that dies, a FastAPI `BackgroundTask`) are kept with
  `payload.after_response_start = true` and the status that was already sent.
- **Context in thread pools**: the request context is copied into every executor
  job, so a Gemini call made through `run_in_executor` still belongs to its request.

## 5. The browser side

`installClientErrorReporter()` runs once at startup and reports, with the user's
login token, every failure the frontend sees:

| Event | kind | Row |
|---|---|---|
| uncaught exception, unhandled promise rejection | `unhandled` | `endpoint = client:app` / `client:promise`, JS error name and stack |
| axios or fetch request that got no response (offline, DNS, CORS, server down, timeout) | `network` | `source = EXTERNAL_API`, provider from the host, URL without query |
| axios or fetch response ≥ 400 **without** an `x-request-id` header (cloud storage, proxies, third parties) | `network` | status and URL. Responses *with* the header were already stored by the backend that answered, so they are not reported twice |
| script, stylesheet or image that failed to load | `network` | `endpoint = client:asset` |
| `console.error(..., err)` with an Error object | `error` | `endpoint = client:console` |
| React render crash (error boundaries) | `render` | component stack in payload |
| Razorpay window closed, card declined, verify failed | `cancelled` / `failed` / `verify-failed` | provider RAZORPAY, Razorpay code and reason, order and plan |

Reports are de-duplicated for 10 seconds, capped at 30 per minute per browser and
60 per minute per user on the server, and sent to agentic-document-service, with
payment-service as a fallback when it cannot be reached. Each report becomes an
`error_logs` row and a `FAILED` `api_audit_logs` row with `endpoint = client:<flow>`
and the user's id; the POST that carried it is not itself audited.

## 6. What is masked and what is never stored

- Keys named password, token, api_key, key, secret, otp, authorization, cookie and
  similar become `***`; Bearer tokens, `?key=` values, Google and OpenAI keys, JWTs
  and database passwords inside strings are masked.
- Request headers are never stored except the user agent.
- Prompts, chat messages, document text and model output are never stored unless
  `ERROR_LOG_STORE_AI_CONTENT=true`; only lengths, counts, model names and token
  counts are kept.
- Payload values are capped at 500 characters, depth 3, 20 items per list;
  messages at 4 000, user messages at 1 000, stack traces keep their last 10 000.

## 7. Services without a database driver

gateway-service, chat-draft-backend, Translation-service and citation-testing have
no PostgreSQL client. Their writer POSTs batches (up to 100 rows) to
`/internal/error-logs` and `/internal/audit-logs` on agentic-document-service with
the shared `X-Internal-Key`. The owner validates and sanitises every row again
before queuing it.

## 8. Retention and housekeeping

Once a day the owner deletes resolved `error_logs` rows older than
`ERROR_LOG_RETENTION_DAYS` (90) and `api_audit_logs` rows older than
`ERROR_LOG_AUDIT_RETENTION_DAYS` (90). Unresolved errors are never deleted.
Admins resolve an error by setting `is_resolved`, `resolved_by`, `resolved_at`,
`resolution_note`; the fingerprint (service, error type, handler, first own-code
frame, provider, upstream code) groups recurrences of the same problem.

## 9. Reading the data

```sql
-- what a user did today, failures with their error
SELECT a.created_at, a.service_name, a.http_method, a.endpoint, a.action,
       a.resource_type, a.method, a.status, a.status_code, a.duration_ms,
       a.error_type, a.user_message
FROM api_audit_logs a
WHERE a.user_email = 'pk@gmail.com' AND a.created_at > now() - interval '1 day'
  AND a.endpoint <> '/api/auth/activity/ping'
ORDER BY a.created_at DESC;

-- one request across services
SELECT service_name, endpoint, status_code, status FROM api_audit_logs WHERE request_id = '…';
SELECT service_name, source, error_type, error_message FROM error_logs WHERE request_id = '…';

-- the full detail behind a failed audit row
SELECT e.* FROM error_logs e JOIN api_audit_logs a ON a.error_log_id = e.id WHERE a.id = '…';
```

## 10. Checking it works

- `GET /internal/error-logs/_debug/raise`, `/return-500`, `/external-fail`,
  `/stream-fail`, `/background-fail` on any FastAPI service produce the rows
  described above; `/logged-and-ok` produces a recovered WARNING; `/stats` shows
  queue counters; `/recent` and `/audit-recent` (with the internal key) read the
  latest rows back.
- Test suites: `tests/test_errorlog.py` in agentic-document-service (pytest) and
  `test/errorlog.test.js` in payment-service and authservice (`node --test`).
- After changing a copy of the module, copy it to the other services and
  **restart them**: a running process keeps the code it started with, which is the
  usual reason rows look incomplete (missing action / method, a 304 marked FAILED).

## 11. Known limits

- No audit mechanism existed before this work; `action` comes from the HTTP verb
  and `method` is the real handler when the service has one, otherwise a name
  derived from the path (gateway proxies).
- Fire-and-forget executor futures whose exceptions are never read cannot be seen
  unless the worker logs them.
- Google Cloud gRPC SDKs (Document AI, Speech, Translation, Secret Manager) do
  not pass through the HTTP hook; their failures appear only when they reach a
  handler or a logger.
- The admin console must read `api_audit_logs` to show activity; today it reads
  only `error_logs`.
