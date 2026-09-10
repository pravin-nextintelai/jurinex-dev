# Jurinex Judgement Service — Architecture & Prompt Documentation

> Library layer (Indian Kanoon → Elasticsearch → free reuse on later runs): see [LIBRARY_ARCHITECTURE.md](LIBRARY_ARCHITECTURE.md).

FastAPI service on **port 8005**. Finds verified-relevant Indian judgments per legal
issue of a lawyer's case, from Indian Kanoon (official paid API), with support/contra
separation, verified outcomes, and adversarial prep. Frontend: sidebar → Citation
Research (`frontend/src/components/CitationResearch/`).

**Models:** Claude Opus 4.8 (issue spotting + query generation, `claude_llm.py`),
Gemini 2.5 Flash (verification, citation analysis, doc classify/extract),
gemini-embedding-001 (semantic rerank), Gemini + Google Search grounding (good-law
web check). Every Claude stage silently falls back to a Gemini agent when
unavailable.

## Pipeline flow

```
case text / upload / stored case
      │
      ▼
[0] Document context  (Gemini: classify → extract; deterministic anti-invention guard)
      │
      ▼
[1] Issue spotting    (Claude, ISSUE_SPOTTER_SYSTEM)  → 3–5 titled issues + stage + forum
      │
      ▼
[2] Query generation  (Claude, QUERY_GEN_SYSTEM)      → 4 support anchors + 1–2 contra + 4 axes
      │                                                  (shown on issue cards, reused at search)
      ▼   user picks issues → /search/{sid}/run
[3] IK fetch          (build_ik_query + fanout)       → candidate pool ≤30 per issue
      ▼
[4] Embedding rerank  (issue text vs title+headline)  → top 12 get full text (/doc)
      ▼
[5] Verification      (Gemini flash, JUDGMENT_VERIFIER_SYSTEM — one call PER judgment)
      ▼
[6] Deterministic gates (enforce_verifier_rules + CitationGuardian — pure code, no bypass)
      ▼
[7] Score / band / surface  → ONLY verified-relevant results, support first, bench-wise
      │        └── issue empty? → reformulate queries once → one fresh round [3–7]
      ▼
Report view: grounded analysis + bench + clickable cited/cited-by + good-law web check
```

## Stage details (short)

**[0] Document context** — `analyze_case()`. Input from raw text, uploaded PDF/DOCX
(pypdf/docx, Document AI OCR fallback), or a stored case (agentic-document-service +
`file_chunks` page refs). Gemini classifies the document type and extracts
parties/facts/history/relief. `verify_context_against_source()` then excises any
section number or statute name not present in the source (anti-invention), and
rule-based completeness checks ask a clarification question instead of guessing.

**[1] Issue spotting** — `spot_issues()`, Claude structured output → `IssueSpotResult`.
Identifies the procedural stage FIRST (quashing/bail/leave-to-defend/…) and the forum
(which High Court), then 3–5 issues framed at that stage's standard of review. Each
issue: standardized `title` ("Civil Dispute Given Criminal Colour"), a self-contained
"Whether …?" question naming the provision, a 2–3 sentence fact-tied `explanation`,
`doctrine`, `statutory_hook`, `perspective`. Rule 2a: annexed judgments/earlier writs
are background — never an issue subject (prior rounds become "Bar of Res Judicata",
never "Effect of W.P. No. X"). Issue source refs ("file, page N") are attributed by
lexical overlap in code, never LLM-written.

**[2] Query generation** — `generate_queries()`, Claude → `KeywordSet`. Built from
doctrine + statutory hook + stage, NEVER from party facts. Produces:
- `anchor_queries` (exactly 4, support): each around ONE full quoted phrase-of-art,
  e.g. `"civil dispute given criminal colour" quash`, `"commercial transaction" "420" quash`;
- `contra_queries` (1–2): same doctrine with opposite outcome words ("dismissed",
  "refused") — counsel must know the adverse line;
- four lexical axes (doctrinal/statutory/factual/outcome, 12–16 terms) for scoring.
New-code mapping is mandatory (S.528 BNSS ↔ S.482 CrPC, S.85 BNS ↔ S.498A IPC — most
precedent predates 2023). Sibling issue titles ride along so no two issues share
boilerplate queries. Runs at ANALYZE time (shown under each issue card) and is
reused at search — never billed twice.

**[3] Indian Kanoon fetch** — `IndianKanoonClient.fanout_and_fetch()`. Every query is
decorated by `build_ik_query()`: doctrinal/outcome phrases exact-quoted, and a
`doctypes:supremecourt,highcourts,tribunals` filter appended (statute pages and
district-court noise never enter the pool). Anchors search first with 2× hit weight
and a deeper take; results unioned, deduped by docId, capped at 30. Searches cached
24h, documents 7 days. IK gotchas encoded: `/doc` returns citations only with
`maxcites`/`maxcitedby` params, and modern keys are `cites`/`citedby`.

**[4] Semantic rerank** — `rerank()`. Gemini embeddings (768-dim, Qdrant cache) of
the issue text vs each candidate's title+headline; per-issue only (cross-issue
precedents never compete). Top 12 by similarity get full judgment text.

**[5] Verification (the relevance core)** — `verify_judgments()`: ONE grounded call
per fetched judgment (concurrency 6, ~22k chars with the tail kept — the operative
order lives there). `JUDGMENT_VERIFIER_SYSTEM` checks, in order:
1. OUTCOME (KILL): classify relief_granted/refused/partly/interim_only/unclear from
   the FINAL paragraphs only; copy the operative line VERBATIM as evidence.
2. SHELF (KILL): doctrine + statute must match BY NAME in the judgment's own text;
   transactional vocabulary (deposit/interest/withdrawal) across different fields of
   law = reject.
3. STAGE: same procedural stage, else downgrade.
4. RATIO: locate the principle paragraph (`ratio_para`) or cap score at 30.
5. SIDE: from the VERIFIED outcome vs the issue's perspective — never from the query
   that found the case.
6. DISTINGUISH RISK: the fact the opponent will use to distinguish.
7. ADVERSARIAL PREP: strongest objection (bindingness rules: SC binds all — Art. 141;
   own HC binding, DB > SJ; other HC persuasive) + how to counter it.
Scoring rubric: doctrine 40 + stage 20 + ratio 20 + forum/recency 20.

**[6] Deterministic gates (pure code — models never stand unchecked)**
- `verify_outcome_evidence`: the quoted operative line must be a substring of the
  fetched text, else the outcome is unproven → reject.
- Statutory shelf gate: `statutory_shelf_patterns` builds "section 138"/"order 37"/
  "order xxxvii" anchors (roman↔arabic) from the hook + statutory axis; a judgment
  whose FULL TEXT contains none of them is rejected whatever the model scored
  (kills the stamp-duty-for-Order-37 class of false positive).
- Empty doctrine_link → reject; missing ratio → score ≤ 30.
- Side re-derived in code from verified outcome + perspective (respondent inverts).
- `judged_band`: verifier score <40 → RED; unverified docs cap at YELLOW.
- `CitationGuardian` (always on, no bypass): every surfaced docId must have been
  fetched from IK in THIS request; every pinpoint must be a substring of that text.

**[7] Score / band / surface** — semantic signal = 0.45×embedding + 0.55×(verifier
score/100); composite adds keyword signal (phase weights in config). Bands:
GREEN ≥ 0.70, YELLOW ≥ 0.62 (env-calibrated). ONLY verified GREEN/YELLOW results are
shown — no similarity-only filler, honest empty over junk. Order: support → neutral →
interim → contra, then bench-wise (SC → HC → tribunal → district), then score;
overruled red-flags sink last. Each result carries: side badge, verifier %, verbatim
outcome evidence, doctrine link, distinguish risk, opponent argument + counter
strategy, matched queries, chips.

**Retry** — if an issue ends with zero usable judgments, `generate_queries` is called
once more with the full failed-query list ("broaden doctrine, alternate citation
forms, fewer quotes, no repeats") and one fresh round runs, excluding every
already-fetched docId. Still empty → honest empty.

**Report view** (`GET /search/{sid}/report/{issueId}/{docId}`) — grounded Gemini
analysis (why-helps / issues / facts / analysis / ratio; judgment text only), bench
from /docmeta with deterministic coram extraction fallback (HON'BLE JUSTICE headers,
"X, J." lines, SC signature blocks), clickable cases-cited/cited-by (docId links),
deterministic semanticMatch + factualRelevance, and the **good-law web check**:
Gemini + Google Search grounding classifies overruled/reversed/stayed/slp_pending/
good_law/unknown with a note + source links — cached per session, always labelled
"verify on the official court website before filing".

## Prompt inventory

| Prompt | Model | Location | One-liner |
|---|---|---|---|
| ISSUE_SPOTTER_SYSTEM | Claude Opus | `claude_llm.py` | Stage-first issue spotting; titled, self-contained, grounded; present-case-only rule 2a |
| QUERY_GEN_SYSTEM | Claude Opus | `claude_llm.py` | 4 quoted-phrase support anchors + contra queries + axes; IK syntax; BNS↔IPC mapping |
| JUDGMENT_VERIFIER_SYSTEM | Gemini Flash | `agents.py` | PROMPT-3: outcome/shelf KILL checks, ratio, side, adversarial prep, 0–100 rubric |
| citation_analysis | Gemini Flash | `agents.py` | Grounded per-judgment report (never adds facts/citations) |
| grounded_good_law_check | Gemini Flash + google_search | `tools.py` | Web status: overruled/SLP/stay, JSON + grounding sources |
| classify / extract | Gemini Flash | `agents.py` | Document type + structured case context, anti-invention rules |

## API surface

`POST /api/v1/analyze` · `/analyze/upload` · `/analyze/case` (two-phase: context +
issues + queries, no IK spend) → `POST /api/v1/search/{sid}/run` (chosen/custom
issues) → `GET /search/{sid}/report/{issueId}/{docId}` (+ `/status` approve/reject) ·
`POST /search/{sid}/refine` (facet/keyword/semantic reorder — never deletes;
`ik_escape` is the only re-fetch path) · `GET /api/v1/sessions` history ·
`GET /health` (shows judge/doctypes config — use to detect a stale process).

## Key env knobs (.env)

`INDIAN_KANOON_TOKEN` (live one) · `ANTHROPIC_API_KEY` + `JUDGEMENT_CLAUDE_MODEL`
(opus-4-8) + `USE_CLAUDE_FOR_ANALYSIS` · `VERIFIER_USE_CLAUDE=false` (flash verifies;
Sonnet path exists) · `IK_DOCTYPES` · `IK_CANDIDATE_CAP=30` · `IK_FULL_DOC_TOP_N=12` ·
`RELEVANCE_JUDGE_WEIGHT=0.55` · `BAND_GREEN_MIN=0.70` / `BAND_YELLOW_MIN=0.62` ·
`GOOD_LAW_WEB_CHECK=true` · `SCORING_PHASE=1`.

## Anti-hallucination ledger (what is guaranteed by code, not prompts)

1. No citation can appear that was not fetched from IK in this request (guardian).
2. No pinpoint or outcome-evidence quote that is not a verbatim substring of the
   fetched judgment.
3. No GREEN result whose text was not read and verified; verifier reject = never shown.
4. No judgment surfaces for a statutory issue unless its text mentions the issue's
   statutory anchors.
5. Support/contra decided only by the verified outcome — never by query intent.
6. Court, bench, dates, cited-by counts come from IK metadata/text, never model claims.
7. Issue "file, page N" sources attributed by lexical overlap in code.

Run: `.\venv\Scripts\python.exe -m uvicorn api:app --port 8005` · offline tests:
`python -m pytest -q` (42, no network/LLM).


