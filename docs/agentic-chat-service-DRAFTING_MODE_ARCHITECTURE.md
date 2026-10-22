# Drafting Mode — Complete System Architecture

> Template-driven, fact-grounded, court-ready document drafting inside **agentic-chat-service**
> (port 8096) with a React modal UI inside the ChatModel page.
>
> Design philosophy: **Template = format authority. Supporting documents = content authority.
> Every defect class is prevented by a rule AND caught by a deterministic check or a verifier pass** —
> prompts prevent, Python guarantees, audits repair.

---

## 1. End-to-End Flow

```
 FRONTEND (ChatModelPage → DraftingModal)            BACKEND (agentic-chat-service)
 ────────────────────────────────────────            ─────────────────────────────────────────────
 "Drafting Mode" chip clicked
   └─► POST /api/chat/draft/session ───────────────► drafting_sessions row (status=created)

 Template uploaded (PDF/DOCX/TXT ≤20MB)
   └─► POST /{sid}/template ───────────────────────► normalize (docx→text) → GCS → asyncio worker:
   poll GET /{sid} every 2.5s ◄────────────────────  ① TEMPLATE STRUCTURAL ANALYST
   (retry: POST /{sid}/template/retry;                  structured output (TemplateStructure) +
    resume_interrupted_analyses on startup)             verbatim re-slice + justify enforcement
                                                        status: analyzing → ready

 Supporting docs (≤50 × 50MB)
   └─► POST /{sid}/documents ──────────────────────► GCS; invalidates cache/digest/ADK runners

 Generate (model dropdown → llm_name)
   └─► POST /{sid}/generate/stream (SSE) ──────────► ② FACTUAL MATRIX EXTRACTOR (cached digest)
                                                     ③ PLANNING: exhibits pre-assigned (P-1…P-n)
                                                        + EVENT OWNERSHIP (one section per event)
                                                        + length plan (word floors by section kind)
                                                     ④ DRAFTING AGENT — parallel workers (×4)
   live cards painted via rAF ◄────────────────────    stream in template order; expansion inside
                                                        workers; MAX_TOKENS continuation; cache-
                                                        expiry auto-recovery
                                                     ⑤ NORMALIZATION (deterministic Python):
                                                        continuous paragraph renumbering (body
                                                        scope), attestation restart-at-1, prayer
                                                        letter relettering, annexure compaction,
                                                        cross-reference remapping
                                                     ⑥ GROUNDING AUDITOR (structured output):
                                                        facts vs inventory + exhibit mapping +
                                                        drafting contradictions → parallel repairs
                                                     ⑦ FINALIZATION PASSES: List of Documents
                                                        derived from final body register →
                                                        Verification (final para ranges) →
                                                        Statement of Truth mirroring it
   cost panel (₹) ◄────────────────────────────────  usage+cost events (provisional + final)
   done → Full Document (A4) view                    compiled markdown → chat history (chat_saved)

 Download → .docx / .md / .txt                       GET /{sid}/download (md/txt)
   (docx built client-side, WYSIWYG with page view)
```

---

## 2. The AI Agents (prompts in `app/services/drafting_prompts/` — one file per agent)

| Prompt | File |
|---|---|
| `ANALYSIS_SYSTEM_PROMPT` | `drafting_prompts/template_analysis_prompt.py` |
| `FACT_EXTRACTION_PROMPT` | `drafting_prompts/fact_extraction_prompt.py` |
| `DRAFTING_SYSTEM_PROMPT` (section-wise) | `drafting_prompts/sectionwise_drafting_prompt.py` |
| `MONOLITHIC_DRAFTING_SYSTEM_PROMPT` (one-shot, v2.0) | `drafting_prompts/monolithic_drafting_prompt.py` |
| `GROUNDING_AUDIT_PROMPT` | `drafting_prompts/grounding_audit_prompt.py` |

### ① Template Structural Analyst — `ANALYSIS_SYSTEM_PROMPT`
One Gemini call, `response_schema=TemplateStructure`, temp 0.0, 65k output budget.
- Fine-grained deterministic segmentation (never merge/drop sections; 100% coverage).
- **`heading_verbatim` flag**: real template headings copied character-for-character; unlabeled
  blocks get derived labels that are navigation-only and NEVER printed into the document.
- **Typography capture**: per-section `heading_format`/`body_format` (alignment, pt size, bold,
  caps) + document `base_font_family`/`title_format`. Read visually from PDFs; for text/DOCX
  (no observable alignment) court defaults apply and **justify is enforced deterministically**
  post-analysis for non-light, non-table sections.
- **Verbatim re-slice** (`_reslice_sections_from_text`): structured output collapses newlines,
  so for text templates the model provides boundaries only; verbatim text is sliced from the raw
  file. Lets the model abbreviate `original_text` so long templates never truncate.
- Tables flagged (`contains_table`) and encoded as markdown pipes.

### ② Legal Factual Matrix Extractor — `FACT_EXTRACTION_PROMPT`
Librarian pass over ALL supporting docs (cached in `facts_digest`, cleared on doc upload):
1. **Chronological Factual Matrix** — `| S.No | Date | Particulars |`, DD-MMM-YYYY + variants,
   `[Parties:][Place:][Source:]` tags, verbatim quotes, incorporation/registration dates included.
2. **Fact Inventory** — parties (CIN/PAN), amounts (UTR refs), document references, terms.
3. **Timeline Gaps** — pre-declares missing facts so the drafter writes `[DATA NOT PROVIDED: …]`.

### ③ Drafting Agent — `DRAFTING_SYSTEM_PROMPT` (~3.5k tokens, cached prefix)
31 numbered rules in blocks:
- **Division of authority** — template is FORMAT ONLY (sample content never leaks); docs+inventory
  are the sole content source. Sample suit numbers → `NO. ____ OF 20__`.
- **Grounding (1–7)** — every fact traceable; `[DATA NOT PROVIDED]`; narrative sections written fully.
- **Format fidelity (8–10)** — exact line structure; tables populated with row-type semantics
  (a legal notice is a demand, NOT an invoice); no markdown styling.
- **Completeness (11–12)** — length from coverage, never padding.
- **Verbatim precision (13–14)** — names/numbers char-for-char; dates re-rendered in template style.
- **Court-ready standards (15–19)** — headings char-for-char, court idiom, defined short-forms,
  cross-references, cause-title/prayer/verification conventions.
- **Pleading discipline (20–24)** — exhibit register citations (single "ANNEXURE P-#" term),
  continuous numbering (no dual schemes), facts pleaded once (no clause-by-clause contract
  walkthroughs), THREE-way verification (personal knowledge / business records / legal advice,
  Order VI 15A) with Statement of Truth mirroring, neutral averments.
- **Financial/relief/record discipline (25–31)** — no computed dates, monetary consistency
  (per-component interest dates, narrative=prayer), relief–pleading coherence (no unsourced
  urgency; body↔prayer matching), no trait inference from names, verbatim quotes with ellipsis,
  chronology neutrality, filing-status columns filled.
- **Priority order** (accuracy > format > length > style; user instructions can't override) +
  **silent self-check** (annexure map one-to-one, attestation coverage, zero sample leakage).

### ④ Grounding & Consistency Auditor — `GROUNDING_AUDIT_PROMPT` (structured output)
- **TASK 1** grounding: every name/date/amount vs the inventory.
- **TASK 2** exhibit mapping: uncited document mentions; marks only-in-list; rows with no mark;
  **documents cited under two different marks** (says which to keep).
- **TASK 3** drafting contradictions: interim-relief contradictions/orphan prayers; argumentative
  adjectives in chronology tables; **mismatched table row types**; sworn-statement disagreements.
- Violations feed parallel repairs (semaphore 3, `MAX_AUDIT_REPAIRS=8`) with per-section rewrite
  prompts carrying the findings + full document state.

### Planning sub-agents (structured output, temp 0)
- **`_plan_exhibits`** — deterministic parse of the digest's DOCUMENT REFERENCES → complete
  pre-assigned register P-1…P-n given to every worker ("never create a mark not in this register").
- **`_plan_event_ownership`** (`EventOwnershipPlan`) — every matrix event assigned to exactly ONE
  narrating section; workers get OWNED EVENTS blocks (their rows verbatim, cross-refer the rest);
  word floors recomputed from owned counts (zero events → cross-refer-only). This is the
  anti-repetition mechanism for parallel drafting.

---

## 3. Generation Engine

**Parallel by default** (`DRAFT_PARALLEL_SECTIONS=4`, verified 369s for a full plaint vs 30min serial):
- Workers draft sections concurrently through the **direct google-genai engine sharing one
  explicit context cache**; the emitter streams to the client in template order via per-section
  `asyncio.Queue`s (later sections keep generating while earlier ones drain).
- Coverage expansion runs inside each worker (underweight narrative → one full rewrite,
  `section_replace` event); `MAX_TOKENS` → up to 2 continuation calls stitching the tail.
- **Cache-expiry recovery**: 403 "CachedContent not found" → `_recover_cache` (lock; one worker
  rebuilds, others reuse; inline-parts fallback). Drafting cache TTL ≥ 3600s.
- **ADK engine** (`agents/drafting_adk.py`, App+Runner+ContextCacheConfig) used when
  `DRAFT_PARALLEL_SECTIONS=1`: one session primes docs+inventory once; ADK auto-manages the cache.
  Retry-once on transient drops; falls back to the direct engine mid-section without duplicates.
- `DRAFT_THINKING_BUDGET` optionally caps thinking tokens (latency lever).

**Per-section prompt assembly**: verbatim template skeleton (format guide; heading rule) +
placeholders + DOCUMENT STATE (exhibit register mark=description; numbering directive;
lane-keeping section summaries) + length/conciseness directive (`ingredient` sections —
cause of action/limitation/jurisdiction — capped ~350 words, no expansion, 12A = maintainability)
+ table directive + verification directive + OWNED EVENTS + fact inventory (cached or inline).

---

## 4. Deterministic Normalization — `_normalize_draft` (pure Python, runs before the audit)

The guarantees prompting can't make:
1. **Continuous paragraph renumbering** (body scope) when duplicate mains exist document-wide;
   sub-numbers carried (5.3 → k.3); cross-references ("paragraph 12") remapped via
   first-occurrence map — applied to all sections including attestations.
2. **Attestation scope**: Statement of Truth / affidavit sections excluded from the plaint
   sequence; their own clauses restart at 1.
3. **Prayer letter relettering**: ascending-with-gaps sequences (a,b,c,g,j,k) → (a…f);
   restarting lists untouched.
4. **Annexure series compaction**: P-1,P-3,P-5 → P-1,P-2,P-3 with every reference updated.
Clean drafts pass through unchanged (identity check). Changes stream as `section_replace`.

**`_structural_lint`** (also deterministic, feeds the repair loop): duplicate paragraph numbers,
annexure marks referenced but never annexed, series gaps, mixed ANNEXURE/Exhibit terminology.

---

## 5. Finalization Passes (after repairs; run when parallel or normalization changed)

1. **List of Documents** — DERIVED from the final body's annexure register (`_build_doc_state`):
   exactly one row per mark, in order, descriptions from the body's citations, statuses filled.
   The list and the body cannot disagree.
2. **Verification** — regenerated with the final paragraph state (three-way ranges).
3. **Statement of Truth** — regenerated with the finished Verification quoted: "mirror these
   ranges exactly". The two sworn statements cannot disagree.

Then: compiled markdown (`compile_draft_markdown`) → chat history via `FileChatRepository.save_chat`
(general chat; drafting session id doubles as chat session id) → `chat_saved` event.

---

## 6. Cost Tracking (₹ @ `USD_TO_INR`, default 95.14)

`_add_usage` accumulates input/output/**cached** tokens (+ cache high-water mark) across every
call — digest, planning, sections, expansions, audit, repairs, finalizations. `compute_draft_cost`
implements Gemini's cost pillars with official rates (`gemini_pricing.py`, verified vs
ai.google.dev): cache-hit reads at the ~90%-discounted cached rate, remaining input at standard,
output once at standard (incl. thinking tokens), storage prorated over real lifespan
(run elapsed + TTL), one-time cache setup, and **savings** (without-cache − with-cache).
`cost` SSE event fires twice: provisional after sections ("so far — audit running…") and final.
Models: Gemini 3.1 Pro Preview / 3.5 Flash / 3 Flash Preview / 2.5 Pro / Flash / Flash-Lite,
each with fallback chains. Typical measured cost: ₹9–35 per full plaint on Flash tiers.

---

## 7. SSE Protocol

`POST /{sid}/generate/stream` → `data: {json}\n\n` frames, terminated by `data: [DONE]`.

| Event | Meaning |
|---|---|
| `status` | narration: extraction heartbeat (12s), ownership plan, normalization, audit, repairs, finalizations |
| `section_start` / `chunk` / `section_end` | ordered streaming (chunks also carry `[START/END_SECTION_i]` markers) |
| `section_replace` | expansion / repair / normalization / finalization rewrote a section |
| `section_error` | section failed on all engines/models |
| `grounding_report` | audit findings before repair |
| `usage`, `cost` (×2) | tokens + ₹/$ breakdown |
| `chat_saved`, `done` | persistence + terminal |

## 8. REST API (JWT bearer; `/template` + `/generate/stream` quota-gated)

| Route | Purpose |
|---|---|
| `POST /session` | create session |
| `POST /{sid}/template` · `POST /{sid}/template/retry` | upload / re-run analysis |
| `GET /{sid}` | poll status, structure, sections |
| `POST /{sid}/documents` | supporting docs (invalidates cache+digest+runners) |
| `POST /{sid}/generate/stream` | SSE generation (`llm_name`, `section_ids?`, `user_instructions?`) |
| `GET /{sid}/download?format=markdown\|txt` | compiled draft |
| `DELETE /{sid}` | delete session + cache |

## 9. Persistence — `drafting_sessions` (psycopg3, auto-migrated)

```
id · user_id · status (created→analyzing→ready→generating→completed | *_failed)
template_file jsonb · template_structure jsonb (sections + typography + heading_verbatim)
supporting_docs jsonb · cache_name · draft_sections jsonb · facts_digest text · error
```
Blobs in GCS `drafting/{user}/{sid}/…`; compiled draft also a `file_chats` row.
`resume_interrupted_analyses` on startup requeues sessions stuck in `analyzing` (reload-safe).

---

## 10. Frontend (`frontend/src/components/DraftingMode/` — see FRONTEND_GUIDE.md for depth)

```
draftingModeApi.js        SSE-over-fetch (frame buffering, [DONE]/[PING], AbortController),
                          uploads, analysis polling + retry, download URLs
draftStreamParser.js      typed events → callbacks; owns per-section buffers in a Map (not state);
                          marker-protocol fallback
DraftingModal.jsx         phases setup→generating→finished; model dropdown (Gemini 3.x/2.5);
                          seeds section cards from template_structure; cost panel (₹ breakdown
                          + savings); "Saved to chat history" badge
DraftStreamingViewer.jsx  Sections accordion ↔ Full Document (A4, auto on finish);
                          100-page perf: rAF textContent paint for the live card,
                          version-memoized finished cards, content-visibility:auto virtual
                          rendering; click-toggled download menu
draftFormatUtils.js       ONE block parser for screen+docx: markdown tables → structured blocks,
                          **bold** → segments, heading dedup, pt→px, headingVerbatim respect
draftDocxExport.js        real OOXML via `docx` lib: A4 + 1in margins, Times New Roman defaults,
                          per-section alignment/pt (half-points!), bordered Word tables,
                          bold TextRuns — WYSIWYG with the page view
```
Trigger: "Drafting Mode" chip in `PromptChipsBar` (`ChatModelPage.jsx`) — chip bar renders
unconditionally (built-in chips survive secrets-fetch failure).

## 11. Configuration

| Env | Default | Purpose |
|---|---|---|
| `DRAFT_PARALLEL_SECTIONS` | 4 | worker concurrency (1 = sequential ADK mode) |
| `DRAFT_MIN_TOTAL_WORDS` | 8000 | draft-level target distributed into section floors |
| `DRAFT_GROUNDING_AUDIT` | true | audit + repair passes |
| `DRAFT_THINKING_BUDGET` | unset | cap thinking tokens |
| `DRAFT_USE_ADK` | true | ADK engine (only effective when parallel=1) |
| `DRAFT_CACHE_TTL_SECONDS` / `DRAFT_ADK_PRIME_MAX_BYTES` | 1800 / 8MB | cache TTL / digest-only priming threshold |
| `USD_TO_INR` | 95.14 | cost display rate |

Limits: template 20MB · 50 docs × 50MB · 200 sections · 65,536 tokens/section ·
2 continuations · 1 expansion/section · 8 audit repairs.

**Operational warning:** uvicorn `--reload` kills in-flight SSE drafts on any backend file save —
run without `--reload` in production.

## 12. Defect-Class Coverage Map (how court-readiness is guaranteed)

| Defect class | Prevented by | Guaranteed/repaired by |
|---|---|---|
| Hallucinated facts | grounding rules 1–7, temp 0 | Auditor TASK 1 → repair |
| Template sample leakage | division of authority | Auditor TASK 1 |
| Duplicate/dual paragraph numbering | rule 21, DOCUMENT STATE | **normalizer (deterministic)** + lint |
| Attestation numbering/ranges | rule 23 | normalizer scope + attestation passes |
| Prayer letter gaps | — (repairs cause it) | **normalizer relettering (deterministic)** |
| Exhibit gaps/duplicates/mapping | pre-assigned register, rule 20 | **compaction (deterministic)** + lint + Auditor TASK 2 + LoD derivation |
| Wrong-type table rows | row-semantics directive | Auditor TASK 3 |
| Repetition/bloat | **event ownership**, rule 22, ingredient caps | length plan floors/caps |
| Relief contradictions | rule 27 | Auditor TASK 3 |
| Format/typography drift | analyzer capture + verbatim re-slice + justify enforcement | renderers share one parser (WYSIWYG) |
```
