# Jurinex Judgement Service

Agent-orchestrated Indian case-law retrieval (Google ADK + FastAPI), port **8005**.

A lawyer submits a case (document upload or typed summary). The service:

1. **Document Context Service** — ADK `SequentialAgent` (classify → extract) turns raw
   input into structured `CaseContext`, with a deterministic **anti-invention guard**
   (sections/statutes in extracted facts must exist in the source) and a completeness
   check that asks for clarification instead of guessing.
2. **Issue split** (Stage 1, Gemini, temp 0.25) — distinct legal issues, one per body of law.
3. Per issue, concurrently (**issue_fanout**): **keyword extraction** across four axes
   (doctrinal/statutory/factual/outcome) → **Indian Kanoon** fan-out fetch (union, dedupe,
   cap 22) → **segment-level re-rank** (Gemini embeddings, Qdrant cache) → precision layers
   (party perspective, authority, good-law lite) → **composite score** with explainable
   per-signal breakdown.
4. **CitationGuardian** — deterministic, non-LLM, runs on EVERY response, no bypass:
   drops any docId not fetched from Indian Kanoon in this request, and any pinpoint not
   literally present in the fetched judgment text. *We never originate a citation.*
5. **Search-within-search** — facet/keyword/semantic refinement of the cached result set
   (reorder/de-emphasise, never delete), with an explicit Indian-Kanoon escape hatch.

## Run

```powershell
cd Backend\judgement-service
.\venv\Scripts\python.exe -m uvicorn api:app --host 0.0.0.0 --port 8005
```

All credentials come from `.env` (see `.env.example`). Redis/Qdrant/Neo4j/Postgres are
optional — the service degrades gracefully when they are absent.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Status, active phase weights, store availability |
| `POST /api/v1/analyze` | `{caseInput:{text,fileRef}}` → sessionId + case context + suggested issues (no IK spend) |
| `POST /api/v1/analyze/case` | `{caseId, text?, userId?}` → analyze one of the user's stored cases: documents pulled from the agentic document service (HTTP, forwarding `Authorization` + `X-User-Id`), per-page chunks from Document_DB `file_chunks`, so issues carry deterministic `file, page N` source refs |
| `POST /api/v1/analyze/upload` | multipart PDF/DOCX + optional note → same as above |
| `POST /api/v1/search/{sessionId}/run` | `{issueIds?, customIssues?}` → precedents grouped by issue |
| `POST /api/v1/search` | one-shot: analyze + split + search (spec Section 11 contract) |
| `POST /api/v1/search/upload` | one-shot, multipart |
| `POST /api/v1/search/{sessionId}/refine` | `{issueId, mode: facet\|keyword\|semantic\|ik_escape, query}` |

The `signals` object on each result is the explainability contract — render one chip
per key; new precision layers appear as new keys, never as schema changes.

## Agent configuration from the admin console

Every LLM agent takes its **model, system prompt, temperature and generation
parameters** from `public.agent_prompts` in **Draft_DB** (`DRAFT_DB_URL`).
`model_ids` resolves through `public.llm_models` in **Document_DB**
(`DOC_DB_URL`) — id 23 is `gemini-2.5-flash`, id 27 is `gemma-4-31b-it`.

With no row for an agent, that agent keeps the prompt written in `agents.py`
and the model from `config.py`/env — the service never depends on the admin
DB being populated or reachable.

Rows are matched by **name** only (never by `agent_type`: several services
share this table and reuse types like `citation`). Each agent answers to,
in order: `judgement_<agent>_agent`, `judgement_<agent>`, `<agent>_agent`,
`<agent>`. Use a `judgement_*` name to scope a row to this service.

| agent | what it does |
|---|---|
| `doc_classify` | classifies the uploaded document |
| `context_extract` | extracts parties/facts/relief |
| `issue_split` | splits a case into legal issues |
| `keyword_extract` | builds the Indian Kanoon queries |
| `judgment_verifier` | verifies one judgment against one issue |
| `citation_analysis` | writes the per-citation report |
| `case_summary` | the 100-word advocate summary |
| `grounds_extract` | grounds pleaded in a filing |
| `fresh_extract` | proposed grounds for a fresh matter |
| `good_law_check` | web-grounded good-law status |

`GET /health/agents` lists every agent with the configuration in force
(`source: db | default`) and the names it answers to; `POST
/health/agents/reload` drops the 2-minute cache so an admin edit applies at
once.

Notes:
- `llm_parameters.temperature` wins over the `temperature` column; `seed`,
  `top_p`, `top_k`, `max_output_tokens`, `thinking_budget` and
  `thinking_level` are read from `llm_parameters` too.
- A row with an empty `prompt` configures the **model only** — the agent
  keeps its hardcoded instruction rather than losing it.
- Without a row, generation stays deterministic (temperature 0, seed 42).
  A row's temperature is used as given, so determinism becomes the admin's
  choice.
- These agents run on Google ADK, which drives Gemini/Gemma. A row naming a
  Claude/DeepSeek model is logged and the hardcoded model is kept — except
  for `judgment_verifier`, whose Claude fallback path does use a
  `claude-*` model from the row.

## Scoring phases

Weights are **config** (`SCORING_PHASE` + optional `SCORING_WEIGHTS_JSON`), not code.
Phase 1 (now): semantic 70 / keyword 30. Phase 2 adds authority/party once those layers
are trusted; Phase 3 adds good-law/fact once the Neo4j typed citation graph is live.
Good-law is a **gate**: an overruled case is capped + red-flagged regardless of score.

## Tests & evals

```powershell
.\venv\Scripts\python.exe -m pytest -q                      # offline suite (guardian adversarial, scoring, refine…)
.\venv\Scripts\python.exe -m evals.eval_citation_guardian    # offline, adversarial
.\venv\Scripts\python.exe -m evals.eval_issue_split          # live Gemini
.\venv\Scripts\python.exe -m evals.eval_keyword_extract      # live Gemini, 5 runs/fixture
.\venv\Scripts\python.exe -m evals.eval_document_context     # live Gemini
```

## Frontend

The **Citation Research** sidebar module (`/citation-research`) uses
`frontend/src/services/judgementApi.js` → `VITE_APP_JUDGEMENT_SERVICE_URL`
(defaults to `http://localhost:8005` in local dev).
