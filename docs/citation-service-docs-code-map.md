# Code Map — "where does X live?"

> A lookup from a **concept** to the **exact file**, plus one line on where it sits in
> the [architecture](architecture.md). Use it when you know *what* you want to change
> but not *where*. Layer numbers (1)–(6) match
> [architecture.md §2](architecture.md#2-the-layers-how-the-code-is-organized).

---

## Worked example: "the rerank of search results"

You asked: *for rerank, which file — and where does it stand?*

- **File:** `services/rerank_service.py` → `rerank(candidates, issues_by_id, perspective)`
- **Layer:** (4) Services.
- **Called by:** the `classify_results` stage, right after the candidates are split
  into the three buckets.
- **Where it stands:** station 14, near the end — *after* the AI judge labels each
  case, *before* the report is built. It does **not** pick which cases appear; it only
  sets the **order inside each bucket** so the strongest citation shows first.
- **How it works:** pure arithmetic, no AI — recency, court level, doctrine match,
  outcome alignment, and citation count. Highest score floats to the top.

```text
  13. AI judge  ─ labels each case (supporting / adverse / ...)
        │
        ▼
  14. classify  ─ split into 3 buckets
        │
        ▼
  rerank_service.py  ─ order each bucket, best first (no AI)
        │
        ▼
  16. build report
```

---

## The pipeline stations → files

(Order the orchestrator runs them; full prose in [data-flow.md](data-flow.md).)

| Station | Stage file (`pipeline/stages/`) | Main logic it calls |
| --- | --- | --- |
| Fix perspective | `normalize_perspective.py` | `services/perspective_service.py` |
| Case profile | `extract_case_profile.py` | `services/issue_service.py` |
| Find legal issues | `extract_issues.py` | `integrations/gemini/issue_extractor.py` |
| Build search queries | `generate_queries.py` | `services/query_service.py` |
| Search Indian Kanoon | `retrieve_candidates.py` | `integrations/indian_kanoon/client.py` + `services/exclusion_service.py` |
| De-duplicate | `deduplicate_candidates.py` | — |
| Cheap text filter | `cheap_filter.py` | `utils/text.py` |
| Cheap metadata prescreen | `cheap_prescreen.py` | `services/query_service.py` |
| Fetch excerpt + meta | `enrich_fragments.py` | `integrations/indian_kanoon/client.py` |
| Score candidates | `score_candidates.py` | `services/scoring_service.py`, `semantic_service.py`, `direction_service.py` |
| Shortlist | `shortlist_candidates.py` | — |
| Fetch full text | `fetch_full_documents.py` | `integrations/indian_kanoon/client.py` |
| Who won | `detect_disposition.py` | `services/disposition_service.py` |
| AI judge | `final_ai_judge.py` | `integrations/gemini/evaluator.py` |
| Classify + rerank | `classify_results.py` | `services/classification_service.py`, **`rerank_service.py`**, `opposition_service.py` |
| Memos + relevance gate | `generate_usage_analysis.py` | `services/analysis_service.py` |
| Build report | `build_report.py` | `services/report_service.py` |

---

## The brains: `services/` — layer (4)

This is where you change behaviour. One file = one job.

| Concept | File | What it does |
| --- | --- | --- |
| Build search queries | `services/query_service.py` | Issues → Indian Kanoon queries; doctrine labels → real phrases; tiers + landmarks |
| Heuristic issues (fallback) | `services/issue_service.py` | Case profile; extracts issues from text if the AI is unavailable |
| Fix the represented side | `services/perspective_service.py` | "respondent" → "petitioner" when the doc is clearly a petitioner's writ |
| Remove your own uploads | `services/exclusion_service.py` | Stops the engine from "citing" the document you uploaded |
| Score relevance & favour | `services/scoring_service.py` | How relevant, and which side it helps |
| AI similarity | `services/semantic_service.py` | Gemini embeddings: case-vs-judgment closeness |
| Direction of a principle | `services/direction_service.py` | Penalises a case if a directed principle points at the wrong party |
| Who actually won | `services/disposition_service.py` | Reads the operative order; maps outcome × your side → label |
| Split into buckets | `services/classification_service.py` | Separates Recommended / Adverse / Caution |
| **Order within buckets** | **`services/rerank_service.py`** | Sorts each bucket, strongest first (no AI) |
| Counter-argument hints | `services/opposition_service.py` | For adverse cases, "how to distinguish it" |
| Usage memos + relevance gate | `services/analysis_service.py` | ~500-word "how to use" memo + RELEVANT/ADVERSE/NOT_RELEVANT verdict |
| Assemble the report | `services/report_service.py` | Candidates → final JSON the frontend renders |
| Record paid calls | `services/cost_service.py` | Logs each Indian Kanoon call for the cost breakdown |
| Raw Indian Kanoon API | `services/indian_kanoon.py` | Low-level `ik_search` / `ik_fetch_*` HTTP calls |

---

## The outside world: `integrations/` — layer (5)

| Concept | File | What it does |
| --- | --- | --- |
| Indian Kanoon client | `integrations/indian_kanoon/client.py` | `IndianKanoonClient`: `search`, `fetch_fragment`, `fetch_meta`, `fetch_full_document` — the only code that talks to the library; charges the budget |
| Gemini connection | `integrations/gemini/client.py` | Builds the Gemini client from the API key |
| AI issue extractor | `integrations/gemini/issue_extractor.py` | The AI call that reads the case and returns issues |
| AI judge | `integrations/gemini/evaluator.py` | The AI call that labels the shortlisted cases |
| **All prompts** | `integrations/gemini/prompts.py` | Every instruction sent to Gemini. Edit prompts here |
| Lenient JSON | `integrations/gemini/_jsonsafe.py` | Parses AI output even when slightly malformed |
| Read the upload | `integrations/document_service/context_loader.py` | Turns the uploaded payload into text; finds your own doc ids/titles |

---

## Foundations: `core/`, `models/` — layer (6)

| Concept | File | What it does |
| --- | --- | --- |
| **All settings & toggles** | `core/config.py` | Every cap and feature flag (from `.env`). First file to read for "what can I tune?" |
| The cost safety belt | `core/budgets.py` | `BudgetTracker` — caps paid calls and total spend per run |
| Labels & enums | `core/enums.py` | `Classification`, `Authority`, `Disposition`, `WinningParty`, `CitationStatus` |
| Word lists | `core/constants.py` | Supported perspectives, aliases, stop words |
| Logging + stage spans | `core/logging.py` | The `[PIPELINE ...]` one-line-per-stage logs |
| One judgment (data shape) | `models/citation_models.py` | `Candidate` — scores, label, disposition, memo |
| One legal issue | `models/issue_models.py` | `IssueCard` — question, phrases, doctrines, landmarks |
| Case profile / result | `models/run_models.py` | `CaseProfile`, `PipelineResult` |

---

## Persistence & utilities

| Concept | File | What it does |
| --- | --- | --- |
| Database + embeddings + judgment cache | `db/client.py` | PostgreSQL; Gemini embedding batches; the Indian Kanoon asset cache |
| Save the run | `repositories/run_repository.py` | `ensure_run`, `complete_run`, `fail_run` |
| Save the report | `repositories/report_repository.py` | `save_report` |
| Cost summary | `repositories/cost_repository.py` | `summarize_cost` |
| Cost tracking | `utils/usage_tracker.py` | `record_gemini`, `record_ik` — feeds the cost UI |
| Text helpers | `utils/text.py` | `overlap_score`, `terms`, `strip_html` |
| Prices | `utils/pricing.py` | `IK_SEARCH_INR`, `IK_FRAGMENT_INR`, … |

---

## Entry & orchestration: layers (1)–(2)

| Concept | File | What it does |
| --- | --- | --- |
| HTTP routes | `main.py` | FastAPI app; starts a run in the background and a route to poll for the report |
| Pipeline dispatcher | `pipeline/__init__.py` | `run_pipeline(...)` — picks V2 and forwards to the orchestrator |
| The conductor | `pipeline/orchestrator.py` | `run_v2_pipeline(...)` — runs every stage in order, times them, builds the result |
| The shared tray | `pipeline/pipeline_context.py` | `PipelineContext` — the object every stage reads and writes |

---

## "I want to change X" → go here

| I want to… | Edit |
| --- | --- |
| Change which judgments are searched | `services/query_service.py` (+ prompt in `integrations/gemini/prompts.py`) |
| Change how the report is ordered | `services/rerank_service.py` |
| Change who lands in which bucket | `services/classification_service.py`, `services/disposition_service.py`, the gate in `pipeline/stages/generate_usage_analysis.py` |
| Change the "how to use" memo wording | `integrations/gemini/prompts.py` (`usage_analysis_prompt`) + `services/analysis_service.py` |
| Raise/lower a cost cap or toggle a feature | `core/config.py` + `.env` |
| Fix wrong petitioner/respondent detection | `services/perspective_service.py` |
| Change the final report shape | `services/report_service.py` |

---

## Tests

Unit tests are in `tests/unit/`. Most relevant here:

```text
test_pipeline_v2.py            end-to-end contract
test_query_builder_v2.py       query building
test_query_doctrine_phrases.py doctrine label → real phrase
test_disposition_service.py    who-won detection
test_direction_service.py      directed-principle penalty
test_exclusion_service.py      remove your own uploads
test_perspective_service.py    petitioner/respondent fix
test_cheap_filter_priority.py  cheap filter keeps doctrine hits
test_usage_analysis_gate.py    relevance gate + adverse routing
```

Run them: `venv/bin/python -m pytest tests/unit/ -q`
