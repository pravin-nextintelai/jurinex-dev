# Data Flow — one request, end to end

> Traces a single run from "lawyer uploads a case" to "report comes back", station by
> station. Each station is one file in `pipeline/stages/`; the real work is in a
> `services/*` file it calls. Plain language; the *why* is included because that's the
> hard part to guess from the code.

---

## Contents

1. [Step by step (the simple view)](#1-step-by-step-the-simple-view)
2. [Who calls whom (sequence)](#2-who-calls-whom-sequence)
3. [The assembly line (all 16 stations)](#3-the-assembly-line-all-16-stations)
4. [Station reference table](#4-station-reference-table)
5. [Deep dives on the clever stations](#5-deep-dives-on-the-clever-stations)
6. [The data that flows (the tray)](#6-the-data-that-flows-the-tray)
7. [What you'll see in the logs](#7-what-youll-see-in-the-logs)

---

## 1. Step by step (the simple view)

The whole journey in 8 plain phases. The box is the step; the text on the right is
what it does.

```text
    Lawyer uploads a case
            │
            ▼
  ┌────────────────────────────────┐
  │ 1. Understand the case         │   fix petitioner vs respondent;
  │   read the uploaded text       │   pull relief, statutes, key facts
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 2. Find the legal issues       │   list issues + real search phrases,
  │   Gemini reads the case        │   doctrines, landmark case names
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 3. Plan the searches           │   real judgment words (not labels),
  │   build query strings          │   3+ terms, ranked by importance
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 4. Search Indian Kanoon        │   top queries always run;
  │   run the queries              │   low-priority skipped if over budget
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 5. Filter for free             │   drop the obvious misses;
  │   dedupe + court/age checks    │   remove your own uploaded doc
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 6. Read the survivors          │   only the top ~7 cost money to read
  │   excerpt, then full text      │
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 7. Judge each one              │   a dismissed petition is ADVERSE,
  │   who won + AI label           │   even if the wording sounded helpful
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 8. Sort, clean & explain       │   relevance gate: drop off-topic,
  │   3 buckets, best first        │   move adverse into the Adverse bucket
  └────────────────────────────────┘
            │
            ▼
    Report:  Recommended  ·  Adverse  ·  Caution
```

**The 8 phases map to the 16 detailed stations like this:**

```text
  Phase 1  →  stations 0-1        Phase 5  →  stations 5-7
  Phase 2  →  station  2          Phase 6  →  stations 8-11
  Phase 3  →  station  3          Phase 7  →  stations 12-13
  Phase 4  →  station  4          Phase 8  →  stations 14-16
```

---

## 2. Who calls whom (sequence)

The orchestrator is the conductor. It calls **Gemini** to understand and judge, and
**Indian Kanoon** to find and fetch. The frontend starts the run, then polls.

```text
  Frontend     ──(1) start a run (case + side)──►  API
  API          ──(2) run in background─────────►  Orchestrator
  Orchestrator ──(3) read case, get issues─────►  Gemini
  Orchestrator ──(4) run the searches──────────►  Indian Kanoon
  Orchestrator ──(5) fetch full text (top ~7)──►  Indian Kanoon
  Orchestrator ──(6) judge + write memos───────►  Gemini
  Orchestrator ──(7) finished report───────────►  API
  Frontend     ──(8) poll, then show report────►  API
```

---

## 3. The assembly line (all 16 stations)

The exact order the orchestrator runs them. `$` = costs money (Indian Kanoon or
Gemini); `free` = no cost. The number on the right is roughly how many items survive.

```text
   0   fix perspective ............ free
   1   case profile ............... free
   2   extract issues ............. $      Gemini reads the case
   3   generate queries ........... free
   4   search Indian Kanoon ....... $      ≤14 searches          →  80
   5   de-duplicate ............... free                          →  70
   6   cheap filter ............... free   (text overlap)
   7   cheap prescreen ............ free   (court / age / doctrine)
   8   enrich fragments ........... $      excerpt + metadata
   9   score candidates ........... $      embeddings + direction
  10   shortlist .................. free                          →  ~7
  11   fetch full documents ....... $      full judgment text
  12   detect disposition ......... $      who actually won
  13   final AI judge ............. $      label each one
  14   classify + rerank .......... free   3 buckets, best first
  15   usage analysis + gate ...... $      memos + clean buckets
  16   build report ............... free
```

---

## 4. Station reference table

Each station file is in `pipeline/stages/`. The "real logic" column is the
`services/*` (or `integrations/*`) file it calls.

| # | Station file | What it does (plain words) | Real logic | Cost |
| - | --- | --- | --- | --- |
| 0 | `normalize_perspective.py` + (orchestrator) | Clean the chosen side, then fix it from the document if it's clearly wrong | `services/perspective_service.py` | free |
| 1 | `extract_case_profile.py` | Quick profile: relief, statutes, key facts | `services/issue_service.py` | free |
| 2 | `extract_issues.py` | AI lists the legal issues + search phrases + doctrines + landmark cases | `integrations/gemini/issue_extractor.py` | $ |
| 3 | `generate_queries.py` | Turn issues into Indian Kanoon search strings | `services/query_service.py` | free |
| 4 | `retrieve_candidates.py` | Run the searches in priority order; remove your own uploaded docs | `integrations/indian_kanoon/client.py` + `services/exclusion_service.py` | $ |
| 5 | `deduplicate_candidates.py` | Drop the same judgment found twice | — | free |
| 6 | `cheap_filter.py` | Free text check; keep doctrine-query and multi-term hits | `utils/text.py` | free |
| 7 | `cheap_prescreen.py` | Free metadata check; always keep landmarks + adverse-looking | `services/query_service.py` | free |
| 8 | `enrich_fragments.py` | Fetch a short excerpt + metadata for a balanced set | `integrations/indian_kanoon/client.py` | $ |
| 9 | `score_candidates.py` | Score relevance + who-it-favours; penalise reversed principles | `scoring_service.py`, `semantic_service.py`, `direction_service.py` | $ |
| 10 | `shortlist_candidates.py` | Keep the top ~7 | — | free |
| 11 | `fetch_full_documents.py` | Fetch the full judgment text for the shortlist | `integrations/indian_kanoon/client.py` | $ |
| 12 | `detect_disposition.py` | Read the operative order: allowed or dismissed? who won? | `services/disposition_service.py` | $ (regex first) |
| 13 | `final_ai_judge.py` | One AI call labels each case; disposition veto re-asserts who won | `integrations/gemini/evaluator.py` | $ |
| 14 | `classify_results.py` | Split into 3 buckets, rerank, add counter-argument hints | `classification_service.py`, `rerank_service.py`, `opposition_service.py` | free |
| 15 | `generate_usage_analysis.py` | One AI call writes the memos + relevance verdict; the gate cleans buckets | `services/analysis_service.py` | $ |
| 16 | `build_report.py` | Assemble the final report | `services/report_service.py` | free |

---

## 5. Deep dives on the clever stations

### Station 3 — building good search queries

`services/query_service.py`

Indian Kanoon only matches **words that literally appear in judgments**. So this
station never sends a lawyer's label like `"Article 14 arbitrariness (Tata Cellular
line)"` (zero hits). It:

- translates doctrines into real phrases (`"arbitrary and capricious"`),
- combines 3+ terms for precision (`"substantial compliance" ANDD "experience
  certificate" ANDD tender`),
- adds landmark case-name searches (`"Maneka Gandhi"`, `"Motilal Padampat"`),
- ranks queries into tiers so the most important always run first.

### Station 12 — who actually won

`services/disposition_service.py`

A judgment can *talk about* law that helps you but still *rule against* the petition.
Citing it as "supporting" would embarrass you in court. So this station reads only the
**operative order** (the end of the judgment) — first with free regex, and only if
unsure with one cheap Gemini call — to decide ALLOWED / DISMISSED and the winner. A
confident outcome can overrule the AI judge ("disposition veto").

### Station 14 — rerank

`services/rerank_service.py`

After labelling, each bucket is an unordered list. Rerank sorts each bucket so the
**strongest citation is first**, using a simple weighted score (no AI): newer
judgments, higher courts, doctrine match, outcome alignment, and how often the case is
cited. It is the difference between "here are 3 cases" and "cite *this* one first".

### Station 15 — the relevance gate

`services/analysis_service.py` + the stage

The same AI call that writes each memo also returns an honest verdict, and the gate
acts on it:

```text
  RELEVANT            →  keep it where it is
  ADVERSE             →  move it to the Adverse bucket (don't hide it)
  PARTIALLY_RELEVANT  →  if it was in Recommended, demote to Caution
  NOT_RELEVANT        →  drop it (off-topic)
```

This is why "Recommended" stays clean and "Adverse" stops being empty.

---

## 6. The data that flows (the tray)

Two shapes carry almost everything:

- **`IssueCard`** (`models/issue_models.py`) — one legal issue: its question, search
  phrases, must-have keywords, doctrines, landmark cases, preferred courts.
- **`Candidate`** (`models/citation_models.py`) — one judgment as it travels: id,
  title, court, the query that found it, excerpt, full text, all the scores, its
  label, disposition (who won), relevance verdict, and the usage memo.

Both live on the **`PipelineContext`** (`pipeline/pipeline_context.py`) — the tray
every station reads and writes.

---

## 7. What you'll see in the logs

One line per station (printed by the orchestrator's `_stage` wrapper):

```text
[PIPELINE abc12345] retrieve_candidates     in=0  out=80  (2.10s)
[PIPELINE abc12345] generate_usage_analysis in=7  out=3   (21.1s)
[PIPELINE abc12345] FUNNEL ... issues=3 queries=30 -> raw=80 deduped=70 ... recommended=3 adverse=1 caution=3
```

Useful tags to grep:

```text
[QUERY_GEN]        the queries that were built
[QUERY_ORDER]      which searches ran vs were budget-skipped
[DISPOSITION] FLIP a label changed because of who actually won
[RELEVANCE_GATE]   buckets cleaned (dropped / moved / demoted)
[EXCLUSION]        your own uploaded doc was removed
```

Every line carries the 8-character run id, so you can follow one run end to end.
