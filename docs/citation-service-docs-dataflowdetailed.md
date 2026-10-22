================================================================================
JuriNex Citation Service — Detailed Architecture and Data Flow
================================================================================

The JuriNex Citation V2 Engine is a production-grade Python service that reads a lawyer's case facts, extracts substantive legal issues, plans targeted search queries for the Indian Kanoon API, filters the search candidates using multi-tier relevance checks, judges them with LLMs, and formats a classified citation report.

--------------------------------------------------------------------------------
At a Glance
--------------------------------------------------------------------------------

+=========================+=====================================================+
| PROPERTY                | VALUE / SPECIFICATION                               |
+=========================+=====================================================+
| Status                  | Stable / Production                                 |
+-------------------------+-----------------------------------------------------+
| Runtime / Language      | Python 3.12 (Uvicorn / FastAPI)                     |
+-------------------------+-----------------------------------------------------+
| Databases               | PostgreSQL (Relational & Cache) + Qdrant (Vectors)  |
+-------------------------+-----------------------------------------------------+
| Third-Party APIs        | Google Gemini API & Indian Kanoon API               |
+-------------------------+-----------------------------------------------------+
| Owner / Support Team    | Legal AI Backend Team                               |
+=========================+=====================================================+

---

--------------------------------------------------------------------------------
1. System Architecture & Neighbors
--------------------------------------------------------------------------------

The Citation Service is an internal microservice inside the JuriNex backend. It acts as an orchestrator, connecting the React Frontend, PostgreSQL, Qdrant, Indian Kanoon, and Gemini.

                  +-----------------------------------+
                  |          React Frontend           |
                  +-----------------+-----------------+
                                    |
                                    | 1. Start Run / Poll Status
                                    v
                  +-----------------------------------+
                  |          Gateway Service          |
                  +-----------------+-----------------+
                                    |
                                    | 2. HTTP POST
                                    v
                  +-----------------------------------+
                  |       main.py (FastAPI App)       |
                  +-----------------+-----------------+
                                    |
                                    | 3. Run Background Task
                                    v
                  +-----------------------------------+
                  |     pipeline/orchestrator.py      |
                  +-------+-------------------+-------+
                          |                   |
        +-----------------+                   +-----------------+
        | (Local DB / Cache hits)             | (Remote Calls)  |
        v                                     v                 v
+---------------+                     +---------------+ +---------------+
|  PostgreSQL   |                     | Google Gemini | | Indian Kanoon |
| (Asset Cache) |                     |  (3.5 Flash)  | |  (Search API) |
+---------------+                     +---------------+ +---------------+

---

--------------------------------------------------------------------------------
2. End-to-End Data Flow Funnel
--------------------------------------------------------------------------------

The engine employs a narrowing funnel to balance recall with costs. High-recall, low-cost operations run at the wide top of the funnel; high-precision, higher-cost AI operations run on survivors at the narrow bottom.

       [ User Case Document Upload (First 60,000 Characters Max) ]
                                   │
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 1. Perspective Normalization & Auto-Correction      │  <-- Free (Heuristics)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 2. Substantive Legal Issue Extraction (LLM)         │  <-- Gemini Call (1x)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 3. Doctrine Translation & Query Planning            │  <-- Free (ANDD/ORR)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 4. Search Retrieval & API Budget Gate               │  <-- IK API calls (<=14)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 5. Deduplication & Cheap Lexical Filtering          │  <-- Free (Overlap >= 0.12)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 6. Case Shortlisting & Full Document Fetch          │  <-- Keep Top 7 (DB Cache hit)
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 7. Outcome Detection & AI Judging                   │  <-- Regex + Gemini + Veto
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ 8. Bucket Sorting, Usage Analysis & Relevance Gate  │  <-- Gate off-topic out
        └──────────────────────────┬──────────────────────────┘
                                   ▼
         [ Clean Citation Report: Rec / Adverse / Caution ]

---

--------------------------------------------------------------------------------
3. Phase-by-Phase Deep Dive
--------------------------------------------------------------------------------

Phase 1: Understand the Case (Profile & Side)
---------------------------------------------
- Responsibility: Standardize the input client perspective, load context text, and extract a basic legal profile.
- Mapped Stages:
  * normalize_perspective.py (Stage 0)
  * extract_case_profile.py (Stage 1)
- Under the Hood:
  * Context Loader: Extracts context from the uploaded documents using from_case_file_context. It combines content fields from the first 8 document chunks up to 60000 characters (configured via CITATION_V2_MAX_CONTEXT_CHARS). If the text is less than 800 characters, it logs a diagnostic warning pointing out that the document may be a snippet rather than the full text.
  * Side Autocorrect: A wrong perspective (e.g. respondent when the client is the petitioner) flips all downstream legal labels. In services/perspective_service.py, if the user selects respondent, but the text contains writ jurisdiction anchors (e.g., "Article 226", "Article 32", "writ petition") and at least 2 petitioner cues (e.g., "the petitioner submits") with 0 respondent cues, the engine automatically overrides the perspective to petitioner.
  * Case Profiler: Parses the query and context text in services/issue_service.py to extract statutes (e.g. section 12, article 14), important facts, and relief sought.
- AI Involvement: None (pure deterministic heuristics).
- Inputs & Outputs:
  * Input: query (string), case_file_context (list of dicts), perspective (string).
  * Output: case_profile containing represented side, opposite side, statutes, and facts.
- Error Modes: If the document has no text context and the query is a bare party caption (e.g., State of Maharashtra vs X), the pipeline aborts early with a DOCUMENT_CONTEXT_MISSING exception.
- Logging Tag: [PERSPECTIVE_FINAL], [PERSPECTIVE_OVERRIDE]


Phase 2: Find the Legal Issues
------------------------------
- Responsibility: Analyze the case profile to isolate distinct, actionable legal issues and key facts.
- Mapped Stages:
  * extract_issues.py (Stage 2)
- Under the Hood:
  * Calls Gemini to generate up to 5 issues. If the AI call fails or the budget tracker raises an exception, the system catches the error and falls back to a deterministic bigram extractor in services/issue_service.py.
  * The deterministic fallback mines frequent adjacent word pairs (bigrams) that do not contain procedural/party noise (such as "versus", "writ", "petitioner", "appellant", High Court bench cities, etc.) to coin substantive phrases (e.g. "natural justice").
- AI Involvement:
  * Model: gemini-3.5-flash (or override CITATION_V2_ISSUE_MODEL in .env).
  * Parameters: temperature=0, max_output_tokens=8192.
  * Thinking config: thinking_budget=0 (disabled to prevent reasoning from exhausting output token limits).
  * Prompt: Uses issue_extraction_prompt.
- Inputs & Outputs:
  * Input: Case context text and Normalized represented side.
  * Output: List of IssueCard objects.
- Error Modes: If the Gemini API is down, the deterministic fallback ensures issues are still created, preventing a pipeline crash.
- Logging Tag: [ISSUE_EXTRACT]


Phase 3: Plan the Searches (Query Generation)
---------------------------------------------
- Responsibility: Turn extracted issues and keywords into high-precision search query strings for the Indian Kanoon API.
- Mapped Stages:
  * generate_queries.py (Stage 3)
- Under the Hood:
  * Doctrine Translation: Indian Kanoon only matches verbatim words. Doctrinal descriptors like "Wednesbury Unreasonableness (Tata Cellular line)" never appear in judgments and return zero results. In services/query_service.py, a mapping dictionary DOCTRINE_TO_PHRASES translates doctrines into real judicial phrases (e.g. "so unreasonable that no reasonable authority", "arbitrary and capricious", "cannot resile from").
  * Precision Multi-Term Generation: To prevent single-term queries from matching thousands of off-topic cases, the query generator combines a translated doctrine phrase, a domain anchor (e.g., "blacklisting", "tender") and a narrowing term (e.g., "disqualification") using the ANDD operator.
  * Tiers & Priorities: Queries are categorized into tiers with strict execution priorities:
    * doctrine (Priority 1) - Precision doctrine phrase + narrowing + domain
    * landmark / strict (Priority 2) - Landmark case names + facts
    * supreme_court / statute_combined (Priority 3) - SC-specific / statute filters
    * court_filtered (Priority 4) - High Court doctype filters
    * opponent (Priority 5) - Adverse keyword searches
    * broad_fallback (Priority 6) - ORR-widened query strings
- AI Involvement: None.
- Inputs & Outputs:
  * Input: List of IssueCard objects.
  * Output: List of structured query dicts.
- Logging Tag: [QUERY_GEN]


Phase 4: Search Indian Kanoon (Retrieve Candidates)
----------------------------------------------------
- Responsibility: Execute the planned queries against Indian Kanoon concurrently, respecting API call budgets and removing self-citations.
- Mapped Stages:
  * retrieve_candidates.py (Stage 4)
- Under the Hood:
  * Budget Protection: The budget tracker contains soft (e.g. 10) and hard (e.g. 14) search ceilings. The orchestrator sorts queries by priority and round-robins across issues. Up to the soft budget, all queries run. Beyond the soft budget, only protected priority <= 2 queries (doctrine, landmark, strict) and a reserve of opponent queries are executed. Others are marked skipped: budget_low.
  * API Client: Executes requests concurrently using a thread pool. Stamped with query_priority on returned items.
  * Source Exclusion: In services/exclusion_service.py, any Indian Kanoon document ID (tid) or case title matching the user's uploaded case documents is stripped out to prevent circular citation contamination.
- AI Involvement: None.
- Inputs & Outputs:
  * Input: Prioritized list of query dictionaries.
  * Output: List of Candidate objects.
- Logging Tag: [QUERY_ORDER], [QUERY_SKIP], [EXCLUSION]


Phase 5: Filter for Free
------------------------
- Responsibility: Remove duplicate candidates and perform fast, free text filters to drop off-topic matches.
- Mapped Stages:
  * deduplicate_candidates.py (Stage 5)
  * cheap_filter.py (Stage 6)
  * cheap_prescreen.py (Stage 7)
- Under the Hood:
  * Deduplication: Merges identical candidates by document ID.
  * Cheap Filter: Computes lexical overlap between the legal issue/query and the candidate's title and headline. Candidates retrieved by priority <= 2 queries are protected. Other candidates must have a headline overlap score >= 0.12 or a query phrase overlap >= 2, or they are discarded.
  * Cheap Prescreen: Discards candidates that are too old (based on prescreen_max_age_years, unless they are landmark or potentially adverse). Checks court relevance: candidates must be from the Supreme Court, a preferred High Court, or another High Court. It also runs a regex search for adverse keywords (e.g., "dismissed", "rejected") to tag candidates as potentially_adverse so they are protected for the opponent bundle.
- AI Involvement: None.
- Inputs & Outputs:
  * Input: List of Candidate objects (approx. 80).
  * Output: Filtered list of Candidate objects (approx. 15-20).
- Logging Tag: [FILTER], [PRESCREEN_SUMMARY]


Phase 6: Read the Survivors (Fetch Full Text)
---------------------------------------------
- Responsibility: Excerpt candidate documents, shortlist the best ones, and fetch complete judgment text.
- Mapped Stages:
  * enrich_fragments.py (Stage 8)
  * shortlist_candidates.py (Stage 10)
  * fetch_full_documents.py (Stage 11)
- Under the Hood:
  * Fragment Enrichment: Fetches short snippets/headlines for candidates.
  * Shortlisting: Sorts candidates based on lexical scores and keeps only the top ~7 to control downstream LLM token costs.
  * Database Cache: Before making a paid call to fetch the full document, fetch_full_documents.py queries ik_asset_get in db/client.py. This reads from the PostgreSQL ik_document_assets table. If the document exists in the database and is longer than 500 characters, it is loaded locally (cache hit). If not, it is fetched from the Indian Kanoon API and upserted via ik_asset_upsert to cache it for future runs.
- AI Involvement: None.
- Inputs & Outputs:
  * Input: Filtered list of candidates.
  * Output: Shortlist of 7 candidates with complete full_text populated.
- Logging Tag: [PIPELINE] fetch_full_documents


Phase 7: Judge Each One
-----------------------
- Responsibility: Detect who won the case (operative outcome) and evaluate the legal holding against the client's perspective.
- Mapped Stages:
  * detect_disposition.py (Stage 12)
  * final_ai_judge.py (Stage 13)
- Under the Hood:
  * Disposition Detection (disposition_service.py): Operates on the tail of the document, as Indian judgments put the final orders at the end.
    * Step 1 (Regex): Searches the tail 15% (or starting from operative anchors like "in the result", "it is ordered") for explicit allowed or dismissed phrases.
    * Step 2 (Gemini Fallback): If regex confidence is < 0.70, the engine calls Gemini 3.5 Flash on the tail 4000 characters to extract the outcome.
    * Step 3 (Reconciliation): Merges regex and Gemini opinions.
  * Final AI Judge (evaluator.py): Sends a batch of the 7 candidates (including their titles, tail windows, and disposition outputs) to Gemini. Gemini classifies each candidate as SUPPORTING, ADVERSE, or CAUTION.
  * Disposition Veto: Post-Gemini, the orchestrator applies apply_disposition_veto. If the disposition has a confidence >= 0.70 (e.g. petition was dismissed) and contradicts the AI judge's classification, the disposition veto overrules the AI (e.g., changing it from supporting to adverse).
- AI Involvement:
  * Model: gemini-3.5-flash
  * Inputs: Candidate summaries + holding tail window.
  * Output: JSON object containing classification, reason, and risks for each document.
- Logging Tag: [DISPOSITION], [JUDGE] disposition veto


Phase 8: Sort, Clean & Explain (Relevance Gate)
-----------------------------------------------
- Responsibility: Place citations into buckets, sort by relevance, write usage memos, and prune off-topic matches.
- Mapped Stages:
  * classify_results.py (Stage 14)
  * generate_usage_analysis.py (Stage 15)
  * build_report.py (Stage 16)
- Under the Hood:
  * Rerank (rerank_service.py): Performs arithmetic sorting on each bucket without AI costs using a weighted scoring formula:
    Score = Recency * 0.25 + Court Hierarchy * 0.25 + Doctrine Coverage * 0.30 + Outcome Alignment * 0.15 + Citation Boost * 0.05
  * Usage Analysis (analysis_service.py): One batched Gemini call generates 500-600 word usage memos (divided into 4 sections) for the active citations, plus an honest relevance verdict (RELEVANT, ADVERSE, PARTIALLY_RELEVANT, NOT_RELEVANT).
  * Relevance Gate: Cleans the buckets based on the relevance verdict:
    * NOT_RELEVANT -> Discarded.
    * ADVERSE -> Reclassified and moved to the Adverse bucket.
    * PARTIALLY_RELEVANT in Recommended -> Demoted to Caution.
- AI Involvement:
  * Model: gemini-3.5-flash
  * Output: JSON array with structured sections and relevance verdicts.
- Inputs & Outputs:
  * Input: Classified candidate buckets.
  * Output: Cleaned and sorted list of Recommended, Adverse, and Caution citations, along with their usage memos and diagnostics.
- Logging Tag: [RELEVANCE_GATE], [QUERY_BUDGET_WARN]

---

--------------------------------------------------------------------------------
4. Key Data Abstractions
--------------------------------------------------------------------------------

Three primary data models travel through the pipeline:

1. PipelineContext
   - Purpose: The state tray passed through every stage.
   - Key Fields:
     * run_id (string)
     * query (string)
     * perspective (string)
     * case_context (string)
     * issues (list of IssueCard)
     * queries (list of query dicts)
     * candidates (list of Candidate)
     * shortlisted (list of Candidate)
     * rejected (list of Candidate)
     * budget (BudgetTracker instance)

2. IssueCard
   - Purpose: Represents a single extracted legal issue.
   - Key Fields:
     * issue_id (string)
     * legal_issue (string)
     * statutes (list of strings)
     * must_have_terms (list of strings)
     * phrase_terms (list of strings)
     * doctrines (list of strings)
     * landmark_cases (list of strings)
     * preferred_courts (list of strings)

3. Candidate
   - Purpose: Represents a single judgment candidate.
   - Key Fields:
     * doc_id (string)
     * title (string)
     * full_text (string)
     * classification (Classification enum)
     * disposition (Disposition enum)
     * winning_party (string)
     * relevance_verdict (string)
     * usage_analysis (list of sections)

---

--------------------------------------------------------------------------------
5. Logging & Audit Reference
--------------------------------------------------------------------------------

Operators can grep the application log using these structured tags:

+==================+==============================+==========================================================+
| LOG TAG          | EMITTED BY                   | MEANING / USE CASE                                       |
+==================+==============================+==========================================================+
| [QUERY_GEN]      | services/query_service.py    | Shows translation of doctrines to verbatim query terms.  |
+------------------+------------------------------+----------------------------------------------------------+
| [QUERY_ORDER]    | stages/retrieve_candidates.py| Lists priority sequence and number of queries by type.   |
+------------------+------------------------------+----------------------------------------------------------+
| [QUERY_SKIP]     | stages/retrieve_candidates.py| Logs skipped queries due to soft/hard budget limits.     |
+------------------+------------------------------+----------------------------------------------------------+
| [EXCLUSION]      | stages/retrieve_candidates.py| Shows user source document IDs filtered from results.    |
+------------------+------------------------------+----------------------------------------------------------+
| [DISPOSITION]    | services/disposition_service | Shows outcome detection results and confidences.         |
+------------------+------------------------------+----------------------------------------------------------+
| [JUDGE]          | stages/final_ai_judge.py     | Logs corrections triggered by the disposition veto.     |
+------------------+------------------------------+----------------------------------------------------------+
| [RELEVANCE_GATE] | stages/generate_usage_analysis| Logs drops, demotions, and adverse moves.                |
+==================+==============================+==========================================================+

---

--------------------------------------------------------------------------------
6. Troubleshooting Common Failure Modes
--------------------------------------------------------------------------------

1. Zero Citations Returned
   - Cause: The input document was truncated to a cover page/snippet, yielding only party names that got filtered out as caption noise, leading to 0 results.
   - Fix: Verify substantive_term_count in the logs. Ensure the document service extracts and sends the full text, not just the cover sheet.

2. High Priority Queries Skipped
   - Cause: Budget exhaustion during complex runs with many issues.
   - Fix: Adjust configuration values in .env:
     * Increase max_ik_search_calls or ik_search_soft_budget.
     * Decrease the number of issues analyzed by limiting CITATION_V2_ISSUE_MAX_TOKENS.

3. Flipped Recommendations (Supporting labelled as Adverse)
   - Cause: The represented side failed to autocorrect.
   - Fix: Check represented_side in the log audit. Ensure the source case document has standard petitioner/respondent cues. If necessary, explicitly set the side from the UI instead of relying on neutral mode.
