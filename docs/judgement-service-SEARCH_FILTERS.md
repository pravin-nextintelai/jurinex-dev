# Court Filters, Page-wise Fetching & Advanced Search

*judgement-service (port 8005) — implementation reference, 2026-08-18.*

This documents three related systems added to the citation-research pipeline:

1. **One call per query** — a search run sends exactly one Indian Kanoon (IK)
   request per displayed query, carrying the user's court and date filters.
2. **Page-wise fetching** — repeat runs advance each query to its next IK
   result page, tracked per issue.
3. **Advanced Search popup** — a direct, user-driven IK search mirroring
   indiankanoon.org's own advanced form, with in-app judgment viewing.

---

## 1. Court filters on a research run (issues step)

### UI — the four boxes

On the "What should we research?" page, above the grounds/issues board:

| Box | Effect |
|---|---|
| **Supreme Court** | adds `supremecourt` to the run's court list |
| **This case's court** | adds the case's own High Court (detected from the forum / case text via `case_court_profile`); falls back to **all High Courts** when no court can be mapped |
| **Choose courts** | expanding checklist of every IK court token — 31 High Courts, district courts, tribunals — grouped with per-group *Check all* |
| **Date range** | From/To date pickers; rides on every query as `fromdate:` / `todate:` |

Boxes **combine** (Supreme Court + Bombay = both). Nothing ticked = the
service default (`IK_DOCTYPES` env: `supremecourt,highcourts,tribunals`) —
behaviour unchanged for old sessions.

### Request contract

`POST /api/v1/search/{sessionId}/run` gained:

```jsonc
{
  "courtScope": {                 // null = default coverage
    "supremeCourt": true,
    "caseCourt": true,
    "courts": ["delhi", "itat"]   // explicit IK doctype tokens
  },
  "fromdate": "2020-01-01",       // YYYY-MM-DD or DD-MM-YYYY; "" = open
  "todate":   "31-12-2023"
}
```

### How it reaches the wire

- `api.search_run` builds **one deduped doctypes list** from the boxes
  (custom tokens validated against `[a-z_-]+` — never raw query text) and
  sets two per-request **ContextVars** (`tools.set_court_scope`,
  `tools.set_date_scope`). ContextVars propagate into the fan-out's child
  tasks, so concurrent runs never mix scopes.
- `tools.build_ik_query` decorates **every** query of the run:

```text
"civil dispute" quash doctypes:supremecourt,bombay fromdate:1-1-2020 todate:31-12-2023
```

  Dates are normalised to IK's `D-M-YYYY`. The scope *replaces* the env
  default; an explicit `doctypes=` argument still wins (unused by the
  pipeline since the forum re-run was removed).
- The run log line confirms what applied:
  `[run] session … courts=supremecourt,bombay dates=fromdate:1-1-2020 …`
  (or `courts=default dates=all`).

### Deterministic post-fetch guard

IK's `doctypes:` filter runs server-side, but the pipeline **also** enforces
the selection on everything IK returns: `tools.scope_allows_court(docsource)`
drops any candidate whose court line is outside the ticked courts *before*
it is billed for full-text, verified, or surfaced
(`[scope] dropped N candidate(s) outside the selected courts`).

- HC tokens must match their state **and** contain "High Court"
  (`Bombay City Civil Court` never satisfies `bombay`).
- Bench-variant tokens are mapped by hand: `jaipur`/`jodhpur` → Rajasthan,
  `kolkata_app` → Calcutta, `delhiorders` → Delhi, `patna_orders` → Patna,
  `amravati` → Andhra, `srinagar` → J&K.
- Tokens with no docsource pattern (tribunals, aggregates) are permissive
  for non-court forums, so a tribunal pick is never eaten by the guard.

### What was removed (cost)

- **Forum/nationwide re-run** — the pipeline used to re-send anchor queries
  restricted to the case's HC to protect own-court recall in nationwide
  searches. Deleted entirely; own-HC ranking (results sort) is unchanged.
- **Contra + axis-term fetch calls** — contra queries and single-term axis
  queries no longer hit IK (~14 hidden calls/issue). Axis terms still score,
  pinpoint, and drive the statutory-shelf gate **lexically**.
- **Automatic reformulation retry** — an empty issue returns honestly;
  re-running (next page) or editing queries is the user's call.

**Result: total IK search calls == total displayed queries.** 50 queries on
the cards = 50 × ₹0.50 = ₹25.00, exactly.

Two edge rules in `_process_issue` / `fanout_and_fetch`:

- a keyword set with **no anchor queries** (degraded generation, legacy
  session) falls back to fetching its axis terms — an issue never silently
  fetches nothing;
- a **curated empty selection** (user unticked every query) fetches nothing.

---

## 2. Page-wise fetching

### Semantics

IK's `pagenum` is **0-based** (`pagenum = wanted page − 1`); every `/search/`
call is pinned with `maxpages=1`, so one call = one billed page (₹0.50) of
10 results. Direct page jumps cost nothing extra.

| Action | pagenum sent |
|---|---|
| First run of a query (for that issue) | `0` |
| Second run, same query, same issue | `1` |
| Third run | `2` … |
| Query changed (edited / courts changed / dates changed) | `0` — a new wire string is a new search |

### The ledger

Stored on the session as `ikQueryPages`, keyed **per issue, per wire query**:

```jsonc
"ikQueryPages": {
  "3": { "\"civil dispute\" quash doctypes:supremecourt,bombay": 1 },
  "7": { }
}
```

- Implementation: `page = ledger.get(wire, -1) + 1` in
  `tools.fanout_and_fetch`; `agents.issue_fanout` hands each issue its own
  sub-ledger; `run_issue_search` loads/persists the nested map.
- **Per-issue independence**: if Issue 3 used query Q at page 1 and Issue 7
  later uses the same Q for the first time, Issue 7 starts at page 1
  (`pagenum 0`) — and since that page was already bought, it is served from
  cache at ₹0. Each issue advances only pages it has itself consumed.

### Caching

| Item | TTL | Key includes |
|---|---|---|
| Search page | 1 day | normalised wire query + pagenum |
| Judgment text / raw doc | 7 days | doc id |
| Doc metadata | 7 days | doc id |

The cache is in-memory unless Redis is configured — **a service restart
clears it**, and the next identical call re-bills.

---

## 3. Advanced Search popup

Opened from the **Advanced Search** button beside the *My cases / Upload
document* tabs. Fully separate from the research pipeline: no agents, no
verifier, no bands — results exactly as IK ranks them, 10 per page. Mirrors
IK's own `/advsearch` form (same fields, same doctype tokens).

### Three pages inside the popup

1. **Criteria** — Document/Title/Citation keywords, Title Only, Citation
   Number, Author/Judge, Court/Bench; sort (Relevance / Most Recent / Least
   Recent); date range; the full Document Types checklist (Laws, Supreme
   Court, High Courts, District Courts, Tribunals, Others). Every field
   optional; at least one criterion required.
2. **Results** — a left rail like IK's sidebar (Sort, Date Range,
   Courts & Documents with per-group Check all). **Rail changes re-run the
   search automatically from page 1, debounced 700 ms**, so ticking several
   courts sends one request. Previous/Next paginate via `pagenum`;
   pagination always re-runs the criteria **as submitted**, not as currently
   edited. The exact `formInput` sent is shown above the results.
3. **Document view** — clicking a result title opens the judgment **in-app**,
   rendered like IK's own doc page: `[Cites N, Cited by M]`, court, title,
   bench/author, then IK's own HTML (sanitised with DOMPurify; relative IK
   links rewritten to absolute indiankanoon.org). *Cases cited* and *Cited
   by* lists open in-app too; a small ↗ icon links to the original page.

### Endpoints

**`POST /api/v1/advanced-search`**

```jsonc
// request — all optional, ≥1 criterion or 422
{ "query": "", "title": "", "cite": "", "author": "", "bench": "",
  "doctypes": "supremecourt,bombay", "fromdate": "", "todate": "",
  "sortby": "relevance|mostrecent|leastrecent", "pagenum": 0 }

// response
{ "formInput": "…the exact IK query sent…",
  "pagenum": 0, "found": "1 - 10 of 2341", "total": 2341, "hasMore": true,
  "results": [ { "docId", "title", "headline", "court", "date",
                 "numCitedby", "url" } ],
  "cost": { "billedSearches": 1, "cachedHits": 0,
            "ratePerSearchInr": 0.5, "totalInr": 0.5 } }
```

Filled criteria are combined into ONE `formInput` using IK's inline
directives (`title:`, `cite:`, `author:`, `bench:`, `doctypes:`,
`fromdate:`, `todate:`, `sortby:`) — the same format IK's own form emits,
which keeps keyword-less searches (bench + dates alone) valid. IK failure →
502 naming token-rejected vs unreachable.

**`GET /api/v1/advanced-search/doc/{docId}`**

Returns `title, court, publishdate, author, bench, citesCount,
citedByCount, casesCited[], citedBy[], html, url, cost`. `html` is IK's own
judgment HTML (client sanitises before rendering). Bench/author are often
empty for SC daily orders — the masthead lines are presence-conditional.

### Costs

| Action | IK calls | ₹ |
|---|---|---|
| One page of results | 1 search | 0.50 |
| Open a judgment in-app | 1 doc + 1 docmeta | 0.22 (then free 7 days) |

Both consoles show the bill: the service prints the standard `[cost]` table
per request, the browser logs the same breakdown (`console.info`).

---

## 3a. The ES legal engine (paragraph-level, primary search)

Since 2026-08-20 the library is searched by a paragraph-aware legal engine —
ES is the PRIMARY search, Indian Kanoon strictly the fallback for zero-hit
queries.

**Two indices** (auto-created on connect):
- `ik_judgments` — one document per judgment, exactly as IK served it.
- `ik_judgment_paragraphs` — the same judgments split into legal chunks
  (`judgment_id`, `paragraph_no`, `text` + `text.english`, and regex-only
  metadata: `sections`, `acts`, `citations`; `paragraph_type`/`case_number`
  stay empty rather than invented). Backfill: `python reindex_paragraphs.py`
  (idempotent — deterministic ids, create-only).

**Two-step search** (`tools.es_legal_search`):
1. **Qualify** at judgment level — STRICT mode: every quoted phrase /
   citation is a `bool.must match_phrase` (all must be present — never OR);
   FLEXIBLE mode: BM25 with phrase boosts and `minimum_should_match` for
   natural-language queries. Court/date filters apply here.
2. **Evidence + re-rank** at paragraph level — named phrase queries reveal
   which paragraphs matched which phrases; the judgment score combines
   (weights in `ES_RANK_WEIGHTS_JSON`, defaults in config):
   `bm25 0.40 + proximity 0.30 + coverage 0.15 + section 0.10 + para_type
   0.05`. Proximity = 1/(1 + smallest paragraph span covering all phrases)
   — three phrases in one paragraph beat the same phrases scattered across
   a 200-page judgment.

**Query parser** (`parse_legal_query`): quoted phrases → required phrases;
citations like `(2019) 4 SCC 123` and bare `Section 482` references are
recognised and treated as phrases; remaining words are BM25 terms.

**Funnel** (`ES_CANDIDATE_LIMIT=30` → rank → `FINAL_RESULT_LIMIT=10` →
Gemini verification). `ES_MIN_SCORE` (default 0) is the usability threshold
for the IK fallback decision — 4 good ES results are USED, never topped up
from IK just because they're fewer than 10.

**Wired into**: the pipeline's library-first fan-out (`es_wire_search` now
runs strict engine searches) and `/api/v1/local-search` (keyword queries →
engine with `searchMode: auto|strict|flexible`; field criteria
title:/cite:/author:/bench: keep the field-level path). Explainability
(`esScore`, `finalScore`, `matchedPhrases`, `matchedParagraphs`) rides on
local-search results and session `candidateMeta.esMeta` — internal only.

---

## 4. Cost visibility & per-user usage ledger

- **Per run**: `[cost] COMPLETE COST — THIS SEARCH RUN — session …` shows
  only that click's spend, followed by one line
  `SESSION TOTAL so far (analyze + every run + reports): ₹X`.
- **Per report view**: the END-TO-END session table (by design).
- **Per advanced search / doc view**: their own tables.
- **`citation_usage_events`** (admin DB): every tracker owner flushes
  aggregate usage rows — stages `analyze`, `search_run`, `report_view`,
  `advanced_search`, `advanced_search_doc`; `source='engine'`. The engine
  sets usage columns + `producer_cost_inr` only; the DB pricing trigger owns
  `cost_inr`. Identity comes from the verified JWT via
  `set_usage_identity(user_id, case_id)` at every API entry. Query
  `v_citation_usage_events`, not the raw table.

---

## 5. File map & tests

| Area | Files |
|---|---|
| Query building, scopes, guard, page ledger, fan-out | `tools.py` |
| Run wiring, scope resolution, advanced-search endpoints | `api.py` |
| Per-issue pipeline, page ledger threading, cost flush | `agents.py` |
| Request models (`CourtScope`, `AdvancedSearchRequest`, dates) | `schemas.py` |
| Usage-event insert | `stores.py` |
| Popup UI (3 pages) | `frontend/src/components/CitationResearch/AdvancedSearchModal.jsx` |
| Court/date boxes, run payload | `frontend/src/components/CitationResearch/CitationResearchPanel.jsx` |
| Shared IK doctype catalogue | `frontend/src/components/CitationResearch/ikDoctypes.js` |
| API client | `frontend/src/services/judgementApi.js` |

Test coverage (`python -m pytest -q`, 106 passing): `test_court_scope.py`
(scope override, post-fetch guard incl. the SC+Bombay leak case, bench
variants, date composition, once-per-query, page advancement),
`test_issue_retry.py` (single-round policy, curated-empty, per-issue
ledger), `test_query_overrides.py` (display-queries-only fan-out),
`test_ik_client.py` (fallback fetch, dedupe/cap).
