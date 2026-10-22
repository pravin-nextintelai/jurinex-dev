# Citation Pipeline V2

## Purpose

Citation Pipeline V2 is the active, side-aware, cost-controlled citation flow. The previous proposition pipeline remains in `legacy_pipeline.py` and can be selected with `CITATION_PIPELINE_VERSION=legacy`.

## Architecture

```text
POST /citation/report or /citation/report/start
  -> one run_id + selected perspective
  -> case profile -> 3-5 issue cards -> 2 queries per issue
  -> Indian Kanoon search (one page/query, max 10)
  -> deduplicate -> conservative cheap filter
  -> balanced fragments + metadata across all issues (max 20 each)
  -> deterministic relevance/favorability/authority/risk scoring
  -> shortlist max 7 -> cache-aware full documents max 7
  -> optional single Gemini batch judge
  -> supporting/adverse/caution classification
  -> backward-compatible report + persistence + cost/telemetry
```

## Cost Controls

Default maximum paid IK operations per run:

| Operation | Limit | Default INR/call | Maximum INR |
|---|---:|---:|---:|
| Search | 10 | 0.50 | 5.00 |
| Fragment | 20 | 0.05 | 1.00 |
| Metadata | 20 | 0.02 | 0.40 |
| Full document | 7 | 0.20 | 1.40 |

The default IK maximum is approximately **INR 7.80 per run**, before the optional single batch AI call. `CITATION_V2_MAX_COST_INR` defaults to INR 25. Cache hits do not create IK document usage rows. V2 does not use Gemini grounding per candidate and does not run AI per raw result.

The old approximately INR 269 estimate was a credible worst-case estimate for the previous call pattern, not the cost of a single citation click. V2 removes that pattern from the active pipeline.

## Relevance Protections

- Perspective is propagated into profile, issues, scoring, judge prompt, and report.
- Every candidate has a `matched_issue_id`.
- Rejected candidates are never restored as fallback.
- Empty reliable results return `No reliable supporting citation found in this run.`
- Full documents are fetched only for candidates that passed cheap filtering, enrichment, scoring, and shortlisting.
- Output is capped at 5 supporting, 3 adverse, and 3 caution citations.
- Citations are review suggestions and are never automatically marked verified.

## Logging

`core/logging.py` configures rotating JSON logs:

- `logs/application.log`: API requests, stage events, counts, timings.
- `logs/error.log`: errors and stack traces.
- `logs/debug.log`: issue cards, queries, scores, and rejection decisions.
- `logs/audit.log`: run, user, report, cost, and report-generation events.

Every pipeline stage emits `START_STAGE`, `END_STAGE`, input/output counts, and duration. API middleware logs request/response metadata for every endpoint.

## API Compatibility

`/citation/report` and `/citation/report/start` are unchanged. New report fields are additive:

- `recommended_citations`
- `adverse_citations`
- `use_with_caution`
- `case_profile`
- `issue_cards`
- `queries`
- `cost_summary`
- `timings`

The existing `citations` array remains available and contains the capped combined result.

## Environment

See `.env.example`. Important flags are `CITATION_PIPELINE_VERSION`, operation budgets, `CITATION_V2_MAX_COST_INR`, runtime limit, and the optional batch judge toggle.

## Tests

```bash
pytest tests/unit/test_pipeline_v2.py -q
python3 -m unittest discover -s tests/unit -p 'test_pipeline_v2.py' -v
```

Tests cover perspective propagation, petitioner/respondent issue cards, query limits, multi-issue evaluation, conservative filtering, no fallback, adverse separation, operation budgets, full-document limits, and single run-ID propagation.

## Before vs After

| Concern | Legacy active path | V2 active path |
|---|---|---|
| Perspective | Hardcoded `all` | Propagated end to end |
| Queries | About 17-21, often two pages | 6-10, one page |
| Full documents | Up to 60 before filtering | Max 7 after scoring |
| AI | Per-candidate/multiple grounding calls | Optional one batch call |
| Rejected fallback | Returned raw citations | Never returned |
| Run ID | Async outer/inner mismatch | One run ID |
| Classification | Mostly undifferentiated | Supporting/adverse/caution |
| IK cost envelope | Potentially very high | Approx. INR 7.80 default max |

## Known Limitations

- Deterministic issue extraction and favorability scoring are conservative heuristics; the optional batch judge improves nuance but legal review remains required.
- Existing database tables are reused, so detailed provider cost fields are stored through the current usage schema and metadata rather than a new migration.
- Live provider behavior and real costs require integration tests with configured credentials and PostgreSQL.
