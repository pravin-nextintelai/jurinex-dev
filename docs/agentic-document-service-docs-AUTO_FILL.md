# Auto-fill (form population)

Create Case upload fills the intake form from OCR text using **one LLM call** per document, via `form_population_agent`. The same call returns grounded chronology `events[]` — there is no second agent reading the PDF.

## Which admin row

Super Admin → **Agent Prompt Management** → **Summarization Agents** → **`form_population_agent`**.

That row’s model is what `_generate_text(..., agent_name="form_population_agent")` uses. In this workspace it is **`gemini-3.7-flash`** at temperature **0.3**. Auto-fill always sends **`thinking_level=low`** for this agent only (`gemini-3.7-flash` does not support `minimal`; Low / Medium / High only). Other agents are not changed by this path.

Resolution order if the row is missing:

1. `public.agent_prompts` (`agent_type` intake / form_population)
2. `ADK_MODEL` in `.env`
3. hardcoded `gemini-2.5-pro`

## Pipeline

1. Google **Document AI** OCRs the file (not an LLM).
2. If structured pages exist, OCR text is stamped `[PAGE n]` before it is stored (so pin cites are real paper-book pages). See [CHRONOLOGY.md](CHRONOLOGY.md).
3. Text is chunked and embedded (`gemini-embedding-001`).
4. For intake folders (`temp-*`), `FolderWorkflowService._merge_extracted_case_data` calls `DocumentAIAdapter.extract`.
5. Extract packs OCR (`pack_for_extraction`, budget **900,000 characters**) and sends `_EXTRACTION_PROMPT` + chronology block through `form_population_agent`. Typical 100-page writs fit in full. Larger files keep dated and procedural pages instead of truncating after the first 80k.
6. JSON form fields are first-wins merged into `_extracted_by_case`.
7. The same JSON’s `events` array is grounded, OCR years are majority-voted, pin cites are attached, and unique dates are merged (see [CHRONOLOGY.md](CHRONOLOGY.md)).
8. `POST /api/files/{folderName}/extract-case-fields` returns `extractedData` (form fields + `chronology`). It re-runs the LLM when the form is thin, chronology is empty, or events are missing pin cites while stamped OCR is available.

Only `temp-*` folders auto-extract on each upload. Files added later to an existing case need `extract-case-fields` (or a new intake) to merge chronology.

## Form fields

`caseTitle`, `caseNumber`, `caseType`, `courtName`, parties, `filingDate`, and the other camelCase keys in `_EXTRACTION_PROMPT`. Unknown keys are dropped by `_normalize_entities` except chronology, which is handled separately.

If the LLM returns nothing, a regex fallback tries case number, `X vs Y`, dates, and court name.

## Cost

One `form_population_agent` call per intake document. Chronology is extra **output** in that same JSON. Sending a full ~500k-character OCR (instead of an 80k prefix) increases **input** tokens; there is still no second chronology pass over the PDF.

## Logs

Confirm the model:

```
[DocumentAI] LLM IN USE  provider=gemini  model=gemini-3.7-flash  agent=form_population_agent
```

The extract itself is logged on component **`AutoFill`**: progress bars, what was sent to the model, **IN PLAIN LANGUAGE**, token/cost table, dropped-event reasons, OCR majority vote, and a timeline with pin cites. Details: [CHRONOLOGY.md](CHRONOLOGY.md#console-logs).
