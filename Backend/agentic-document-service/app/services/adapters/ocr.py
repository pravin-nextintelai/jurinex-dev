"""
Google Cloud Document AI text extraction with parallel page-batch processing.

Document AI has a per-request page limit (default 15 pages for online processing).
For larger documents the PDF is split into batches, each batch is sent to Document AI
in parallel via a ThreadPoolExecutor, and the results are merged in page order.

Progress is reported to the caller via an optional progress_callback(pct: float)
callable where pct is the document-level processing percentage (0-100).

Falls back to pypdf for PDFs and raw UTF-8 decode when Document AI is unavailable.
"""
from __future__ import annotations

import io
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger("agentic_document_service.document_ai_ocr")

# Document AI online-processing page limit per request: 15 pages with page images,
# 30 in imageless mode (verified live against pretrained-ocr-v2.1: a 30-page
# imageless request is accepted, and the response shrinks ~20x — 17.8 MB -> 0.8 MB
# for 15 scanned pages — because page images are left out). Override with the
# DOCUMENT_AI_PAGE_LIMIT setting / env var.
_DEFAULT_PAGE_LIMIT = 30
_PAGE_LIMIT_WITH_IMAGES = 15
# Workers used to send page batches to Document AI in parallel. A 2,000-page scan
# is 67 imageless requests of ~14 s each; 24 in flight finishes it in ~3 waves.
_DEFAULT_OCR_WORKERS = 24
# Hard per-request deadline for one Document AI process call (a batch is ≤15
# pages). Without it a stalled RPC blocks its worker thread indefinitely and the
# whole upload batch reads as stuck; with it the batch fails fast and the pypdf
# fallback still yields text.
_DOCAI_REQUEST_TIMEOUT_S = 240.0


def _settings():
    try:
        from app.core.config import get_settings
        return get_settings()
    except Exception:
        return None


def _imageless_mode() -> bool:
    """Ask Document AI to omit page images from responses (DOCUMENT_AI_IMAGELESS_MODE)."""
    s = _settings()
    return bool(getattr(s, "document_ai_imageless_mode", True)) if s is not None else True


def _get_page_limit() -> int:
    s = _settings()
    limit = _DEFAULT_PAGE_LIMIT
    if s is not None:
        try:
            limit = int(getattr(s, "document_ai_page_limit", limit) or limit)
        except (TypeError, ValueError):
            pass
    env_value = os.environ.get("DOCUMENT_AI_PAGE_LIMIT")
    if env_value:
        try:
            limit = int(env_value)
        except (TypeError, ValueError):
            pass
    if not _imageless_mode():
        # With page images in the response the online limit is 15 pages.
        limit = min(limit, _PAGE_LIMIT_WITH_IMAGES)
    return max(1, limit)


def _get_ocr_workers() -> int:
    s = _settings()
    try:
        return max(1, int(getattr(s, "ocr_parallel_workers", _DEFAULT_OCR_WORKERS)))
    except Exception:
        return _DEFAULT_OCR_WORKERS


def _text_layer_mode() -> str:
    """'hybrid' (default): read born-digital pages locally, OCR only scanned pages. 'off': OCR every page."""
    s = _settings()
    mode = str(getattr(s, "pdf_text_layer_mode", "hybrid") or "hybrid").strip().lower() if s is not None else "hybrid"
    return "off" if mode in ("off", "false", "0", "no", "none") else "hybrid"


def _text_layer_min_chars() -> int:
    s = _settings()
    try:
        return max(0, int(getattr(s, "pdf_text_layer_min_chars", 40)))
    except Exception:
        return 40


def _text_layer_image_ratio() -> float:
    s = _settings()
    try:
        return max(0.0, min(1.0, float(getattr(s, "pdf_text_layer_image_area_ratio", 0.5))))
    except Exception:
        return 0.5


# ── Global Document AI concurrency gate ────────────────────────────────────────
# All documents in a batch process concurrently, so doc-workers × ocr-workers
# page-batch requests could hit Document AI at once. A 429 makes the whole
# extraction fall back to pypdf (much worse quality), so instead of letting the
# stampede happen, every process_document call takes a slot here. Only the
# Document AI RPC is gated — chunking/embedding/persistence stay fully parallel.
_docai_semaphore: threading.BoundedSemaphore | None = None
_docai_semaphore_lock = threading.Lock()


def _get_docai_semaphore() -> threading.BoundedSemaphore:
    global _docai_semaphore
    with _docai_semaphore_lock:
        if _docai_semaphore is None:
            try:
                from app.core.config import get_settings
                slots = max(1, int(getattr(get_settings(), "document_ai_max_concurrent_requests", 10)))
            except Exception:
                slots = 10
            _docai_semaphore = threading.BoundedSemaphore(slots)
        return _docai_semaphore


def _process_document_with_retry(client, request, *, attempts: int = 3):
    """client.process_document with retry on transient errors (429/quota/5xx).

    Without this, one throttled request permanently degrades the file to the
    pypdf fallback. The semaphore slot is held across retries so a retry burst
    can never amplify the very stampede that caused the 429.
    """
    for attempt in range(attempts):
        try:
            return client.process_document(request=request, timeout=_DOCAI_REQUEST_TIMEOUT_S)
        except Exception as exc:
            msg = str(exc).lower()
            transient = any(
                k in msg
                for k in ("429", "resource exhausted", "resource_exhausted", "quota", "unavailable", "503", "deadline")
            )
            if not transient or attempt >= attempts - 1:
                raise
            delay = 2.0 * (2 ** attempt)
            logger.warning(
                "[DocumentAI OCR] transient error — retry %d/%d in %.0fs: %s",
                attempt + 1, attempts - 1, delay, str(exc)[:200],
            )
            time.sleep(delay)


@dataclass
class OcrResult:
    text: str
    page_count: int
    quality_score: float
    structured_json: dict[str, Any] | None = None


def _word_ocr_result(
    data: bytes, *, mime_type: str | None, filename: str | None, source: str = ""
) -> OcrResult:
    """Extract text from a Word (.docx/.doc) document via the XML adapter.

    Document AI does not accept Word MIME types, so these files must be handled
    here rather than being sent to OCR (which throws) and dropping through to the
    pypdf / raw-UTF-8 fallback that yields empty or garbage text.
    """
    from app.services.adapters.word import extract_word_text
    try:
        text = (extract_word_text(data, mime_type=mime_type, filename=filename) or "").strip()
    except Exception as exc:
        logger.warning("[Extractor] route=word extraction failed source=%s error=%s", source, exc)
        text = ""
    # DOCX carries no intrinsic page count; estimate ~1800 chars/page for
    # progress/quality reporting only (not used for chunking).
    page_count = max(1, round(len(text) / 1800)) if text else 0
    quality_score = 0.9 if len(text) > 100 else (0.5 if text else 0.0)
    structured_json = _structured_from_page_texts([text] if text else [], source="docx_xml")
    logger.info(
        "[Extractor] route=word method=docx_xml source=%s chars=%d pages~%d",
        source, len(text), page_count,
    )
    return OcrResult(
        text=text,
        page_count=page_count,
        quality_score=quality_score,
        structured_json=structured_json,
    )


def _clean_extracted_text(text: str) -> str:
    """
    Repair deterministic PDF/OCR word-splits (e.g. "St amps" -> "Stamps",
    "De ed" -> "Deed") at extraction time so the stored text, the embeddings,
    and every downstream LLM call (DeepSeek/Claude/Gemini) receive clean input.

    Reuses the shared, SAFE repair from document_ai (number-merge + curated
    dictionary + dictionary-backed rejoiner) — it only joins KNOWN split forms,
    never a blanket short-token merge, so normal prose ("in court", "to do") is
    never corrupted. Best-effort: returns the input unchanged on any error.
    """
    if not text:
        return text
    try:
        from app.services.adapters.document_ai import normalize_ocr_artifacts
        return normalize_ocr_artifacts(text)
    except Exception:
        return text


# ── PDF page-batch helpers ─────────────────────────────────────────────────────

def _pdf_page_count(data: bytes) -> int:
    """Return the number of pages in a PDF without loading all content."""
    from app.services.adapters.pdf_pages import count_pages

    return count_pages(data)


def _split_pdf_into_page_batches(data: bytes, max_pages: int) -> list[bytes]:
    """
    Split PDF bytes into sequential batches of at most max_pages pages.
    Returns a list of PDF bytes (one entry per batch), in page order.
    """
    from app.services.adapters.pdf_pages import chunk_ranges, count_pages, split_ranges

    total = count_pages(data)
    if total <= 0:
        return []
    return split_ranges(data, chunk_ranges([(0, total)], max_pages))


def _merge_structured_json(results: list[OcrResult], merged_text: str) -> dict[str, Any] | None:
    structured_results = [r.structured_json for r in results if isinstance(r.structured_json, dict)]
    if not structured_results:
        return None

    pages: list[dict[str, Any]] = []
    for payload in structured_results:
        payload_pages = payload.get("pages")
        if isinstance(payload_pages, list):
            pages.extend(page for page in payload_pages if isinstance(page, dict))

    first = structured_results[0]
    return {
        "schemaVersion": 1,
        "source": first.get("source") or "document_ai_ocr",
        "provider": first.get("provider") or "google_document_ai",
        "text": merged_text,
        "pageCount": len(pages) or sum(r.page_count for r in results),
        "pages": pages,
        "batchCount": len(structured_results),
    }


def _merge_ocr_results(results: list[OcrResult]) -> OcrResult:
    """Merge an ordered list of OcrResult objects (one per batch) into a single result."""
    if not results:
        return OcrResult(text="", page_count=0, quality_score=0.0)
    if len(results) == 1:
        return results[0]
    merged_text = "\n\n".join(r.text for r in results if r.text)
    total_pages = sum(r.page_count for r in results)
    avg_quality = sum(r.quality_score for r in results) / len(results)
    return OcrResult(
        text=merged_text,
        page_count=total_pages,
        quality_score=avg_quality,
        structured_json=_merge_structured_json(results, merged_text),
    )


def _text_from_anchor(document_text: str, text_anchor: Any) -> str:
    segments = getattr(text_anchor, "text_segments", None) or []
    parts: list[str] = []
    for segment in segments:
        try:
            start = int(getattr(segment, "start_index", 0) or 0)
            end = int(getattr(segment, "end_index", 0) or 0)
        except (TypeError, ValueError):
            continue
        if end > start:
            parts.append(document_text[start:end])
    return "".join(parts)


def _layout_text(element: Any, document_text: str) -> str:
    """Text for one layout element, de-fragmented.

    The cleaner runs AFTER anchor slicing, never before: text_anchor offsets index the RAW
    document_text, so cleaning it first (it removes characters) would shift every offset and slice
    the wrong span. This is the single funnel every structured_json text field flows through, so
    cleaning here keeps the structured payload consistent with OcrResult.text — which
    _call_document_ai cleans separately. Without it the OCR viewer renders the very word-splits
    ("St amps De ed") that the cleaner exists to remove, right next to a clean extractedText.
    """
    layout = getattr(element, "layout", None)
    if not layout:
        return ""
    anchor = getattr(layout, "text_anchor", None)
    if anchor:
        text = _text_from_anchor(document_text, anchor)
        if text:
            return _clean_extracted_text(text)
    return _clean_extracted_text(str(getattr(layout, "content", "") or ""))


def _page_dimension(page: Any) -> dict[str, Any]:
    dimension = getattr(page, "dimension", None)
    if not dimension:
        return {"width": None, "height": None, "unit": ""}
    width = getattr(dimension, "width", None)
    height = getattr(dimension, "height", None)
    return {
        "width": float(width) if width is not None else None,
        "height": float(height) if height is not None else None,
        "unit": str(getattr(dimension, "unit", "") or ""),
    }


def _layout_bbox(layout: Any, page_width: float | None = None, page_height: float | None = None) -> dict[str, float] | None:
    poly = getattr(layout, "bounding_poly", None)
    if not poly:
        return None
    vertices = list(getattr(poly, "normalized_vertices", None) or [])
    normalized = True
    if not vertices:
        vertices = list(getattr(poly, "vertices", None) or [])
        normalized = False
    if not vertices:
        return None

    xs: list[float] = []
    ys: list[float] = []
    for vertex in vertices:
        try:
            x = float(getattr(vertex, "x", 0) or 0)
            y = float(getattr(vertex, "y", 0) or 0)
        except (TypeError, ValueError):
            continue
        if not normalized:
            if page_width and page_width > 0:
                x = x / page_width
            if page_height and page_height > 0:
                y = y / page_height
        xs.append(max(0.0, min(1.0, x)))
        ys.append(max(0.0, min(1.0, y)))

    if not xs or not ys:
        return None

    left = min(xs)
    top = min(ys)
    right = max(xs)
    bottom = max(ys)
    return {
        "left": round(left, 6),
        "top": round(top, 6),
        "width": round(max(0.0, right - left), 6),
        "height": round(max(0.0, bottom - top), 6),
    }


def _layout_confidence(layout: Any) -> float | None:
    value = getattr(layout, "confidence", None)
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _layout_item(
    element: Any,
    document_text: str,
    *,
    item_type: str,
    page_width: float | None,
    page_height: float | None,
) -> dict[str, Any] | None:
    text = _layout_text(element, document_text).strip()
    if not text:
        return None

    layout = getattr(element, "layout", None)
    item: dict[str, Any] = {"type": item_type, "text": text}
    if layout:
        bbox = _layout_bbox(layout, page_width, page_height)
        if bbox:
            item["boundingBox"] = bbox
        confidence = _layout_confidence(layout)
        if confidence is not None:
            item["confidence"] = confidence
        orientation = str(getattr(layout, "orientation", "") or "")
        if orientation:
            item["orientation"] = orientation
    return item


def _layout_items(
    page: Any,
    attr: str,
    document_text: str,
    *,
    page_width: float | None,
    page_height: float | None,
) -> list[dict[str, Any]]:
    elements = getattr(page, attr, None) or []
    singular = attr[:-1] if attr.endswith("s") else attr
    items: list[dict[str, Any]] = []
    for element in elements:
        item = _layout_item(
            element,
            document_text,
            item_type=singular,
            page_width=page_width,
            page_height=page_height,
        )
        if item:
            items.append(item)
    return items


def _table_cell_to_dict(cell: Any, document_text: str, page_width: float | None, page_height: float | None) -> dict[str, Any]:
    layout = getattr(cell, "layout", None)
    out: dict[str, Any] = {
        "text": _layout_text(cell, document_text).strip(),
        "rowSpan": int(getattr(cell, "row_span", 1) or 1),
        "colSpan": int(getattr(cell, "col_span", 1) or 1),
    }
    if layout:
        bbox = _layout_bbox(layout, page_width, page_height)
        if bbox:
            out["boundingBox"] = bbox
        confidence = _layout_confidence(layout)
        if confidence is not None:
            out["confidence"] = confidence
    return out


def _table_rows_to_list(rows: Any, document_text: str, page_width: float | None, page_height: float | None) -> list[list[dict[str, Any]]]:
    result: list[list[dict[str, Any]]] = []
    for row in rows or []:
        result.append([
            _table_cell_to_dict(cell, document_text, page_width, page_height)
            for cell in (getattr(row, "cells", None) or [])
        ])
    return result


def _tables_to_dicts(page: Any, document_text: str, page_width: float | None, page_height: float | None) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for table in getattr(page, "tables", None) or []:
        layout = getattr(table, "layout", None)
        item: dict[str, Any] = {
            "text": _layout_text(table, document_text).strip(),
            "headerRows": _table_rows_to_list(getattr(table, "header_rows", None), document_text, page_width, page_height),
            "bodyRows": _table_rows_to_list(getattr(table, "body_rows", None), document_text, page_width, page_height),
        }
        if layout:
            bbox = _layout_bbox(layout, page_width, page_height)
            if bbox:
                item["boundingBox"] = bbox
        tables.append(item)
    return tables


def _document_to_structured_json(
    doc: Any,
    *,
    page_offset: int = 0,
    processor_name: str = "",
    include_tokens: bool = False,
    cleaned_text: str | None = None,
) -> dict[str, Any]:
    document_text = str(getattr(doc, "text", "") or "")
    pages: list[dict[str, Any]] = []
    for index, page in enumerate(getattr(doc, "pages", None) or []):
        dimension = _page_dimension(page)
        page_width = dimension.get("width")
        page_height = dimension.get("height")
        page_text = _layout_text(page, document_text).strip()
        blocks = _layout_items(page, "blocks", document_text, page_width=page_width, page_height=page_height)
        paragraphs = _layout_items(page, "paragraphs", document_text, page_width=page_width, page_height=page_height)
        lines = _layout_items(page, "lines", document_text, page_width=page_width, page_height=page_height)
        if not page_text:
            preferred = lines or paragraphs or blocks
            page_text = "\n".join(item.get("text", "") for item in preferred if item.get("text")).strip()
        page_json = {
            "pageNumber": page_offset + index + 1,
            "dimension": dimension,
            "text": page_text,
            "blocks": blocks,
            "paragraphs": paragraphs,
            "lines": lines,
            "tables": _tables_to_dicts(page, document_text, page_width, page_height),
        }
        if include_tokens:
            # Word-level boxes: too bulky to persist for every ingest, but needed
            # by consumers that reconstruct table cells from geometry (the OCR
            # processor merges lines ACROSS column gaps, so lines alone can't
            # split cells). Opt-in only — DB-stored extractions never carry them.
            page_json["tokens"] = _layout_items(
                page, "tokens", document_text, page_width=page_width, page_height=page_height
            )
        pages.append(page_json)

    return {
        "schemaVersion": 1,
        "source": "document_ai_ocr",
        "provider": "google_document_ai",
        "processorName": processor_name,
        # Cleaned on the way OUT only — `document_text` itself must stay raw above, because every
        # text_anchor offset indexes it. The caller usually has the cleaned copy already
        # (_call_document_ai cleans doc.text for OcrResult.text); reuse it rather than
        # paying for the same pass twice per batch.
        "text": cleaned_text if cleaned_text is not None else _clean_extracted_text(document_text),
        "pageCount": len(pages),
        "pages": pages,
    }


def _structured_from_page_texts(page_texts: list[str], *, source: str) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    for index, text in enumerate(page_texts):
        lines = [
            {"type": "line", "text": line.strip()}
            for line in str(text or "").splitlines()
            if line.strip()
        ]
        pages.append(
            {
                "pageNumber": index + 1,
                "dimension": {"width": None, "height": None, "unit": ""},
                "text": str(text or "").strip(),
                "blocks": [],
                "paragraphs": [],
                "lines": lines,
                "tables": [],
            }
        )
    full_text = "\n\n".join(page.get("text", "") for page in pages if page.get("text")).strip()
    return {
        "schemaVersion": 1,
        "source": source,
        "provider": source,
        "text": full_text,
        "pageCount": len(pages),
        "pages": pages,
    }


# ── Document AI single-batch call ─────────────────────────────────────────────

def _build_ocr_process_options():
    """
    Build Document AI ``ProcessOptions`` that suppress space-fragmentation.

    The decisive lever is ``enable_native_pdf_parsing``: for born-digital PDFs
    Document AI reads the embedded Unicode text layer directly instead of
    rasterizing the page and running glyph-level OCR. That bypasses the OCR
    word-segmenter entirely, so spurious intra-word spaces ("Sug riv",
    "18 % p .a .") are never produced in the first place — no dictionary needed.

    ``enable_math_ocr`` / ``enable_symbol`` are premium and only enabled when the
    operator opts in (a basic OCR processor version would reject them otherwise).

    Returns ``None`` on any error so the caller falls back to a plain request.
    """
    try:
        from google.cloud import documentai  # type: ignore
        from app.core.config import get_settings

        s = get_settings()
        native_pdf = bool(getattr(s, "document_ai_enable_native_pdf_parsing", True))
        enable_math = bool(getattr(s, "document_ai_enable_math_ocr", False))
        enable_symbol = bool(getattr(s, "document_ai_enable_symbol", False))

        ocr_config_kwargs: dict = {"enable_native_pdf_parsing": native_pdf}
        if enable_symbol:
            ocr_config_kwargs["enable_symbol"] = True
        if enable_math:
            ocr_config_kwargs["premium_features"] = documentai.OcrConfig.PremiumFeatures(
                enable_math_ocr=True,
            )

        return documentai.ProcessOptions(ocr_config=documentai.OcrConfig(**ocr_config_kwargs))
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("[DocumentAI OCR] could not build ProcessOptions: %s", exc)
        return None


def _looks_like_rejected_options(exc: BaseException) -> bool:
    """True for InvalidArgument-style failures a plain request could avoid; False for
    quota/timeout/network failures, where a second attempt would only double the wait."""
    msg = str(exc).lower()
    return any(k in msg for k in ("invalid", "not supported", "unsupported", "400", "argument"))


def _call_document_ai(
    batch_bytes: bytes,
    mime_type: str,
    client,
    processor_name: str,
    page_offset: int = 0,
    process_options=None,
    include_tokens: bool = False,
    imageless: bool | None = None,
) -> OcrResult:
    """Send a single batch to Document AI and return OcrResult."""
    from google.cloud import documentai  # type: ignore

    if imageless is None:
        imageless = _imageless_mode()
    raw_doc = documentai.RawDocument(content=batch_bytes, mime_type=mime_type)
    request_kwargs: dict[str, Any] = {"name": processor_name, "raw_document": raw_doc}
    if process_options is not None:
        request_kwargs["process_options"] = process_options
    if imageless:
        # No page images in the response: ~20x smaller payload per request and a
        # 30-page online limit instead of 15. Nothing downstream reads the images.
        request_kwargs["imageless_mode"] = True
    request = documentai.ProcessRequest(**request_kwargs)
    with _get_docai_semaphore():
        try:
            result = _process_document_with_retry(client, request)
        except Exception as exc:
            # A processor version that doesn't support a chosen option (premium math
            # OCR, imageless mode) raises InvalidArgument. Never drop the batch over a
            # config mismatch — retry once with a plain request.
            if (process_options is not None or imageless) and _looks_like_rejected_options(exc):
                logger.warning(
                    "[DocumentAI OCR] request options rejected (%s) — retrying without options",
                    exc,
                )
                plain = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)
                result = _process_document_with_retry(client, plain)
            else:
                raise
    doc = result.document
    text = _clean_extracted_text(doc.text or "")
    page_count = len(doc.pages)
    avg_chars = len(text) / max(page_count, 1)
    quality_score = min(1.0, avg_chars / 500.0)
    structured_json = _document_to_structured_json(
        doc,
        page_offset=page_offset,
        processor_name=processor_name,
        include_tokens=include_tokens,
        cleaned_text=text,
    )
    return OcrResult(
        text=text,
        page_count=page_count,
        quality_score=quality_score,
        structured_json=structured_json,
    )


def _load_google_credentials() -> object | None:
    """
    Load Google credentials for Document AI.

    Prefer service-account credentials from settings (GCS_KEY_BASE64 or
    GOOGLE_APPLICATION_CREDENTIALS) to avoid depending on interactive gcloud ADC
    (which can fail with reauth-required on Windows dev machines).
    """
    try:
        import base64
        import json

        from google.oauth2 import service_account  # type: ignore

        from app.core.config import get_settings

        settings = get_settings()
        scope = "https://www.googleapis.com/auth/cloud-platform"

        key_b64 = (settings.gcs_key_base64 or "").strip()
        if key_b64:
            key_json = base64.b64decode(key_b64).decode("utf-8")
            creds_dict = json.loads(key_json)
            return service_account.Credentials.from_service_account_info(
                creds_dict,
                scopes=[scope],
            )

        cred_path = (settings.google_application_credentials or "").strip()
        if cred_path:
            return service_account.Credentials.from_service_account_file(
                cred_path,
                scopes=[scope],
            )

        # Last resort: ADC (may require `gcloud auth application-default login`)
        import google.auth  # type: ignore

        credentials, _ = google.auth.default(scopes=[scope])
        return credentials
    except Exception:
        return None


def _get_ocr_processor_version_id() -> str:
    """Return the pinned OCR processor *version* id, if configured."""
    try:
        from app.core.config import get_settings
        return (getattr(get_settings(), "document_ai_ocr_processor_version_id", "") or "").strip()
    except Exception:
        return ""


def _build_document_ai_client(location: str, project_id: str, processor_id: str):
    """
    Build a Document AI client and return (client, processor_name).

    When ``document_ai_ocr_processor_version_id`` is set we target that specific
    processor *version* (``processor_version_path``) so a stronger/newer OCR model
    can be pinned. Otherwise we fall back to the processor's default version
    (``processor_path``).
    """
    from google.cloud import documentai  # type: ignore

    client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
    creds = _load_google_credentials()
    client = (
        documentai.DocumentProcessorServiceClient(client_options=client_options, credentials=creds)
        if creds is not None
        else documentai.DocumentProcessorServiceClient(client_options=client_options)
    )

    version_id = _get_ocr_processor_version_id()
    if version_id:
        processor_name = client.processor_version_path(
            project_id, location, processor_id, version_id
        )
        logger.info(
            "[DocumentAI OCR] using pinned processor version: %s", processor_name
        )
    else:
        processor_name = client.processor_path(project_id, location, processor_id)
    return client, processor_name


def _empty_page_json(index: int, source: str) -> dict[str, Any]:
    return {
        "pageNumber": index + 1,
        "dimension": {"width": None, "height": None, "unit": ""},
        "text": "",
        "blocks": [],
        "paragraphs": [],
        "lines": [],
        "tables": [],
        "source": source,
    }


def _assemble_routed_result(
    page_count: int,
    ocr_pages: dict[int, dict[str, Any]],
    text_pages: dict[int, Any],
    *,
    processor_name: str,
    routing: dict[str, Any],
) -> OcrResult:
    """Interleave Document AI pages and text-layer pages back into document order."""
    pages_json: list[dict[str, Any]] = []
    texts: list[str] = []
    missing = 0
    for index in range(page_count):
        page = ocr_pages.get(index)
        if page is None:
            local = text_pages.get(index)
            page = local.structured if local is not None else None
        if page is None:
            missing += 1
            page = _empty_page_json(index, "missing")
        pages_json.append(page)
        body = str(page.get("text") or "")
        if body.strip():
            texts.append(body)
    merged_text = "\n\n".join(texts)
    avg_chars = len(merged_text) / max(page_count, 1)
    any_ocr = bool(ocr_pages)
    structured = {
        "schemaVersion": 1,
        "source": "document_ai_ocr" if any_ocr else "pdf_text_layer",
        "provider": "google_document_ai" if any_ocr else "pymupdf",
        "processorName": processor_name if any_ocr else "",
        "text": merged_text,
        "pageCount": page_count,
        "pages": pages_json,
        "routing": {**routing, "missing_pages": missing},
    }
    return OcrResult(
        text=merged_text,
        page_count=page_count,
        quality_score=min(1.0, avg_chars / 500.0),
        structured_json=structured,
    )


def _text_layer_result(
    data: bytes,
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult | None:
    """The whole PDF read from its text layer with PyMuPDF — no Document AI.

    Used when Document AI is not configured or has failed. None when PyMuPDF is
    unavailable or the file is unreadable, so the caller can fall back to pypdf.
    """
    from app.services.adapters import pdf_pages

    if not pdf_pages.mupdf_available():
        return None

    def _progress(done: int, total: int) -> None:
        if progress_callback and total:
            try:
                progress_callback(round(progress_start + (progress_end - progress_start) * done / total, 1))
            except Exception:
                pass

    scan = pdf_pages.scan_text_layer(data, force_all=True, clean=_clean_extracted_text, progress=_progress)
    if scan is None:
        return None
    return _assemble_routed_result(
        scan.page_count,
        {},
        scan.pages,
        processor_name="",
        routing={
            "text_layer_pages": scan.page_count,
            "ocr_pages": 0,
            "ocr_requests": 0,
            "reasons": dict(scan.reasons),
        },
    )


def _parallel_ocr_bytes(
    data: bytes,
    mime_type: str,
    client,
    processor_name: str,
    *,
    process_options=None,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
    include_tokens: bool = False,
) -> OcrResult:
    """
    Extract a document, sending to Document AI only the pages that need OCR.

    Flow for a PDF:
      1. Scan the text layer with PyMuPDF (a few seconds for 2,000 pages). Pages
         with their own text are read locally; scanned pages (image-dominated,
         even with a thin text stamp) are queued for OCR. PDF_TEXT_LAYER_MODE=off
         sends every page to OCR as before.
      2. Cut the OCR pages into contiguous ranges of at most `page_limit` pages
         (30 in imageless mode), split them with MuPDF, and send every range to
         Document AI concurrently (OCR_PARALLEL_WORKERS threads, gated globally by
         DOCUMENT_AI_MAX_CONCURRENT_REQUESTS).
      3. Interleave the results back into page order. A range whose request fails
         after retries keeps whatever text layer it has instead of losing pages.

    Non-PDF media (images) go to Document AI in one request.

    progress_callback receives values in [progress_start, progress_end]: the scan
    reports the first ~3 points, OCR ranges the rest, as each completes.
    """
    from app.services.adapters import pdf_pages

    page_limit = _get_page_limit()
    imageless = _imageless_mode()

    def _report(pct: float) -> None:
        if progress_callback:
            try:
                progress_callback(round(pct, 1))
            except Exception:
                pass

    is_pdf = mime_type == "application/pdf" or mime_type.endswith("/pdf")

    def _single_request() -> OcrResult:
        _report(progress_start)
        t_single = time.monotonic()
        result = _call_document_ai(
            data,
            mime_type,
            client,
            processor_name,
            page_offset=0,
            process_options=process_options,
            include_tokens=include_tokens,
            imageless=imageless,
        )
        logger.info(
            "[DocumentAI OCR] single-request mime=%s pages=%d chars=%d elapsed=%.2fs quality=%.2f",
            mime_type, result.page_count, len(result.text), time.monotonic() - t_single, result.quality_score,
        )
        _report(progress_end)
        return result

    if not is_pdf:
        return _single_request()

    # ── 1. Route pages: text layer locally, scanned pages to Document AI ─────
    t_scan = time.monotonic()
    scan = None
    if _text_layer_mode() != "off" and pdf_pages.mupdf_available():
        scan_end = progress_start + 3.0
        scan = pdf_pages.scan_text_layer(
            data,
            min_chars=_text_layer_min_chars(),
            image_area_ratio=_text_layer_image_ratio(),
            clean=_clean_extracted_text,
            progress=lambda done, total: _report(
                progress_start + (scan_end - progress_start) * done / max(total, 1)
            ),
        )

    if scan is not None:
        page_count = scan.page_count
        text_pages = scan.pages
        ranges = pdf_pages.chunk_ranges(pdf_pages.contiguous_runs(scan.ocr_indices), page_limit)
        reasons = dict(scan.reasons)
        ocr_progress_start = progress_start + 3.0
        logger.info(
            "[DocumentAI OCR] routed pages=%d text_layer=%d ocr=%d requests=%d "
            "(limit=%d/request imageless=%s) reasons=%s scan=%.2fs",
            page_count, len(text_pages), len(scan.ocr_indices), len(ranges),
            page_limit, imageless, reasons, time.monotonic() - t_scan,
        )
    else:
        page_count = pdf_pages.count_pages(data)
        if page_count <= 0:
            # Unreadable page tree locally — let Document AI try the whole file.
            return _single_request()
        text_pages = {}
        ranges = pdf_pages.chunk_ranges([(0, page_count)], page_limit)
        reasons = {"ocr_all": page_count}
        ocr_progress_start = progress_start
        logger.info(
            "[DocumentAI OCR] text-layer routing off: pages=%d requests=%d (limit=%d/request imageless=%s)",
            page_count, len(ranges), page_limit, imageless,
        )

    if not ranges:
        # Every page carried its own text layer: no OCR round trips at all.
        _report(progress_end)
        result = _assemble_routed_result(
            page_count, {}, text_pages, processor_name=processor_name,
            routing={"text_layer_pages": len(text_pages), "ocr_pages": 0, "ocr_requests": 0, "reasons": reasons},
        )
        logger.info(
            "[DocumentAI OCR] text-layer only pages=%d chars=%d elapsed=%.2fs",
            page_count, len(result.text), time.monotonic() - t_scan,
        )
        return result

    # ── 2. Split only the OCR pages and send every range concurrently ───────
    batches = pdf_pages.split_ranges(data, ranges)
    n_batches = len(batches)
    num_workers = max(1, min(_get_ocr_workers(), n_batches))
    ocr_pages: dict[int, dict[str, Any]] = {}
    ocr_lock = threading.Lock()
    completed = 0
    t0 = time.monotonic()
    _report(ocr_progress_start)

    def _ocr_range(idx: int) -> OcrResult:
        start, _end = ranges[idx]
        # page_offset MUST be the range's first page index: every request's pages
        # restart at 1, so without it every range would report pages 1..n.
        return _call_document_ai(
            batches[idx],
            mime_type,
            client,
            processor_name,
            page_offset=start,
            process_options=process_options,
            include_tokens=include_tokens,
            imageless=imageless,
        )

    with ThreadPoolExecutor(max_workers=num_workers, thread_name_prefix="ocr-batch") as pool:
        future_to_index = {pool.submit(_ocr_range, idx): idx for idx in range(n_batches)}
        for future in as_completed(future_to_index):
            idx = future_to_index[future]
            start, end = ranges[idx]
            try:
                result = future.result()
                pages = (result.structured_json or {}).get("pages") or []
                with ocr_lock:
                    for page in pages:
                        if not isinstance(page, dict):
                            continue
                        page.setdefault("source", "document_ai_ocr")
                        try:
                            number = int(page.get("pageNumber") or 0)
                        except (TypeError, ValueError):
                            continue
                        if number >= 1:
                            ocr_pages[number - 1] = page
            except Exception as exc:
                # Keep the pages rather than dropping them: whatever text layer the
                # range carries (often nothing for a scan) is better than a hole.
                logger.warning(
                    "[DocumentAI OCR] request %d/%d (pages %d-%d) failed: %s — keeping the text layer for those pages",
                    idx + 1, n_batches, start + 1, end, exc,
                )
                fallback = pdf_pages.scan_text_layer(batches[idx], force_all=True, clean=_clean_extracted_text)
                with ocr_lock:
                    for offset in range(end - start):
                        local = fallback.pages.get(offset) if fallback is not None else None
                        if local is not None and local.text.strip():
                            page = dict(local.structured)
                            page["source"] = "ocr_failed_text_layer"
                        else:
                            page = _empty_page_json(start + offset, "ocr_failed")
                        page["pageNumber"] = start + offset + 1
                        ocr_pages[start + offset] = page
            finally:
                with ocr_lock:
                    completed += 1
                    done = completed
                _report(ocr_progress_start + (done / n_batches) * (progress_end - ocr_progress_start))
                logger.debug("[DocumentAI OCR] request %d/%d done", done, n_batches)

    merged = _assemble_routed_result(
        page_count, ocr_pages, text_pages, processor_name=processor_name,
        routing={
            "text_layer_pages": len(text_pages),
            "ocr_pages": len(ocr_pages),
            "ocr_requests": n_batches,
            "reasons": reasons,
        },
    )
    logger.info(
        "[DocumentAI OCR] parallel-batch done requests=%d workers=%d pages=%d (ocr=%d text_layer=%d) "
        "chars=%d elapsed=%.2fs quality=%.2f",
        n_batches, num_workers, page_count, len(ocr_pages), len(text_pages),
        len(merged.text), time.monotonic() - t0, merged.quality_score,
    )
    return merged


# ── Audio / Speech-to-Text extraction ─────────────────────────────────────────

def extract_text_from_audio_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    filename: str | None = None,
    progress_callback: Callable[[float], None] | None = None,
) -> OcrResult:
    """
    Transcribe an audio file stored in GCS.

    Delegates to ``speech_to_text.transcribe()``: Gemini 2.5 Flash (``gs://`` URI)
    first, then Google Speech-to-Text if that returns nothing, then Gemini recovery
    if STT quality is poor.

    Never raises on empty/low-quality output — returns whatever is available so
    the pipeline always stores *something* for the file.  Only raises on hard
    API / network failures where the call itself could not complete.
    """
    import os
    from app.services.adapters import speech_to_text as stt
    from app.services.adapters.gcs import download_bytes
    from app.services.audio_processing import AudioProcessingError

    # Extract filename from GCS URI for Gemini context
    filename = filename or os.path.basename(gs_uri.rstrip("/"))
    mime_type = stt.resolve_media_mime_type(mime_type, filename)

    logger.info("[SpeechToText] transcribing audio uri=%s mime=%s", gs_uri, mime_type)
    try:
        # ── Primary (audio): Gemini 2.5 Flash directly from GCS URI ─────────────
        # Do NOT download the audio file unless we need to fall back to STT/inline.
        gemini_primary = ""
        if stt.is_gemini_primary_audio_mime(mime_type, filename):
            try:
                gemini_primary = (stt._transcribe_gcs_with_gemini(  # type: ignore[attr-defined]
                    gs_uri,
                    mime_type,
                    filename=filename or "",
                    model_names=[getattr(stt, "_GEMINI_PRIMARY_MODEL", "gemini-2.5-flash")],
                ) or "").strip()
            except Exception:
                gemini_primary = ""

        if gemini_primary:
            text = gemini_primary
        else:
            # Fallback: download bytes for STT paths (and possible inline-Gemini recovery).
            audio_bytes = download_bytes(gs_uri)
            text = stt.transcribe(
                gs_uri,
                audio_bytes,
                mime_type,
                progress_callback=progress_callback,
                filename=filename or "",
                skip_gemini_primary=True,  # already attempted above
            )
    except AudioProcessingError:
        raise
    except TimeoutError as exc:
        raise AudioProcessingError(f"Speech-to-Text timed out for {gs_uri}") from exc
    except Exception as exc:
        logger.error("[SpeechToText] transcription failed for %s: %s", gs_uri, exc)
        raise AudioProcessingError(f"Speech-to-Text failed for {gs_uri}: {exc}") from exc

    text = (text or "").strip()
    if not text:
        # Do not fail — store a placeholder so the file record is complete and
        # the user gets an informative response rather than a processing error.
        text = f"[Audio file: {filename}]\nNo transcribable speech or lyrics detected."
        logger.warning("[SpeechToText] empty transcript — stored placeholder for %s", gs_uri)

    quality = min(1.0, len(text) / 1000.0)
    structured_json = _structured_from_page_texts([text], source="speech_to_text")
    logger.info("[SpeechToText] done — chars=%d quality=%.2f uri=%s", len(text), quality, gs_uri)
    return OcrResult(text=text, page_count=1, quality_score=quality, structured_json=structured_json)


# ── Public API ─────────────────────────────────────────────────────────────────

def extract_text_from_gcs(
    gs_uri: str,
    mime_type: str = "application/pdf",
    *,
    filename: str | None = None,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    """
    Run Document AI OCR on a file already in GCS.
    Large PDFs are split into page batches and processed in parallel.
    Audio files are routed to Speech-to-Text with real-time progress reporting.

    Args:
        gs_uri: gs://bucket/path/to/file URI.
        mime_type: MIME type of the document.
        progress_callback: Optional callable(pct: float) for real-time progress.
        progress_start: Lower bound of the progress range reported (default 22).
        progress_end: Upper bound of the progress range reported (default 63).
    """
    # Route audio files to Speech-to-Text instead of Document AI OCR
    from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime, resolve_media_mime_type
    resolved_mime_type = resolve_media_mime_type(mime_type, filename)
    if is_audio_mime(resolved_mime_type) or is_audio_filename(filename or ""):
        logger.info(
            "[Extractor] route=audio method=gemini_gcs_uri_then_stt uri=%s mime=%s",
            gs_uri,
            resolved_mime_type,
        )
        return extract_text_from_audio_gcs(
            gs_uri,
            resolved_mime_type,
            filename=filename,
            progress_callback=progress_callback,
        )

    # Route Word documents (.docx/.doc) to the XML text extractor. Document AI
    # rejects Word MIME types, so without this they fall through to the pypdf /
    # UTF-8 fallback and yield empty/garbage text.
    from app.services.adapters.word import is_word_filename, is_word_mime
    if is_word_mime(resolved_mime_type) or is_word_filename(filename or ""):
        from app.services.adapters.gcs import download_bytes
        return _word_ocr_result(
            download_bytes(gs_uri), mime_type=resolved_mime_type, filename=filename, source=gs_uri,
        )

    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    processor_id = (getattr(settings, "document_ai_processor_id", "") or "").strip()

    if not project_id or not processor_id:
        logger.warning(
            "[DocumentAI OCR] Missing project_id=%s or processor_id=%s — falling back to pypdf",
            project_id, processor_id,
        )
        return _fallback_extract_from_gcs(gs_uri, mime_type, progress_callback=progress_callback,
                                          progress_start=progress_start, progress_end=progress_end)

    try:
        logger.info(
            "[Extractor] route=document method=document_ai_ocr uri=%s mime=%s project=%s location=%s processor_id=%s",
            gs_uri,
            resolved_mime_type,
            project_id,
            location,
            processor_id,
        )
        from app.services.adapters.gcs import download_bytes
        raw_bytes = download_bytes(gs_uri)
        client, processor_name = _build_document_ai_client(location, project_id, processor_id)
        process_options = _build_ocr_process_options()
        result = _parallel_ocr_bytes(
            raw_bytes,
            resolved_mime_type,
            client,
            processor_name,
            process_options=process_options,
            progress_callback=progress_callback,
            progress_start=progress_start,
            progress_end=progress_end,
        )
        logger.info(
            "[DocumentAI OCR] Processed %s pages=%d chars=%d quality=%.2f",
            gs_uri, result.page_count, len(result.text), result.quality_score,
        )
        return result
    except Exception as exc:
        logger.warning("[DocumentAI OCR] Failed for %s: %s — falling back", gs_uri, exc)
        return _fallback_extract_from_gcs(gs_uri, resolved_mime_type, progress_callback=progress_callback,
                                          progress_start=progress_start, progress_end=progress_end)


def extract_text_from_bytes(
    data: bytes,
    mime_type: str = "application/pdf",
    filename: str = "document",
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
    include_tokens: bool = False,
) -> OcrResult:
    """
    Run Document AI OCR on raw bytes (without requiring a GCS URI).
    Large PDFs are split into page batches and processed in parallel.
    Falls back to pypdf → UTF-8 if Document AI is unavailable.
    """
    # Word documents (.docx/.doc) are not accepted by Document AI — extract via XML.
    from app.services.adapters.word import is_word_filename, is_word_mime
    if is_word_mime(mime_type) or is_word_filename(filename or ""):
        return _word_ocr_result(data, mime_type=mime_type, filename=filename, source=filename or "bytes")

    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    processor_id = (getattr(settings, "document_ai_processor_id", "") or "").strip()

    if project_id and processor_id:
        try:
            client, processor_name = _build_document_ai_client(location, project_id, processor_id)
            process_options = _build_ocr_process_options()
            result = _parallel_ocr_bytes(
                data,
                mime_type,
                client,
                processor_name,
                process_options=process_options,
                progress_callback=progress_callback,
                progress_start=progress_start,
                progress_end=progress_end,
                include_tokens=include_tokens,
            )
            logger.info(
                "[DocumentAI OCR] bytes extracted pages=%d chars=%d quality=%.2f",
                result.page_count, len(result.text), result.quality_score,
            )
            return result
        except Exception as exc:
            logger.warning("[DocumentAI OCR] bytes extraction failed: %s — falling back", exc)

    return _fallback_extract_from_bytes(data, mime_type,
                                        progress_callback=progress_callback,
                                        progress_start=progress_start,
                                        progress_end=progress_end)


# ── Fallback extractors ────────────────────────────────────────────────────────

def _fallback_extract_from_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    try:
        from app.services.adapters.gcs import download_bytes
        data = download_bytes(gs_uri)
        return _fallback_extract_from_bytes(data, mime_type, progress_callback=progress_callback,
                                            progress_start=progress_start, progress_end=progress_end)
    except Exception as exc:
        logger.warning("[DocumentAI OCR] GCS download for fallback failed: %s", exc)
        return OcrResult(text="", page_count=0, quality_score=0.0)


def _fallback_extract_from_bytes(
    data: bytes,
    mime_type: str,
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    """Try pypdf first (page-by-page with per-page progress), then raw decode."""

    def _report(pct: float) -> None:
        if progress_callback:
            try:
                progress_callback(round(pct, 1))
            except Exception:
                pass

    if mime_type == "application/pdf" or mime_type.endswith("/pdf"):
        # PyMuPDF first: C-speed, better word spacing than pypdf, and it yields the
        # same structured-page schema the OCR viewer renders.
        mupdf_result = _text_layer_result(
            data,
            progress_callback=progress_callback,
            progress_start=progress_start,
            progress_end=progress_end,
        )
        if mupdf_result is not None:
            logger.info(
                "[DocumentAI OCR] mupdf text-layer fallback pages=%d chars=%d",
                mupdf_result.page_count, len(mupdf_result.text),
            )
            return mupdf_result
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(io.BytesIO(data))
            total_pages = len(reader.pages)
            pages_text: list[str] = []
            for page_idx, page in enumerate(reader.pages):
                t = page.extract_text() or ""
                # Append EVERY page, including blank ones: _structured_from_page_texts below maps
                # list index -> page number, so skipping a blank page would shift every later page's
                # number in the OCR viewer. Blanks are filtered when joining `text` instead.
                pages_text.append(t)
                # Report per-page progress for fallback extraction
                if total_pages > 0:
                    pct = progress_start + ((page_idx + 1) / total_pages) * (progress_end - progress_start)
                    _report(pct)
            text = _clean_extracted_text("\n\n".join(t for t in pages_text if t.strip()).strip())
            page_count = total_pages
            quality_score = min(1.0, len(text) / max(page_count * 500, 1))
            logger.info("[DocumentAI OCR] pypdf fallback pages=%d chars=%d", page_count, len(text))
            return OcrResult(
                text=text,
                page_count=page_count,
                quality_score=quality_score,
                # Clean each page (same reason as _layout_text: the structured payload must match
                # the cleaned `text` above). Clean in place — never filter blanks — because index
                # maps to page number here.
                structured_json=_structured_from_page_texts(
                    [_clean_extracted_text(t) for t in pages_text], source="pypdf"
                ),
            )
        except Exception as exc:
            logger.warning("[DocumentAI OCR] pypdf failed: %s", exc)

    # Last resort: decode bytes as UTF-8
    _report(progress_start + (progress_end - progress_start) * 0.5)
    try:
        text = data.decode("utf-8", errors="ignore").strip()
        _report(progress_end)
        return OcrResult(
            text=text,
            page_count=1 if text else 0,
            quality_score=0.5 if text else 0.0,
            structured_json=_structured_from_page_texts([text] if text else [], source="utf8_decode"),
        )
    except Exception:
        return OcrResult(text="", page_count=0, quality_score=0.0)
