"""Routed OCR: only scanned pages go to Document AI, and results interleave in page order.

Document AI is replaced by a fake that answers from the page numbers of the range it
receives, so these tests cost nothing and run offline. They pin down:
  * which page ranges are requested (contiguous runs, cut at the page limit),
  * that born-digital pages never leave the machine,
  * that the merged document has every page in order with the right source,
  * that a failed request keeps its pages (empty) instead of dropping them,
  * that PDF_TEXT_LAYER_MODE=off restores the old every-page-to-OCR behaviour,
  * and that progress reporting is monotonic and ends at progress_end.
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.adapters import ocr, pdf_pages
from app.services.chronology.pages import text_with_page_markers

try:
    import pymupdf
except Exception:  # pragma: no cover
    pymupdf = None


def _build_pdf(spec: list[str]) -> bytes:
    src = pymupdf.open()
    for index, kind in enumerate(spec):
        page = src.new_page(width=595, height=842)
        if kind == "text":
            body = "\n".join(f"Line {n} of page {index + 1}: the petitioner submits that" for n in range(1, 31))
            page.insert_text((40, 60), f"PAGE HEADER {index + 1}\n" + body, fontsize=10, fontname="helv")
    text_pdf = src.tobytes()
    src.close()
    rendered = pymupdf.open(stream=text_pdf, filetype="pdf")
    out = pymupdf.open()
    for index, kind in enumerate(spec):
        if kind == "text":
            out.insert_pdf(rendered, from_page=index, to_page=index)
        else:
            page = out.new_page(width=595, height=842)
            if kind == "image":
                pix = rendered[index].get_pixmap(dpi=40)
                page.insert_image(page.rect, stream=pix.tobytes("png"))
    data = out.tobytes()
    out.close()
    rendered.close()
    return data


def _fake_document_ai(fail_offsets: set[int] = frozenset()):
    calls: list[tuple[int, int, bool | None]] = []

    def fake(batch_bytes, mime_type, client, processor_name, page_offset=0, process_options=None,
             include_tokens=False, imageless=None):
        n = pdf_pages.count_pages(batch_bytes)
        calls.append((page_offset, n, imageless))
        if page_offset in fail_offsets:
            raise RuntimeError("simulated Document AI failure")
        pages = [
            {
                "pageNumber": page_offset + i + 1,
                "dimension": {"width": 595.0, "height": 842.0, "unit": "pt"},
                "text": f"OCR TEXT page {page_offset + i + 1}",
                "blocks": [],
                "paragraphs": [],
                "lines": [{"type": "line", "text": f"OCR TEXT page {page_offset + i + 1}"}],
                "tables": [],
            }
            for i in range(n)
        ]
        text = "\n\n".join(p["text"] for p in pages)
        return ocr.OcrResult(
            text=text,
            page_count=n,
            quality_score=0.9,
            structured_json={
                "schemaVersion": 1,
                "source": "document_ai_ocr",
                "provider": "google_document_ai",
                "text": text,
                "pageCount": n,
                "pages": pages,
            },
        )

    return fake, calls


@unittest.skipIf(pymupdf is None, "PyMuPDF not installed")
class RoutedOcrTests(unittest.TestCase):
    SPEC = ["text", "text", "image", "image", "image", "text", "image"]

    def _run(self, spec, *, mode="hybrid", page_limit=2, fail_offsets=frozenset()):
        data = _build_pdf(spec)
        fake, calls = _fake_document_ai(fail_offsets)
        progress: list[float] = []
        with patch.object(ocr, "_call_document_ai", fake), \
             patch.object(ocr, "_text_layer_mode", lambda: mode), \
             patch.object(ocr, "_get_page_limit", lambda: page_limit), \
             patch.object(ocr, "_get_ocr_workers", lambda: 3), \
             patch.object(ocr, "_imageless_mode", lambda: True):
            result = ocr._parallel_ocr_bytes(
                data, "application/pdf", client=None, processor_name="projects/p/processors/x",
                progress_callback=progress.append, progress_start=22.0, progress_end=63.0,
            )
        return result, calls, progress

    def test_only_scanned_pages_are_sent_in_contiguous_ranges(self) -> None:
        result, calls, progress = self._run(self.SPEC)
        # OCR pages are 3,4,5 and 7 (1-based) -> runs (2,5) and (6,7) cut at 2 pages/request.
        self.assertEqual(sorted((offset, n) for offset, n, _ in calls), [(2, 2), (4, 1), (6, 1)])
        self.assertTrue(all(imageless is True for _, _, imageless in calls))
        self.assertEqual(result.page_count, 7)
        pages = result.structured_json["pages"]
        self.assertEqual([p["pageNumber"] for p in pages], [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual([p["source"] for p in pages], [
            "pdf_text_layer", "pdf_text_layer", "document_ai_ocr", "document_ai_ocr",
            "document_ai_ocr", "pdf_text_layer", "document_ai_ocr",
        ])
        self.assertIn("PAGE HEADER 1", pages[0]["text"])
        self.assertEqual(pages[2]["text"], "OCR TEXT page 3")
        self.assertIn("PAGE HEADER 6", pages[5]["text"])
        self.assertEqual(pages[6]["text"], "OCR TEXT page 7")
        routing = result.structured_json["routing"]
        self.assertEqual((routing["text_layer_pages"], routing["ocr_pages"], routing["ocr_requests"]), (3, 4, 3))
        self.assertEqual(result.structured_json["source"], "document_ai_ocr")
        # Text is in page order.
        text = result.text
        self.assertLess(text.index("PAGE HEADER 1"), text.index("OCR TEXT page 3"))
        self.assertLess(text.index("OCR TEXT page 5"), text.index("PAGE HEADER 6"))
        self.assertLess(text.index("PAGE HEADER 6"), text.index("OCR TEXT page 7"))
        # Progress is monotonic and finishes at progress_end.
        self.assertEqual(progress, sorted(progress))
        self.assertEqual(progress[-1], 63.0)
        self.assertGreaterEqual(progress[0], 22.0)

    def test_page_stamps_follow_merged_order(self) -> None:
        result, _, _ = self._run(self.SPEC)
        stamped = text_with_page_markers(result.structured_json)
        self.assertIn("[PAGE 1]\nPAGE HEADER 1", stamped)
        self.assertIn("[PAGE 3]\nOCR TEXT page 3", stamped)
        self.assertIn("[PAGE 7]\nOCR TEXT page 7", stamped)
        self.assertLess(stamped.index("[PAGE 2]"), stamped.index("[PAGE 3]"))
        self.assertLess(stamped.index("[PAGE 6]"), stamped.index("[PAGE 7]"))

    def test_failed_request_keeps_its_pages(self) -> None:
        result, calls, _ = self._run(self.SPEC, fail_offsets={4})
        pages = result.structured_json["pages"]
        self.assertEqual(result.page_count, 7)
        self.assertEqual(pages[4]["pageNumber"], 5)
        self.assertEqual(pages[4]["source"], "ocr_failed")
        self.assertEqual(pages[4]["text"], "")
        self.assertEqual(pages[2]["text"], "OCR TEXT page 3")
        self.assertEqual(pages[6]["text"], "OCR TEXT page 7")
        stamped = text_with_page_markers(result.structured_json)
        self.assertNotIn("[PAGE 5]", stamped)  # empty page carries no stamp
        self.assertIn("[PAGE 6]", stamped)

    def test_mode_off_sends_every_page(self) -> None:
        result, calls, _ = self._run(self.SPEC, mode="off")
        self.assertEqual(sorted((offset, n) for offset, n, _ in calls), [(0, 2), (2, 2), (4, 2), (6, 1)])
        routing = result.structured_json["routing"]
        self.assertEqual((routing["text_layer_pages"], routing["ocr_pages"], routing["ocr_requests"]), (0, 7, 4))
        self.assertEqual([p["text"] for p in result.structured_json["pages"]],
                         [f"OCR TEXT page {n}" for n in range(1, 8)])

    def test_all_digital_pdf_needs_no_ocr(self) -> None:
        result, calls, progress = self._run(["text", "text", "text"])
        self.assertEqual(calls, [])
        self.assertEqual(result.page_count, 3)
        self.assertEqual(result.structured_json["source"], "pdf_text_layer")
        self.assertEqual(result.structured_json["routing"]["ocr_requests"], 0)
        self.assertIn("PAGE HEADER 2", result.structured_json["pages"][1]["text"])
        self.assertEqual(progress[-1], 63.0)

    def test_page_limit_thirty_gives_67_requests_for_2000_pages(self) -> None:
        ranges = pdf_pages.chunk_ranges(pdf_pages.contiguous_runs(list(range(2000))), 30)
        self.assertEqual(len(ranges), 67)
        self.assertEqual(ranges[0], (0, 30))
        self.assertEqual(ranges[-1], (1980, 2000))


@unittest.skipIf(pymupdf is None, "PyMuPDF not installed")
class NoDocumentAiConfiguredTests(unittest.TestCase):
    def test_bytes_extraction_uses_text_layer_when_document_ai_is_not_configured(self) -> None:
        data = _build_pdf(["text", "image", "text"])
        settings = SimpleNamespace(google_cloud_project="", google_cloud_location="us", document_ai_processor_id="")
        with patch("app.core.config.get_settings", lambda: settings):
            result = ocr.extract_text_from_bytes(data, "application/pdf", "doc.pdf")
        self.assertEqual(result.page_count, 3)
        self.assertEqual(result.structured_json["source"], "pdf_text_layer")
        self.assertIn("PAGE HEADER 1", result.structured_json["pages"][0]["text"])
        self.assertEqual(result.structured_json["pages"][1]["text"], "")
        self.assertIn("PAGE HEADER 3", result.structured_json["pages"][2]["text"])


if __name__ == "__main__":
    unittest.main()
