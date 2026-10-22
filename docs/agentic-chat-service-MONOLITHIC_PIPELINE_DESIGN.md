# Monolithic Drafting Pipeline — Complete System Design

**Scope**: the `drafting_strategy: "monolithic"` path of Drafting Mode in
`agentic-chat-service` (FastAPI, port 8096) + the React Drafting Mode frontend.
One user action ("Generate Draft") runs a staged, validated pipeline whose
drafting phase is a single streamed LLM call.

**Design principle** (pipeline spec): *No Source = No Fact.* The drafter never
reads raw documents; it reads a verified fact inventory. Everything that can be
guaranteed deterministically is done in Python (zero tokens); LLMs are used only
for extraction, drafting, and semantic validation.

---

## 1. High-level flow

```
        UPLOAD TIME (once per template / document set)
┌─────────────────────────────────────────────────────────────────┐
│ POST /template   → Stage 0  Template Structural Analysis (1 call)│
│ POST /documents  → files persisted (GCS), session updated        │
└─────────────────────────────────────────────────────────────────┘
        GENERATE TIME (every "Generate Draft" click) — SSE stream
┌─────────────────────────────────────────────────────────────────┐
│ Stage G1 Ingestion Check               0 calls  (fail-loud)      │
│ Stage 1  Verified Fact Extraction      1 call   (flash, cached)  │
│ Stage G2 Grounded Field Extraction     1 call/batch (schema)     │
│          + programmatic snippet validation (0 calls)             │
│ Stage 2  Monolithic Draft Generation   1 call   (selected model) │
│ Stage 3  Deterministic Repairs         0 calls  (pure Python)    │
│ Stage 4  Factual-Strength Lint         0 calls  (pure Python)    │
│ Stage 5  Grounding & Consistency Audit 1 call   (flash, opt-in)  │
│ Stage 6  Combined Revision             0–1 call (only if needed) │
│ Stage G4 Adversarial Verification      1 call   (report-only)    │
│          → REVIEW PACKET (single reviewer surface)               │
│ Stage 7  Scorecard + QA Report + Cost  0 calls                   │
│ Stage 8  Save to chat history                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 The 4-stage grounded pipeline (G-stages, `DRAFT_GROUNDED_PIPELINE`, default on)

The G-stages implement the zero-hallucination pipeline spec on top of the
existing machinery. The staging is a deliberate anti-hallucination measure —
never collapse it back into one call.

* **G1 Ingestion Check** — `app/services/draft_ingestion.py`. Zero-LLM,
  generation-time re-check of every supporting doc: blob resolves, MIME
  allowed (FATAL + stop on failure), text-layer probe (scanned PDFs/images →
  `ocr_derived` flag, read visually by Gemini, higher scrutiny downstream),
  per-doc page/token estimates logged, and a greedy batch plan when the
  corpus exceeds `DRAFT_EXTRACT_TOKEN_BUDGET` (default 700k) — split, never
  truncated. Emits `ingestion_report` SSE.
* **G2 Grounded Field Extraction** — `app/services/draft_grounded_extraction.py`
  + `GROUNDED_EXTRACTION_PROMPT`. One controlled-generation call per batch
  (`response_schema=GroundedExtractionResult`, temp 0 / top_p 0.1): the
  template's placeholders become the target field schema; every found value
  carries a mandatory verbatim `source_snippet` + confidence; cross-document
  disagreements are flagged `conflict`, never silently resolved. Then a
  ZERO-LLM validation confirms each snippet is an actual substring
  (whitespace/quote tolerant; token-overlap leniency for OCR docs) of the
  cited document — fabricated citations become `unverified`. Only verified
  values enter the drafter's VERIFIED FIELD LEDGER (missing → blank /
  `[DATA NOT PROVIDED: <field>]`, the repo's established missing-value
  token); the rest go to the review packet. Persisted in
  `drafting_sessions.grounded_facts`; invalidated on doc upload.
* **G3 = Stage 2 drafting from verified facts** — the drafter reads the fact
  inventory + verified ledger, never raw documents (source-text extracts
  remain an optional secondary verification aid via
  `DRAFT_MONO_ATTACH_SOURCE_DOCS`; set it false for strict
  vetted-facts-only drafting).
* **G4 Adversarial Verification** — `app/services/draft_verification.py`
  + `DISCREPANCY_REVIEW_PROMPT`. A SEPARATE call after all repairs: draft +
  source material → every sentence with NO SOURCE SUPPORT FOUND (or the
  supporting passage when located on closer reading). Report-only: it NEVER
  modifies the draft. Emits `discrepancy_report` SSE.
* **REVIEW PACKET** — one consolidated `review_packet` SSE event + jsonb
  column: ingestion flags (incl. OCR docs), missing/conflicting/unverified
  fields, inventory provenance flags, deterministic-repairs QA register,
  grounding notes, and the discrepancy report. Rendered as the amber
  "Review packet — confirm before filing" panel in DraftingModal; also in
  `GET /{sid}` payloads.
* **Audit trail** — `app/services/draft_run_log.py`: every run gets a run ID;
  every stage's raw input/output is written timestamped under
  `DRAFT_RUN_LOG_DIR` (default `logs/draft_runs/<run_id>/`).
* **CLI entry point** — `scripts/run_draft_pipeline.py`: takes a session ID
  (analyzed template) or template file + supporting docs (local paths or
  `gs://` URIs), runs the full pipeline, writes `draft.md` +
  `review_packet.json` separately.
* Temperature: G2/G4 run at 0 (schema-bound JSON). Stage-2 drafting keeps
  temp 0.1 / top_p 0.95 — the documented dash-attractor fix; temp-0 drafting
  caused degenerate table loops (§4.3).

Call parity: the sequence is identical for Gemini and Claude drafting models —
Stages 1 and 5 always run on the cheap Gemini Flash model regardless.

Typical bill (defaults, 10 docs, 20-page draft, ₹95.50/$): extraction ~₹3–5
(once per session), draft ~₹5 (Gemini 3 Flash) to ~₹48 (Opus 4.8), audit ~₹2,
revision ₹0 unless violations. Template analysis (~₹6) is one-time and shown
separately.

---

## 2. Stage 0 — Template Structural Analysis (upload time)

* **File**: `app/services/drafting_service.py` → `analyze_template_task`
* **Model**: `ANALYSIS_MODEL` env (default `gemini-2.5-flash`)
* **Contract**: `ANALYSIS_SYSTEM_PROMPT` — strict-JSON Legal Template Analyzer.
  One structured-output call (`response_schema=TemplateStructure`,
  `temperature=0.0`) returns: sections with `section_id`, `heading`,
  `heading_verbatim` (real printed heading vs derived navigation label),
  `heading_format`/`body_format` (alignment, bold, pt sizes),
  `contains_table`, `is_boilerplate`, `original_text` skeleton, placeholders.
* **Verbatim re-slice**: for text/docx (and pypdf-extracted PDF) templates the
  raw text is re-sliced deterministically back into `original_text` so model
  newline-collapse can't corrupt skeletons; <60 % found triggers a verbatim
  re-analysis fallback. Text templates get justify enforced (`left → justify`).
* **Typography**: captured from PDFs as shown; court defaults for text.
* **Persistence**: `template_structure`, plus `analysis_usage`/`analysis_model`
  inside `template_file` — seeded into every run's cost ledger as the
  "Template cost" bucket.
* **Ops**: `resume_interrupted_analyses()` on startup re-queues analyses killed
  by reload.

## 3. Stage 1 — Verified Fact Extraction

* **File**: `build_facts_digest` · **Model**: `DRAFT_EXTRACT_MODEL`
  (default `gemini-3-flash-preview`); Claude models are filtered out of every
  Gemini-client chain by `_gemini_models()`.
* **Runs**: whenever documents exist and no cached digest —
  `MONO_SKIP_EXTRACTION` default `false` (raw-docs-to-draft is disabled by
  design; env escape hatch exists for experiments). Digest persists in
  `drafting_sessions.facts_digest`; regenerates reuse it for free.
* **Contract**: `FACT_EXTRACTION_PROMPT` — Legal Factual Matrix Extractor:
  * PART 1 Chronological Factual Matrix (`| S.No | Date | Particulars |`,
    exhaustive events, verbatim quotes, per-row `[Source: file]`)
  * PART 2 Fact Inventory (PARTIES / AMOUNTS / PROPERTIES / DOCUMENT
    REFERENCES / TERMS AND CONDITIONS with clause numbers + strength words
    like "exclusive" / OTHER FACTS)
  * PART 3 Timeline gaps + REQUIRED-BUT-ABSENT drafting fields
  * PART 4 DOCUMENT COVERAGE — one line per file with row/item counts; zero
    contribution without a reason = "go back and read it completely"
* Output budget 65,536 tokens (no truncation); SSE heartbeat every 12 s.
* **Session fact memory**: `facts_addendum` (user-confirmed facts) is appended
  with inventory-level authority and survives regenerations.

## 4. Stage 2 — Monolithic Draft Generation (the single drafting call)

* **Files**: `app/services/drafting_monolithic.py` →
  `MonolithicDraftingStrategy.draft`, `build_monolithic_prompt`;
  `app/services/drafting_prompts/monolithic_drafting_prompt.py` →
  `MONOLITHIC_DRAFTING_SYSTEM_PROMPT` (v2.0); Gemini iterators in
  `drafting_service.py`; shared strategy contracts in
  `drafting_strategy_base.py`; deterministic post-draft repairs in
  `draft_repairs.py`; fact-digest parsing/manifests in `draft_facts.py`.

### 4.1 System prompt (the universal contract)

`MONOLITHIC_DRAFTING_SYSTEM_PROMPT` v2.0 (~17.8 k chars, numbered rules across
10 layers) frames the model as a deterministic **legal-document renderer** for
any template category:

| Layer | Guarantees |
|---|---|
| 0 Mandatory source analysis | silent pre-pass BEFORE the first token: read every source document completely (0a), build a per-document ledger (0b), bind every template slot to its inventory row up front (0c), resolve conflicts via the inventory (0d), per-sentence traceability test (0e), no external citations/case law/statutes beyond the sources (0f) |
| I Input contract | template = structure authority; inventory = sole content authority; template sample values are contamination; user instructions can't override grounding |
| II Output grammar | pure document text; only `**bold**`, blank-line paragraphs, pipe tables with exact `|:---|` separators; no rule-lines/dividers |
| III Grounding | closed world; missing-value algorithm (skeleton blank → filing blank → `[DATA NOT PROVIDED]`), semantic integration of blanks, no sworn-clause placeholders, no computed values, schedule dates are targets |
| IV Template fidelity | every section once, in order; verbatim headings only when printed; skeleton line structure mirrored |
| V Tables & anti-degeneracy | bounded tables, one row per matching fact, no empty/repeated rows, no INDEX invention, repetition tripwire |
| VI Length | coverage-driven (per-event paragraph math injected per run); ingredient sections concise; cause of action states each component's own due/default date |
| VII Legal craft | continuous numbering, attestation restart + split verification mirroring, prayer lettering, one-mark-per-document (incl. table cells), neutral chronology |
| VIII Zero-defect filing | caption once; option menus + TITLE narrowed to supported reliefs; verbatim party descriptions; admissions language; authorization; financial-table completeness incl. advance/part-payment rows; statutory-step dates pleaded; interim coherence; document register 1:1; no instructional placeholders |
| IX Priority + silent self-check | conflict ordering and a final checklist the model applies silently |

### 4.2 User turn (`build_monolithic_prompt`)

* Per-section blocks: heading directive (verbatim vs no-heading), boilerplate
  flag, table directive, verification directive, sanitized skeleton
  (dash/underscore rules collapsed so temp-0 echo can't flood), placeholder
  map ("if absent, output the token verbatim").
* Fact inventory inlined (`digest_cached` distinguishes cached-prefix runs);
  zero-hallucination + format-fidelity blocks; LENGTH contract with computed
  event count (one 80–150-word paragraph per matrix event, ≥
  `DRAFT_MIN_TOTAL_WORDS`, default 8000 ≈ 20+ pages).

### 4.3 Generation config & streaming

* **Gemini**: `temperature 0.1, top_p 0.95` (the old `temp 0/top_p 0.1` was a
  dash-attractor that caused the INDEX-table stall; penalty params are NOT
  sent — 2.5-flash rejects them), thinking capped via `_mono_thinking_cfg`
  (default 2048), `max_output_tokens` 65,536.
  `_iter_gemini_draft_chunks`: 180 s inactivity watchdog
  (`DRAFT_STREAM_INACTIVITY_SECONDS`) → RuntimeError → next model in chain;
  never retries after the first chunk (prevents duplicated half-documents).
* **Claude**: `_iter_claude_chunks` (anthropic SDK ≥0.86 in the venv), key
  resolved from `os.environ` **or directly from `.env`** (the app never
  exports .env), `thinking={"type":"disabled"}` (Sonnet 5 defaults to adaptive
  otherwise), NO temperature (400 on Sonnet 5/Opus 4.8/4.7), max_tokens ≤64k.
* **Model chains** (`MODEL_FALLBACKS`): each Claude model degrades within
  family then to Gemini flagships; every chain ends in Gemini so a missing
  `ANTHROPIC_API_KEY` still drafts.
* **Anti-degeneracy circuit breaker**: `_is_degenerate_tail` — if the last 600
  streamed chars are ≥93 % frame characters, the stream is aborted (stops
  billing), the junk run is cut, and generation resumes from the last good
  text (≤2 trips). `_TagStreamCleaner` additionally collapses dash/underscore
  floods and strips stray section tags live, with partial-token holdback.
* **Continuations**: extra passes (attempt cap 6) stitch `MAX_TOKENS`/breaker/
  mid-stream cuts using the last 6 k chars as the resume anchor — drafts are
  never truncated.
* **Duplication guards** (the "document repeats itself below" defect class):
  every continuation's output is BUFFERED, deduplicated against the existing
  text (`_dedupe_continuation`: leading *and trailing* replay blocks dropped by
  exact alnum-normalized containment or ≥80 % 8-word-shingle match; a short
  "new" caption-line tweak followed only by long replays is treated as a
  restart, not a commit point; `_trim_overlap` for re-emitted sentence heads —
  also on the completeness path) and only the genuinely new middle is
  appended/streamed. Table-row resumes join with a single `\n` (not `\n\n`).
  A mid-stream model failure after >800 streamed chars NEVER reruns the full
  prompt on the next chain model (that re-drafts from the top) — it resumes via
  a buffered continuation; tiny failed partials are rolled back.
  `find_missing_template_sections` matches alnum-normalized (a bolded/re-wrapped
  heading is not "missing"), the completeness prompt is APPEND-ONLY (no longer
  embeds the full drafting prompt), and a completeness pass that returns only
  duplicate content stops the loop. Final net: `_strip_restarted_document`
  (also first step of the deterministic repairs) cuts any appended re-draft
  whose content shingle-replays (≥60 %, or ≥90 % near Memo of Parties /
  affidavit / vakalatnama / verification — raised bar, not a hard skip) the
  preceding text; the heading guard looks both before and after the re-match so
  court-header-first Memo of Parties tails survive. Frontend `document_end`
  propagates the cleaned text into the live viewer via `onSectionText`.
* **Result**: ONE `__document__` record saved (`section_id "__document__"`,
  `heading_verbatim false`); `document_end` carries the clean full text.

## 5. Stage 3 — Deterministic Repairs (zero LLM calls)

`_monolithic_deterministic_repairs` chains (each returns `(text, info)`):

1. `_dedupe_cause_title` — repeated caption/court-header blocks removed
2. `_narrow_slash_option_menus` — template option menus narrowed
3. `_fix_admitted_dues_wording` — "admitted dues/liability" neutralized unless
   the inventory shows an express admission
4. `_sanitize_statute_years` — statute years aligned to source
5. `_fix_proceedings_placeholder`, `_fix_deponent_age_placeholder`
6. `_renumber_annexures` — one document = one mark, sequential re-marking at
   first-reliance sites, unambiguous citation remap, Colly-safe, ambiguous
   marks reported
7. `_reconcile_interim_relief_extended` — declared "no interim relief" deletes
   ad-interim/receiver/attachment/disclosure prayer clauses + reletters
8. `_strip_prayer_placeholders` — prayer clauses with unresolved markers removed
9. `_merge_chronology_from_digest` — matrix events missing from the
   List-of-Dates table injected in order
10. `_rebuild_list_of_documents` — LoD rebuilt 1:1 from the body register
11. `_polish_exhibit_citations` — inline `(ANNEXURE P-x)` added at uncited
    document mentions
12. `_resolve_remaining_placeholders` — markers filled from digest when the
    value exists
13. **QA register capture** — remaining marker labels recorded as
    `to_be_confirmed` (spec: filing draft carries clean blanks, humans get
    the list)
14. `_strip_all_sworn_placeholders` — any leftover marker → `____`

Earlier in the same review block `_normalize_draft` runs (continuous body
renumbering with cross-ref remap, attestation restart, prayer relettering,
same-document mark dedup, annexure series compaction) — shared with
section-wise mode.

## 6. Stages 4–6 — Validation & Revision

* **Stage 4** `_factual_strength_lint`: inventory anchors (dates, reference
  codes, amounts) missing from the draft become violations.
* **Stage 5** grounding audit (`MONO_AUDIT_ENABLED` default `true`, model
  `DRAFT_MONO_AUDIT_MODEL` default `gemini-3-flash-preview`):
  `GROUNDING_AUDIT_PROMPT` — TASK 1 unsupported assertions, TASK 2 exhibit
  mapping (incl. duplicate marks), TASK 3 contradictions + a **named**
  `interim_relief` structured field. The interim-relief contradiction has a
  hard-coded deterministic resolution (`_delete_paragraph_containing`).
* **Stage 6** one combined revision call (session engine) — all findings +
  attestation/LoD consistency duties fixed over the tagged document in a
  single pass; result re-split, saved, streamed as
  `section_replace`/`document_replace`. Runs only when violations exist.

## 7. Stage 7 — Scorecard, QA report, Cost

* **Scorecard**: `app/services/draft_invariants.py` — 15 pure-Python checks
  (registry `ALL_CHECKS`; also the regression harness in
  `tests/test_draft_invariants.py`): unique paragraph numbers, attestation
  restart + date order, prayer letters contiguous, annexure series contiguous,
  one mark per document AND one document per mark, single exhibit terminology,
  notice-not-in-invoice-table, chronology neutrality, no empty cells,
  verification↔statement-of-truth mirror, 12A placement, interim coherence,
  registered-doc placeholders. Emitted as the `scorecard` SSE event + logged.
* **QA report** (`qa_report` SSE): `toBeConfirmed` blank labels,
  `ambiguousMarks`, `removedPrayerClauses`, `chronologyRowsAdded`,
  `annexureCount` → amber "QA — confirm before filing" panel.
* **Cost**: per-call ledger (`_record_call`) stores each call's pillar costs
  **at that call's own model** (fixes the single-model repricing bug that
  inflated totals); `compute_draft_cost(ledger=...)` sums them;
  `_split_template_and_draft_cost` partitions Template cost (one-time
  analysis) vs Draft cost (this generation) vs grand total. Rates in
  `gemini_pricing.py` match official Gemini tables (3.1 Pro/3 Pro $2/$12,
  3.5 Flash $1.50/$9, 3 Flash $0.50/$3, 3.1 Flash-Lite $0.25/$1.50, 2.5 Pro
  $1.25/$10, 2.5 Flash $0.30/$2.50, 2.5 Flash-Lite $0.10/$0.40) and Anthropic
  (Sonnet $3/$15, Opus $5/$25). `USD_TO_INR` default 95.50.

## 8. SSE protocol (monolithic events)

```
status · ingestion_report{runId, documents[], ocrDerivedDocs} ·
draft_start{mode:"monolithic"} · document_chunk · document_end{text}
section_replace · document_replace{text} · grounding_report · qa_report
discrepancy_report{items[], unsupportedCount} · review_packet{runId,
ingestion, fields{missing,conflicts,unverifiedCitations}, provenance, qa,
groundingNotes, discrepancies} · scorecard · usage · cost(provisional) ·
cost(final){templateCost, draftOnlyCost, grandTotal, calls[], byStage} ·
chat_saved · done · [DONE]
```

Route: `POST /api/chat/draft/{sid}/generate/stream` with anti-buffering
headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`).

## 9. Frontend (React, `frontend/src/components/DraftingMode/`)

* **DraftingModal.jsx** — strategy + model dropdown (Gemini 3 Flash default
  "LOWEST COST"; Claude Sonnet 5/4.6, Opus 4.8/4.7/4.6; Gemini Pro/Flash
  families), confirmed-facts textarea, QA panel, cost panel with
  template/draft/total split + per-stage and per-call details.
* **draftStreamParser.js** — typed event dispatch; single `__document__`
  buffer for monolithic; `document_replace`/`qa_report` handlers.
* **DraftStreamingViewer.jsx** — live view streams PLAIN text (rAF
  `textContent`, `**` stripped, follow-scroll with user-scroll release);
  finished view renders the formatted A4 page (template fonts, justify,
  bordered tables).
* **draftFormatUtils.js** — shared parser for screen AND export:
  `normalizeBoldMarkers` (multi-line bold re-scoped per line, strays dropped),
  gappy-table-tolerant `parseContentBlocks`, bold-header detection.
* **draftDocxExport.js** — real OOXML (A4, 1-inch margins, half-point sizes,
  bordered tables, bold runs) from the same parsed blocks.

## 10. Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `DRAFT_MIN_TOTAL_WORDS` | 8000 | length floor (~20+ pages) |
| `DRAFT_MONO_AUDIT` | true | audit + revision stages |
| `DRAFT_MONO_AUDIT_MODEL` | gemini-3-flash-preview | audit model |
| `DRAFT_MONO_SKIP_EXTRACTION` | false | experiments only: raw-docs-to-draft |
| `DRAFT_EXTRACT_MODEL` | gemini-3-flash-preview | extraction model |
| `DRAFT_MONO_THINKING_BUDGET` | 2048 | Gemini thinking cap ("" = default) |
| `DRAFT_STREAM_INACTIVITY_SECONDS` | 180 | stream watchdog |
| `USD_TO_INR` | 95.50 | display rate |
| `ANTHROPIC_API_KEY` | — | required for Claude models (read from .env) |
| `ANALYSIS_MODEL` | gemini-2.5-flash | template analysis |
| `DRAFT_GROUNDING_AUDIT` | true | global audit switch |
| `DRAFT_GROUNDED_PIPELINE` | true | 4-stage grounded pipeline (G1/G2/G4 + review packet) |
| `DRAFT_EXTRACT_TOKEN_BUDGET` | 700000 | per-batch extraction budget (G1 batch plan) |
| `DRAFT_GROUNDED_MAX_FIELDS` | 80 | target-field cap for G2 extraction |
| `DRAFT_DISCREPANCY_TIMEOUT_SECONDS` | 90 | G4 verification call timeout |
| `DRAFT_RUN_LOG_DIR` | logs/draft_runs | per-run stage audit trail |

## 11. Failure handling

* Stream stall → watchdog abort → next model in chain.
* Mid-stream API error after first chunk → raised (never silently restarted →
  no duplicated half-documents).
* Degenerate token loop → breaker abort → resume from last good text.
* Claude auth/SDK missing → clean error → Gemini fallback chain.
* Gemini-only stages never receive Claude model ids (`_gemini_models`).
* uvicorn `--reload` kills in-flight SSE: never edit backend files during a
  run; interrupted analyses resume on startup.

## 12. Defect-class coverage map (reviewer findings → prevention layers)

| Defect (observed live) | Prompt rule | Deterministic guard | Verifier |
|---|---|---|---|
| Duplicated cause title | VIII-23 | `_dedupe_cause_title` | — |
| Placeholder markers in filing draft | III-9, VIII-29/34 | resolve→strip chain + QA register | placeholder invariant |
| Annexure collapse (9 docs / 3 marks) | VII-21 | `_renumber_annexures` | `one_document_per_mark` |
| Same doc under two marks | VII-21 | `_normalize_draft` dedup | `single_mark_per_document` + audit TASK 2 |
| Two invoices sharing a mark in table cells | VII-21 (table-cell clause) | (audit-routed) | audit TASK 2 |
| Advance invoice missing from table | VIII-31 | `_factual_strength_lint` → revision | audit TASK 1 |
| 12A dates / milestones omitted | VIII-31 | `_merge_chronology_from_digest` + lint | audit |
| Catalogue title (unsupported reliefs) | VIII-24 title scope | `_narrow_slash_option_menus` | prayer validator |
| Blended interest date | VII-20 | — | interest wording audit |
| Interim-relief contradiction | VIII-30 | `_reconcile_interim_relief_extended` | named `interim_relief` field + hard delete |
| "Admitted dues" overstatement | VIII-26 | `_fix_admitted_dues_wording` | admission validator |
| Trait inference from name | III-8 | — | audit TASK 1 |
| Dash/table floods, INDEX stall | II-7, V-14/15 | breaker + cleaner + skeleton sanitization | — |

**Spec items not yet implemented**: formal document-classification taxonomy,
DRAT/SARFAESI field set + pre-deposit arithmetic, dual QA-draft with inline
citations, numeric accuracy/court-readiness scores with hard `blocked` status,
10-scenario test matrix (the invariant harness covers a subset).
