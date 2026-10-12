# Large documents: a 2,000-page upload in 2–3 minutes

How the agentic-document-service (port 8092) processes a big PDF, what was changed
on 2026-09-28 to make a 2,000-page file finish in the time a user will wait, the
measured numbers, and the knobs.

## Where the time went before

A 2,000-page scanned PDF took well over the 10-minute per-document timeout:

| Stage | Before | Why |
| --- | --- | --- |
| Document AI OCR | 134 requests of 15 pages, 8 in flight, each response ~18 MB | page images came back with every page; the online limit with images is 15 pages |
| Text cleaning | ~30 s CPU | `normalize_ocr_artifacts` ran ~40 regex passes, six times over the text |
| Born-digital PDFs | same as scanned | every page went to Document AI even when the PDF already carried its text |
| Plan check | rejected | `DEFAULT_MAX_DOCUMENT_PAGES=400` |
| Chunk persistence | one connection, 20 sequential statements | remote database, round-trip bound |
| OCR-structure persist | on the critical path (joined before "completed") | tens of MB of JSON written twice (`raw_response` + `structured_schema`) |

## What runs now

```
upload ──► complete-upload (plan check) ──► queue ──► _process_and_finalize_document
                                                            │
        ┌───────────────────────────────────────────────────┘
        ▼
  1. Route pages          app/services/adapters/pdf_pages.py   (PyMuPDF, ~1–3 s / 2,000 pages)
       text layer ─► read locally (blocks / paragraphs / lines with boxes)
       scanned    ─► contiguous ranges of ≤30 pages
  2. OCR ranges           app/services/adapters/ocr.py         (Document AI, imageless, 24 in flight)
  3. Merge in page order  ─► [PAGE n] stamps ─► chunks (≈1 per page) ─► embeddings (16 calls in flight)
  4. Persist              file_chunks + chunk_vectors in 250-row slices, 4 connections per document
     side-writes          extracted-text upload (joined) · OCR structure (background, not joined)
```

### 1. Page routing (`pdf_pages.py`)

Every page is classified from its own text layer with PyMuPDF (MuPDF, C):

* **text_layer** – at least `PDF_TEXT_LAYER_MIN_CHARS` (40) characters and no image
  covering `PDF_TEXT_LAYER_IMAGE_AREA_RATIO` (50 %) of the page → read locally.
  This is what Document AI's `enable_native_pdf_parsing` does server-side, minus
  the round trips and the per-page bill.
* **image_dominated** – a scan, even with a thin text layer (scanner OCR, Bates
  stamps) → Document AI, because its OCR is better than whatever put that layer there.
* **too_little_text** → Document AI. **blank** (no text, no image) → kept empty, not billed.

`PDF_TEXT_LAYER_MODE=off` restores the old behaviour (every page to Document AI).
The structured page produced locally uses the same schema as Document AI pages
(`pageNumber`, `dimension`, `text`, `blocks`, `paragraphs`, `lines`, `tables`) plus
`source: "pdf_text_layer"`, so the OCR viewer renders both alike.

### 2. Document AI requests (`ocr.py`)

* `imageless_mode=True` on every `ProcessRequest`: nothing downstream reads page
  images. Measured on 15 scanned pages: response 17.8 MB → 0.78 MB, latency 12.4 s → 8.1 s.
* 30 pages per request (verified live: a 30-page imageless request is accepted by
  `pretrained-ocr-v2.1-2024-08-07`). With images the adapter clamps to 15.
* Only the ranges that need OCR are split (MuPDF `insert_pdf`, 0.3 s for 134 batches)
  and sent, `OCR_PARALLEL_WORKERS` at a time per document, gated globally by
  `DOCUMENT_AI_MAX_CONCURRENT_REQUESTS`. 429/5xx retry with backoff, slot held.
* A range whose request fails after retries keeps its pages (empty, or whatever
  text layer it had) with `source: "ocr_failed"` instead of dropping them.
* Results are interleaved back into page order; `structured_json.routing` records
  `text_layer_pages`, `ocr_pages`, `ocr_requests`, `reasons`, `missing_pages`.

### 3. Cleaner (`document_ai.normalize_ocr_artifacts`)

Same output, ~4× faster (5.6 s → 1.5 s per pass over 6 MB): each phrase-fix regex
runs only when a plain substring test says it can match, and the dictionary rejoiner
skips fragments that cannot begin an accepted word. `tests/test_ocr_cleaner_fast.py`
holds the new code byte-for-byte to the original algorithm.

### 4. Persistence (`pipeline_service.py`)

* `file_chunks` / `chunk_vectors`: 250-row upserts, several slices on separate
  connections at once (4 per document, 8 process-wide). Vectors are written with
  6-decimal floats (40 % of the bytes of `repr`).
* `document_ai_extractions`: the structured layout is serialised once; the
  `raw_response` copy is only written while it is ≤ `OCR_STRUCTURE_RAW_COPY_MAX_MB` (4).
  The write runs in the background and no longer delays "completed" — readers
  (OCR viewer, chronology page stamps) read it lazily or already hold the stamped text.
* Embeddings: `EMBEDDING_MAX_CONCURRENT_REQUESTS` (16) sub-batches in flight.

## Measured (2026-09-28, local machine → us Document AI, synthetic 2,000-page files)

| File | Extraction | Chunks | Embedding | Notes |
| --- | --- | --- | --- | --- |
| 2,000 pages born-digital, 3 MB | **5.5 s** (0 OCR requests) | 2,332 in 0.15 s | 16.0 s | 21.7 s end to end without DB writes |
| 2,000 pages scanned, 218 MB | **114.8 s** (67 requests, 24 in flight) | 2,312 in 0.23 s | ~16 s (same chunk count) | Document AI throughput ≈ 18–20 pages/s at this concurrency |

Add ~10–30 s for chunk persistence against the remote database and the text upload.
Document AI bills per page ($0.0015 → $3 per 2,000 scanned pages); born-digital
pages now cost nothing.

## Knobs (`app/core/config.py`, env-overridable; current `.env` values in brackets)

| Setting | Default | Meaning |
| --- | --- | --- |
| `PDF_TEXT_LAYER_MODE` | `hybrid` | `off` sends every page to Document AI |
| `PDF_TEXT_LAYER_MIN_CHARS` | 40 | below this a page goes to OCR |
| `PDF_TEXT_LAYER_IMAGE_AREA_RATIO` | 0.5 | image coverage that marks a page as a scan; 0 disables |
| `DOCUMENT_AI_IMAGELESS_MODE` | true | omit page images from responses |
| `DOCUMENT_AI_PAGE_LIMIT` | 30 | pages per request (clamped to 15 when imageless is off) |
| `OCR_PARALLEL_WORKERS` | 24 | requests in flight per document |
| `DOCUMENT_AI_MAX_CONCURRENT_REQUESTS` | 24 | requests in flight process-wide |
| `EMBEDDING_MAX_CONCURRENT_REQUESTS` | 16 | embed calls in flight per document |
| `OCR_STRUCTURE_RAW_COPY_MAX_MB` | 4 | above this `raw_response` is left NULL |
| `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` | 600 [900] | per-document safety net |
| `DEFAULT_MAX_DOCUMENT_PAGES` | 400 [2500] | plan fallback; DB plan rows override |
| `DEFAULT_MAX_DOCUMENT_SIZE_MB` | 40 [300] | plan fallback; DB plan rows override |

If Document AI starts returning 429s at 24 in flight, lower
`DOCUMENT_AI_MAX_CONCURRENT_REQUESTS` or raise the project's online-request quota
in the GCP console; the adapter retries with backoff either way.

## Tests

```
.venv/Scripts/python.exe -m unittest tests.test_pdf_pages tests.test_ocr_hybrid \
    tests.test_ocr_cleaner_fast tests.test_persist_chunks tests.test_chunk_pages
```

`test_ocr_hybrid` fakes Document AI and checks the requested ranges, page order,
sources, failure handling, mode `off`, and progress reporting.

## Still on the list

* `complete-upload` downloads the whole PDF to count pages for the plan check; for a
  200 MB scan that is a few seconds before the file is even queued.
* The OCR viewer's page-window route reads the entire `structured_schema` JSON per
  request; for a 2,000-page file that is tens of MB per page turn.
* PyMuPDF requires `pymupdf` (in `requirements.txt`); the `fitz` alias is deprecated.
