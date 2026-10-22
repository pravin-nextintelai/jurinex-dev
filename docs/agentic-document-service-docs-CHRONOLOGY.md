# Case chronology

Chronology is built by the **same** `form_population_agent` call that auto-fills the Create Case form. There is no second chronology agent and no second read of the PDF. Extra cost is **output tokens** (plus whatever extra **input** is needed when a large paper book is sent in full instead of a prefix).

Admin row: Super Admin → Agent Prompt Management → **`form_population_agent`**. In this workspace that is **`gemini-3.7-flash`**, temperature **0.3**, **`thinking_level=low`**. See [AUTO_FILL.md](AUTO_FILL.md).

## What the API returns

One tree per **case/folder** (not per file). Unique calendar dates, grouped by litigation phase:

```json
{
  "dates": [
    {
      "date": "2019-01-15",
      "displayDate": "15 Jan 2019",
      "precision": "day",
      "phase": "pre_litigation",
      "summary": "The agreement was executed at Pune. Possession was handed over the same day.",
      "events": [
        {
          "title": "Agreement executed",
          "particulars": "The agreement was executed at Pune.",
          "eventType": "agreement",
          "sourceDocument": "plaint.pdf",
          "sourceQuote": "The agreement was executed on 15 January 2019 at Pune.",
          "forum": "Civil Court Pune",
          "caseNumber": "Special Civil Suit 12/2019",
          "sourcePage": "4",
          "exhibit": "Exh. 12",
          "sourceRole": "admitted",
          "disputed": false
        }
      ]
    }
  ],
  "phases": [
    { "id": "pre_litigation", "label": "Pre-litigation", "dates": ["…"] }
  ],
  "sourceDocuments": ["plaint.pdf"],
  "eventCount": 1
}
```

`summary` is 1–5 sentences, built in **Python** from grounded event particulars (not a free-form model essay). The UI prints that day summary **only when two different happenings share the date**; a single event is shown once (title + particulars + quote + pin cite).

### Event fields

| Field | Meaning |
|---|---|
| `title` / `particulars` | What happened; facts only |
| `eventType` | `agreement`, `notice`, `reply`, `payment`, `breach`, `filing`, `transfer`, `hearing`, `order`, `judgment`, `affidavit`, `evidence`, `communication`, `other` |
| `sourceQuote` | Verbatim OCR span (≥12 chars) that grounds the event |
| `forum` | Court or authority as written |
| `caseNumber` | Proceeding number as written (`Dispute 88/2012`, `W.P. 8895/2014`, …) |
| `sourcePage` | Paper-book page(s), attached in Python from `[PAGE n]` stamps — not guessed by the model |
| `exhibit` | Exhibit mark if written |
| `sourceRole` | `petitioner` (pleaded case) · `respondent` · `official` (GR / Gazette / municipal record) · `impugned` (instrument under challenge) · `court` (order or court-recorded fact only) · `admitted` (opposite party actually admits) · `disputed` |
| `disputed` | `true` when parties assert mutually exclusive versions of the same fact |

`precision` is `day`, `month`, or `year`. Year-only dates display as “exact day not on record”.

### Phases

`pre_litigation` → `correspondence` → `institution` → `pending` → `pleadings` → `interim` → `evidence` → `listing` → `hearing` → `order` → `appeal` → `execution` → `other`

A letter between parties is `communication` + **`correspondence`**, never `pleadings`. After a writ/suit is already before the court, later administrative steps (Gazette, objections, s.31 notification) are **`pending`** (“Pending litigation”), not `pre_litigation`. Python remaps that when the OCR contains a High Court / writ `order dated …` (or a grounded court-proceeding event) earlier than the administrative date.

## Anti-hallucination (grounding)

An LLM event is **dropped** unless all of these pass:

1. `date` parses (Indian documents: **DD/MM/YYYY** first). Invalid calendars such as `31.04.2011` never enter.
2. `sourceQuote` is at least 12 characters and appears in the OCR (whitespace-normalised).
3. A written form of that date also appears in the OCR (`15 Jan 2019`, `15/01/2019`, `2019-01-15`, …).

Invented dates, empty quotes, and “typical” facts never enter the tree.

Year-only keys (`2014`) are allowed when the document states the year but not the day. Fully invented undated events are still dropped.

## Coverage and quality (same LLM call)

Python runs **after** the model, on the full OCR (not only what was packed for the prompt):

1. **Page stamps.** Document AI pages are rewritten as `[PAGE n]` + page body before extract. Pin cites are the pages whose body contains the quote (preferring pages that also carry the event date).
2. **Extract window.** Budget is **900,000 characters** (~220k tokens; Gemini 3.7 Flash is 1M). Typical 100-page writs fit in full. Larger files keep dated and procedural pages, plus the opening and closing pages — not a first-80k prefix cut.
3. **OCR majority vote.** Same day+month with conflicting years: the year that appears at least twice and more often than the others wins. Example: `07.12.2012` vs three `07.12.2010` readings → **7 Dec 2010**, and the quote is swapped for a verbatim span that contains the majority date. Different days (`21.04.2011` vs `24.4.2011`) are not merged. Invalid dates never win.
4. **Procedural history** is requested in the same JSON: verbs such as *filed, transferred, renumbered, preferred, disposed, remanded*, including year-only entries.
5. **Legal instruments stay un-collapsed.** A resolution date is not the Gazette publication date. If a resolution and a corrigendum sit a few days apart, look for a Gazette publication **between** them (e.g. 08.08 / 10.08 / 25.08.2022). A plan “dated 07.03.2024” is not “published inviting objections” unless the document says so that day. Sanction of an earlier DP, connected High Court orders (“We have perused the order dated X”), and “stand over to” listings are separate events. A sentence that lists several representation dates is one event per date.
6. **Institution dates:** prefer `Received on` / `Registered on` over an advocate verification block (`DATE: … / Advocate for …` is “writ verified”, not “filed”).
7. **Party role:** petition averments are `petitioner`; GRs/Gazettes are `official` (not `admitted`); court orders are `court`; the instrument under challenge is `impugned`. Python remaps over-labels (gazette tagged “admitted”, s.31 notification tagged “court finding”).
8. **Land units:** copy 69 R as written. If the model emits `0.69 R` while OCR has `69 R` (ares), Python rewrites title/particulars only — the quote stays verbatim.
9. **Pending litigation:** after the first grounded High Court / writ order (or an OCR `order dated` next to W.P. / High Court), later `pre_litigation` day-events become `pending`. DP/s.31 “order dated” lines are not treated as the start of the writ.
10. **Place names:** a locality in title/particulars that is absent from the OCR is replaced with the spelling the OCR actually uses (`Himayatnagar` → `Himayat Baug`).
11. **Stand-over vs hearing:** “stood over / next date / listed on” is phase `listing` (“Listing / stand-over”), never a hearing that is proved to have happened. A verification / “solemnly affirm” block is never phase `institution`.

## OCR sweep — recall that does not drift

The model's recall varies run to run: an impugned notification or a Gazette publication can be extracted on one call and skipped on the next. Statutory events are written in fixed language, so **Python finds them itself** in `app/services/chronology/sweep.py` and adds any whose date is not already on the tree.

| Rule | Matches | Event |
|---|---|---|
| `impugned_notification` | `impugned … notification`, `section 31(1)` | Government notification under s.31 (role `impugned`) |
| `court_order` | `order dated` / `perused the order` near W.P. / High Court | Order of the High Court |
| `dp_sanction` | `sanction` + development plan / s.31 | Development Plan sanctioned |
| `gazette_publication` | `Gazette` + `publish` / `notified` | Published in the Official Gazette |
| `corrigendum` | `corrigendum` | Corrigendum issued |
| `representation` | `representation … dated` | Representation submitted (one event per date in a list) |
| `resolution` | `Resolution No.` | Resolution passed |

The date is attributed to the **anchored date nearest the matched keyword**, so “Resolution 2648 dated 08.08.2022 … published in the Gazette on 10.08.2022” yields two events, not two copies of one date. A list (`02.02.2024, 09.07.2024 and 29.08.2024`) yields one event per date.

Swept events are **not** model guesses: the title comes from the rule, and the particulars and quote are copied verbatim from the OCR sentence. They pass the same grounding gate and get the same pin cites. Dates the model already covered are skipped, so nothing is duplicated. The sweep also runs inside `refresh_tree_against_source`, so **`extract-case-fields` can add missing statutory dates to a stored tree with no LLM call**. Cost is ~12 ms per 150k characters.

`extract-case-fields` re-runs the LLM when the form is thin, the tree is empty, **or** events are missing pin cites while stamped OCR is available. After merge it also **refreshes** the stored tree (vote + pin cites) against current OCR with no extra LLM.

## No repeat dates

Python merge uses `date` as the unique key:

- `15/01/2019`, `15 Jan 2019`, and `2019-01-15` become **one** node.
- Two different happenings on the same day become two `events` under that node.
- Duplicate titles on the same day are ignored (same event seen in two PDFs).

Month-only (`2019-01`) and year-only (`2019`) keys stay separate from a full day.

## Intake vs later files

- Every document in a `temp-*` intake folder is extracted. Form fields are **first-wins**; events **always merge**.
- On `POST /api/files/create`, the temp-folder tree is rebound to the real `cases.id`.
- Files uploaded later onto an **existing** (non-`temp-*`) case are **not** auto-merged today. Use `POST /api/files/{folder}/extract-case-fields` to rebuild from combined OCR.

## UI

Case-level, once in the Files header (not on each document card):

- Timeline earliest → latest, phase as a badge, pin cite `p. N · Exh. … · forum · case number`
- **Disputed** / source-role badges
- Download PDF is **jsPDF from the tree** (no html2canvas). Print uses a popup.

Frontend: `frontend/src/components/Chronology/`, `frontend/src/hooks/useChronology.js`, `frontend/src/services/chronologyApi.js`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/files/{folderName}/extract-case-fields` | Form fields + `chronology` (and `extractedData.chronology`) |
| `GET` | `/api/files/{folderName}/chronology` | Tree only |
| `GET` | `/api/files/cases/{caseId}` | Case payload includes `chronology` |

## Database

Migration: `db/migrations/163_create_case_chronology_table.sql`

```bash
cd Backend/agentic-document-service/db
# DATABASE_URL must be set
node migrate.js
```

Missing table does not fail upload; persist is best-effort and logged as a warning.

## Console logs

Component **`AutoFill`** (`app/services/chronology/console.py`). Boxed tables start at column 0 so borders do not wrap under MODEL.

On each extract:

1. Progress bars — read OCR → send to the model → keep grounded dates → OCR vote + pin cites → merge
2. Notes when `[PAGE n]` stamps are present, and a sentence for what was sent (all pages vs packed)
3. **IN PLAIN LANGUAGE** — chars, pages, kept/dropped, OCR year corrections, pin cites, date span
4. Token / cost table
5. **WHY EVENTS WERE DROPPED** (human reasons: “quote not found in the OCR”)
6. **OCR MAJORITY VOTE** table when a year was corrected
7. **TIMELINE** with page pin cites, then the phase tree (`07 Dec 2010  p.100  …`)

```
[AutoFill] [########--------]  2/5   40%  Send OCR to form_population_agent
[AutoFill] Sent every page (102 · 519,072 chars). Fits under the 900,000 character cap.
```

## Code layout

| File | Role |
|---|---|
| `app/services/chronology/prompt.py` | Extra JSON instructions appended to auto-fill |
| `app/services/chronology/dates.py` | Parse / unique keys / source variants |
| `app/services/chronology/grounding.py` | Quote + date must exist in OCR |
| `app/services/chronology/pack.py` | 900k budget; dated/procedural pages if larger |
| `app/services/chronology/pages.py` | `[PAGE n]` stamps and pin cites |
| `app/services/chronology/corroborate.py` | Majority vote on OCR date variants |
| `app/services/chronology/sweep.py` | Statutory dates the model missed, found in the OCR |
| `app/services/chronology/extract.py` | Coerce LLM JSON → grounded events; land-unit rewrite; pending-phase retag; refresh stored tree |
| `app/services/chronology/merge.py` | Unique dates, summaries, phase tree |
| `app/services/chronology/console.py` | Progress bars and boxed reports |
| `app/services/chronology/persist.py` | `case_chronology` table |
| `app/services/chronology/service.py` | Called from `folder_service` |
| `app/schemas/chronology.py` | Response models |

OCR page stamps are applied in `app/services/pipeline_service.py` when Document AI returns structured pages.

## Tests

```bash
cd Backend/agentic-document-service
python -m unittest tests.test_chronology_dates tests.test_chronology_merge tests.test_chronology_console tests.test_chronology_quality
```

## Re-running after a quality change

Existing stored trees do not update by themselves. Re-run **Extract case fields** on the folder (or re-upload into a `temp-*` intake). If events still lack `p. N` and stamped OCR is in `document_ai_extractions`, that endpoint rebuilds once so later pages, majority dates, and pin cites land on the tree.
