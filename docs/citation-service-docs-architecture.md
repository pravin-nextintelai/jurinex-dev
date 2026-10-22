# Architecture

> How the Citation Service is built, what talks to what, and *why*. Written for an
> engineer new to the code. For the step-by-step journey see [data-flow.md](data-flow.md);
> for "which file does X" see [code-map.md](code-map.md).

The layers and the orchestrator's real imports below were cross-checked against the
live code index (jcodemunch MCP).

---

## 1. The system and its neighbours

The service is one box. It needs three things from the outside: a judgment library
(Indian Kanoon), an AI brain (Gemini), and a database (PostgreSQL). The React app
starts a run and polls for the report.

```text
   ┌────────────────────────┐
   │     React frontend     │
   └────────────────────────┘
              │  start a run / poll for the report
              ▼
   ┌──────────────────────────────────────┐
   │ CITATION SERVICE  (this repo)        │
   │                                      │   ──►  Indian Kanoon API   (search + fetch judgments)
   │ reads the case with AI,              │
   │ searches the judgment library,       │   ──►  Gemini AI           (read case / judge / memos)
   │ and returns a sorted report          │
   │                                      │   ──►  PostgreSQL          (save run / report / cost)
   └──────────────────────────────────────┘
              │  citation report
              ▼
   Recommended   ·   Adverse   ·   Caution
```

*If Indian Kanoon or Gemini is down, the run degrades or fails gracefully (see §6).*

---

## 2. The layers (how the code is organized)

The code is split into six layers. Each layer only talks to the one below it. This is
the most important picture in the repo.

```text
┌────────────────────────────────────────────────────────────────────┐
│ (1) ENTRY / API      main.py · pipeline/__init__.py                │
├────────────────────────────────────────────────────────────────────┤
│ (2) ORCHESTRATOR     pipeline/orchestrator.py                      │
├────────────────────────────────────────────────────────────────────┤
│ (3) STAGES           pipeline/stages/*.py   (16 small stations)    │
├────────────────────────────────────────────────────────────────────┤
│ (4) SERVICES         services/*.py   (the real logic — edit here)  │
├────────────────────────────────────────────────────────────────────┤
│ (5) INTEGRATIONS     indian_kanoon · gemini · document loader      │
├────────────────────────────────────────────────────────────────────┤
│ (6) FOUNDATIONS      core · models · repositories · db             │
└────────────────────────────────────────────────────────────────────┘
   each layer talks only to the layer below it
```

What each layer is for:

| # | Layer | Its one job | Key files |
| - | ----- | ----------- | --------- |
| 1 | **Entry / API** | Receive the HTTP request; hand it to the pipeline in the background | `main.py`, `pipeline/__init__.py` |
| 2 | **Orchestrator** | Run the stages **in order**; time each; catch errors; build the result | `pipeline/orchestrator.py` |
| 3 | **Stages** | Each is a tiny coordinator for one step: read the shared tray, call a service, write the result back | `pipeline/stages/*.py` |
| 4 | **Services** | The actual brains: build queries, score, decide who won, rerank, gate relevance. **Change behaviour here** | `services/*.py` |
| 5 | **Integrations** | The only code allowed to call the outside world | `integrations/*` |
| 6 | **Foundations** | Shared building blocks: settings, the cost budget, data shapes, the database | `core/`, `models/`, `repositories/`, `db/` |

**Rule of thumb:** a *stage* is "what happens and when"; a *service* is "how it
actually works". To change *what the engine does*, edit a service.

---

## 3. The pipeline pattern (the heart of it)

One shared object travels through every stage: the **`PipelineContext`**
(`pipeline/pipeline_context.py`). Think of it as a tray on the assembly line — each
station puts its result on the tray and passes it along.

The orchestrator runs each stage through a small wrapper, `_stage(...)`, which does
three boring-but-vital things every time:

1. start a log span,
2. time the stage,
3. count items in and out.

That is why the logs read like one line per station:

```text
[PIPELINE abc123] retrieve_candidates  in=0  out=80  (2.10s)
```

The tray also carries the **`BudgetTracker`** (`core/budgets.py`) — a running tally of
paid calls and money spent. Every expensive call (an Indian Kanoon search, a Gemini
call) must "ask" the budget first. If a cap is hit, the budget raises an error and
that one call is skipped. **This is the safety belt** that stops a run from spending
without limit.

---

## 4. The funnel (why it narrows)

Cheap, broad filters run first; expensive, smart filters run last and only on
survivors. Real numbers from one run:

```text
   ~30 search queries built ............ free
        │
        ▼
   ≤14 searches actually run ........... $  (₹0.50 each)
        │
        ▼
   80 raw candidates found
        │
        ▼
   70 left after removing duplicates ... free
        │
        ▼
   cheap text + metadata filters ....... free
        │
        ▼
   ~7 shortlisted  →  fetch full text .. $  (₹0.20 each)
        │
        ▼
   AI judges the 7 .................... $  (Gemini)
        │
        ▼
   3 Recommended  ·  1 Adverse  ·  3 Caution
```

*Money is spent only at the narrow end. The wide end uses free checks to throw away
the obviously-irrelevant first.*

---

## 5. Key design decisions

The choices that explain the code (the *why* matters more than the *what*):

- **Indian Kanoon is the only source of candidates (V2).** Every recommended judgment
  comes from a live Indian Kanoon search — no hidden local corpus. *Why:* one trusted,
  citable source; no stale data.

- **The shared-tray pipeline.** Stages are tiny and ordered; all state lives on one
  `PipelineContext`. *Why:* easy to read, test, reorder, and log uniformly.

- **A hard budget belt.** Paid calls are capped per type, plus a total-cost ceiling.
  *Why:* a runaway run can't drain the API quota.

- **Outcome beats reasoning ("disposition as truth").** A judgment that *discusses*
  helpful law but ultimately *dismisses* the petition is **adverse**, not supporting.
  A dedicated step reads the operative order and can overrule the AI judge. *Why:*
  who-actually-won is ground truth.

- **The relevance gate keeps "Recommended" clean.** After the AI writes its memos it
  also gives an honest verdict; off-topic cases are dropped and *adverse-to-client*
  cases are moved to the Adverse bucket instead of shown as recommended. *Why:* an
  irrelevant citation in "Recommended" is worse than none.

- **Perspective auto-correct.** If the form says "respondent" but the document is
  clearly a petitioner's writ, a conservative check corrects it. *Why:* the wrong side
  flips every supporting/adverse label.

- **Real judgment phrases, not doctrine labels.** Queries use words courts actually
  write (`"substantial compliance"`), never bracketed labels
  (`"Article 14 arbitrariness (Tata Cellular line)"`), which return zero hits. *Why:*
  the search matches verbatim text only.

---

## 6. Failure modes & limits

| If this happens | What the service does |
| --- | --- |
| Indian Kanoon returns 0 results | Report says "no candidates retrieved"; run still completes |
| Gemini is down / over budget | Falls back to deterministic logic (lexical scoring, regex disposition); memos + relevance gate become no-ops; the run still finishes |
| Only the cover page was extracted | Detected early; the run fails fast with `DOCUMENT_CONTEXT_MISSING` instead of searching party names |
| A budget cap is hit mid-run | That single call is skipped and logged; the run continues with what it has |
| PostgreSQL is down | The HTTP run can't persist (the pipeline logic itself is DB-independent) |

**Known limits today (~80–83%).** Under a heavy 3-issue load the budget fills with
high-priority doctrine queries, so Supreme-Court-targeted and some fallback lanes can
be skipped (doctrine queries still reach SC judgments via the all-courts search).
Adverse recall depends on the AI generating good "opponent" phrases. These are tuning
knobs in `core/config.py` / `.env`, not structural problems.
