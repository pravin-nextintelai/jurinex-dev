"""PDF page utilities on PyMuPDF (MuPDF, C) with pypdf fallbacks.

Why this module exists: a 2,000-page upload used to spend most of its wall-clock
in pure-Python PDF handling — pypdf re-serialising 134 fifteen-page batches for
Document AI, pypdf counting pages twice (plan check + OCR), and pypdf page-by-page
text as the OCR fallback. MuPDF does the same work in C, tens of times faster.

It also decides, page by page, whether Document AI is needed at all:

* A born-digital page carries its own Unicode text layer. Reading it locally is
  equivalent to Document AI's ``enable_native_pdf_parsing`` (which reads the same
  layer server-side) minus the network round trip, the 15-page batching and the
  per-page billing. The text is returned in the same structured-page schema the
  OCR viewer renders (blocks / paragraphs / lines with normalised boxes).
* A scanned page — one dominated by an image — always goes to Document AI, even
  when it carries a thin text layer (a scanner's own OCR or a digital Bates
  stamp), because Document AI's OCR is better than whatever put that layer there.

Every PyMuPDF call is serialised behind one process-wide lock: MuPDF documents are
not thread-safe, and this service processes many documents concurrently on worker
threads. The calls are fast enough (a 2,000-page scan is a few seconds) that the
lock costs little, and it makes the module safe to call from anywhere.
"""
from __future__ import annotations

import io
import logging
import threading
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("agentic_document_service.pdf_pages")

try:  # PyMuPDF ≥ 1.24 exposes the ``pymupdf`` name; ``fitz`` is the deprecated alias.
    import pymupdf as _mupdf  # type: ignore
except Exception:  # pragma: no cover - environment without PyMuPDF
    try:
        import fitz as _mupdf  # type: ignore
    except Exception:
        _mupdf = None

_MUPDF_LOCK = threading.RLock()

# Text flags: expand ligatures ("ﬁ" -> "fi") so search and embeddings see plain
# letters, keep the PDF's own whitespace, and clip to the media box. No
# TEXT_PRESERVE_IMAGES: image blocks are detected separately and never rendered.
_TEXT_FLAGS: int | None = None


def _text_flags() -> int:
    global _TEXT_FLAGS
    if _TEXT_FLAGS is None:
        _TEXT_FLAGS = int(getattr(_mupdf, "TEXT_PRESERVE_WHITESPACE", 0)) | int(
            getattr(_mupdf, "TEXT_MEDIABOX_CLIP", 0)
        )
    return _TEXT_FLAGS


def mupdf_available() -> bool:
    return _mupdf is not None


# ── Page counting ─────────────────────────────────────────────────────────────

def count_pages(data: bytes) -> int:
    """Number of pages in a PDF, or 0 when it cannot be read."""
    if _mupdf is not None:
        try:
            with _MUPDF_LOCK:
                doc = _mupdf.open(stream=data, filetype="pdf")
                try:
                    return int(doc.page_count)
                finally:
                    doc.close()
        except Exception as exc:  # noqa: BLE001 - fall through to pypdf
            logger.debug("[PdfPages] mupdf page count failed: %s", exc)
    try:
        from pypdf import PdfReader  # type: ignore

        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        return 0


# ── Page ranges ───────────────────────────────────────────────────────────────

def contiguous_runs(indices: list[int]) -> list[tuple[int, int]]:
    """Sorted 0-based page indices -> half-open runs [(start, end), ...]."""
    runs: list[tuple[int, int]] = []
    for index in sorted(set(int(i) for i in indices)):
        if runs and runs[-1][1] == index:
            runs[-1] = (runs[-1][0], index + 1)
        else:
            runs.append((index, index + 1))
    return runs


def chunk_ranges(runs: list[tuple[int, int]], max_pages: int) -> list[tuple[int, int]]:
    """Cut every run into half-open ranges of at most ``max_pages`` pages."""
    max_pages = max(1, int(max_pages))
    out: list[tuple[int, int]] = []
    for start, end in runs:
        cursor = start
        while cursor < end:
            stop = min(cursor + max_pages, end)
            out.append((cursor, stop))
            cursor = stop
    return out


def split_ranges(data: bytes, ranges: list[tuple[int, int]]) -> list[bytes]:
    """One PDF (bytes) per half-open 0-based page range, in the order given."""
    if not ranges:
        return []
    if _mupdf is not None:
        try:
            with _MUPDF_LOCK:
                src = _mupdf.open(stream=data, filetype="pdf")
                try:
                    out: list[bytes] = []
                    for start, end in ranges:
                        part = _mupdf.open()
                        try:
                            part.insert_pdf(src, from_page=start, to_page=end - 1)
                            out.append(part.tobytes(deflate=True, garbage=1))
                        finally:
                            part.close()
                    return out
                finally:
                    src.close()
        except Exception as exc:  # noqa: BLE001 - fall through to pypdf
            logger.warning("[PdfPages] mupdf split failed (%s) — falling back to pypdf", exc)
    from pypdf import PdfReader, PdfWriter  # type: ignore

    reader = PdfReader(io.BytesIO(data))
    out = []
    for start, end in ranges:
        writer = PdfWriter()
        for index in range(start, end):
            writer.add_page(reader.pages[index])
        buf = io.BytesIO()
        writer.write(buf)
        out.append(buf.getvalue())
    return out


# ── Text-layer scan ───────────────────────────────────────────────────────────

@dataclass(slots=True)
class TextLayerPage:
    index: int  # 0-based
    text: str
    chars: int
    structured: dict[str, Any]


@dataclass(slots=True)
class TextLayerScan:
    page_count: int
    pages: dict[int, TextLayerPage] = field(default_factory=dict)  # pages read locally
    ocr_indices: list[int] = field(default_factory=list)  # pages that need Document AI
    reasons: Counter = field(default_factory=Counter)

    @property
    def text_layer_count(self) -> int:
        return len(self.pages)


def _bbox(rect: Any, width: float, height: float) -> dict[str, float] | None:
    try:
        x0, y0, x1, y1 = (float(v) for v in rect)
    except Exception:
        return None
    if width <= 0 or height <= 0:
        return None

    def clamp(v: float) -> float:
        return max(0.0, min(1.0, v))

    left, top = clamp(x0 / width), clamp(y0 / height)
    right, bottom = clamp(x1 / width), clamp(y1 / height)
    return {
        "left": round(left, 6),
        "top": round(top, 6),
        "width": round(max(0.0, right - left), 6),
        "height": round(max(0.0, bottom - top), 6),
    }


def _image_area_ratio(page: Any) -> float:
    """Largest displayed image as a fraction of the page area (0 when no images)."""
    try:
        if not page.get_images(full=False):
            return 0.0
        rect = page.rect
        page_area = float(rect.width) * float(rect.height)
        if page_area <= 0:
            return 0.0
        best = 0.0
        for info in page.get_image_info() or []:
            box = info.get("bbox") if isinstance(info, dict) else None
            if not box:
                continue
            x0, y0, x1, y1 = (float(v) for v in box)
            area = max(0.0, x1 - x0) * max(0.0, y1 - y0)
            best = max(best, area / page_area)
        return best
    except Exception:
        return 0.0


def _layout_chars(layout: dict[str, Any]) -> int:
    """Characters of real text in a ``get_text("dict")`` layout (whitespace ignored)."""
    total = 0
    for block in layout.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                total += len(str(span.get("text") or "").strip())
    return total


def _structured_page(
    page: Any,
    index: int,
    *,
    layout: dict[str, Any],
    clean: Callable[[str], str] | None,
) -> tuple[str, dict[str, Any]]:
    """(page text, structured page) from the text layer, in the OCR viewer schema."""
    rect = page.rect
    width, height = float(rect.width), float(rect.height)

    blocks: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    page_lines: list[str] = []
    for block in layout.get("blocks") or []:
        if block.get("type") != 0:
            continue  # image block
        block_lines: list[str] = []
        for line in block.get("lines") or []:
            raw = "".join(str(span.get("text") or "") for span in line.get("spans") or [])
            text = raw.strip()
            if not text:
                continue
            if clean is not None:
                text = clean(text)
            block_lines.append(text)
            item: dict[str, Any] = {"type": "line", "text": text}
            box = _bbox(line.get("bbox"), width, height)
            if box:
                item["boundingBox"] = box
            lines.append(item)
        if not block_lines:
            continue
        block_text = "\n".join(block_lines)
        page_lines.extend(block_lines)
        item = {"type": "block", "text": block_text}
        box = _bbox(block.get("bbox"), width, height)
        if box:
            item["boundingBox"] = box
        blocks.append(item)

    page_text = "\n".join(page_lines)
    structured = {
        "pageNumber": index + 1,
        "dimension": {"width": width, "height": height, "unit": "pt"},
        "text": page_text,
        "blocks": blocks,
        # Document AI reports paragraphs and blocks separately; a text layer only
        # knows blocks, so the same items serve both (the viewer reads either).
        "paragraphs": [{**item, "type": "paragraph"} for item in blocks],
        "lines": lines,
        "tables": [],
        "source": "pdf_text_layer",
    }
    return page_text, structured


def scan_text_layer(
    data: bytes,
    *,
    min_chars: int = 40,
    image_area_ratio: float = 0.5,
    clean: Callable[[str], str] | None = None,
    force_all: bool = False,
    progress: Callable[[int, int], None] | None = None,
) -> TextLayerScan | None:
    """Read every page's text layer and decide which pages still need OCR.

    A page is read locally when it has at least ``min_chars`` characters of text
    and no image covering ``image_area_ratio`` or more of the page. A page with
    no text and no image at all is blank: it is kept locally (empty) rather than
    billed to OCR. ``force_all`` reads every page locally regardless (the OCR
    fallback path). Returns None when PyMuPDF is unavailable or the PDF is
    unreadable, so callers can fall back to the old whole-document behaviour.
    """
    if _mupdf is None:
        return None
    try:
        with _MUPDF_LOCK:
            doc = _mupdf.open(stream=data, filetype="pdf")
            try:
                total = int(doc.page_count)
                scan = TextLayerScan(page_count=total)
                for index in range(total):
                    page = doc[index]
                    # One layout call per page serves both the routing decision and
                    # the structured output — a separate get_text("text") pass would
                    # add ~40% to the scan of a 2,000-page file.
                    layout = page.get_text("dict", flags=_text_flags(), sort=True) or {}
                    if force_all:
                        reason = "forced"
                    else:
                        chars = _layout_chars(layout)
                        ratio = _image_area_ratio(page) if image_area_ratio > 0 else 0.0
                        if image_area_ratio > 0 and ratio >= image_area_ratio:
                            reason = "image_dominated"
                        elif chars >= min_chars:
                            reason = "text_layer"
                        elif chars == 0 and ratio == 0.0:
                            reason = "blank"
                        else:
                            reason = "too_little_text"
                    scan.reasons[reason] += 1
                    if reason in ("image_dominated", "too_little_text"):
                        scan.ocr_indices.append(index)
                    else:
                        text, structured = _structured_page(page, index, layout=layout, clean=clean)
                        scan.pages[index] = TextLayerPage(
                            index=index, text=text, chars=len(text), structured=structured
                        )
                    if progress is not None and (index % 50 == 49 or index == total - 1):
                        try:
                            progress(index + 1, total)
                        except Exception:
                            pass
                return scan
            finally:
                doc.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[PdfPages] text-layer scan failed: %s", exc)
        return None
