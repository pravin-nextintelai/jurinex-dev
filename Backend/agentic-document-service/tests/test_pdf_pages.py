"""Page routing for large PDFs: which pages are read locally and which go to Document AI.

A born-digital page carries its own text layer and is read with PyMuPDF; a scanned
page (dominated by an image, even with a thin text stamp) goes to OCR; a blank page
is kept locally as empty rather than billed. Ranges are split with MuPDF and page
numbers survive the split.
"""
from __future__ import annotations

import unittest

from app.services.adapters import pdf_pages

try:
    import pymupdf
except Exception:  # pragma: no cover
    pymupdf = None


def _build_pdf(spec: list[str]) -> bytes:
    """spec entries: 'text' | 'image' | 'blank' | 'image+stamp' (scan with a Bates stamp)."""
    src = pymupdf.open()
    for index, kind in enumerate(spec):
        page = src.new_page(width=595, height=842)
        if kind in ("text",):
            body = "\n".join(f"Line {n} of page {index + 1}: the petitioner submits that" for n in range(1, 31))
            page.insert_text((40, 60), f"PAGE HEADER {index + 1}\n" + body, fontsize=10, fontname="helv")
    text_pdf = src.tobytes()
    src.close()

    rendered = pymupdf.open(stream=text_pdf, filetype="pdf")
    out = pymupdf.open()
    for index, kind in enumerate(spec):
        page = out.new_page(width=595, height=842)
        if kind == "text":
            out.delete_page(-1)
            out.insert_pdf(rendered, from_page=index, to_page=index)
        elif kind in ("image", "image+stamp"):
            pix = rendered[index].get_pixmap(dpi=40)
            page.insert_image(page.rect, stream=pix.tobytes("png"))
            if kind == "image+stamp":
                page.insert_text((400, 820), f"ABC-{index + 1:06d}", fontsize=8, fontname="helv")
        # blank: nothing
    data = out.tobytes()
    out.close()
    rendered.close()
    return data


@unittest.skipIf(pymupdf is None, "PyMuPDF not installed")
class RoutingTests(unittest.TestCase):
    def test_pages_are_routed_by_content(self) -> None:
        data = _build_pdf(["text", "text", "image", "blank", "image+stamp", "text"])
        scan = pdf_pages.scan_text_layer(data, min_chars=40, image_area_ratio=0.5)
        self.assertIsNotNone(scan)
        self.assertEqual(scan.page_count, 6)
        self.assertEqual(scan.ocr_indices, [2, 4])
        self.assertEqual(sorted(scan.pages), [0, 1, 3, 5])
        self.assertEqual(scan.reasons["text_layer"], 3)
        self.assertEqual(scan.reasons["blank"], 1)
        self.assertEqual(scan.reasons["image_dominated"], 2)
        self.assertEqual(scan.pages[3].text, "")

    def test_structured_page_matches_viewer_schema(self) -> None:
        data = _build_pdf(["text"])
        scan = pdf_pages.scan_text_layer(data)
        page = scan.pages[0].structured
        self.assertEqual(page["pageNumber"], 1)
        self.assertEqual(page["source"], "pdf_text_layer")
        self.assertEqual(page["dimension"]["unit"], "pt")
        self.assertIn("PAGE HEADER 1", page["text"])
        self.assertTrue(page["lines"])
        self.assertTrue(page["blocks"])
        self.assertEqual(len(page["paragraphs"]), len(page["blocks"]))
        box = page["lines"][0]["boundingBox"]
        for key in ("left", "top", "width", "height"):
            self.assertGreaterEqual(box[key], 0.0)
            self.assertLessEqual(box[key], 1.0)
        self.assertEqual(page["lines"][0]["type"], "line")
        # Lines read top-to-bottom.
        self.assertEqual(page["lines"][0]["text"], "PAGE HEADER 1")
        self.assertTrue(page["lines"][1]["text"].startswith("Line 1 of page 1"))

    def test_cleaner_is_applied_to_lines(self) -> None:
        data = _build_pdf(["text"])
        scan = pdf_pages.scan_text_layer(data, clean=lambda s: s.replace("petitioner", "PETITIONER"))
        self.assertIn("PETITIONER", scan.pages[0].text)
        self.assertIn("PETITIONER", scan.pages[0].structured["lines"][1]["text"])

    def test_force_all_reads_every_page(self) -> None:
        data = _build_pdf(["text", "image", "blank"])
        scan = pdf_pages.scan_text_layer(data, force_all=True)
        self.assertEqual(scan.ocr_indices, [])
        self.assertEqual(sorted(scan.pages), [0, 1, 2])
        self.assertEqual(scan.reasons["forced"], 3)

    def test_mode_off_equivalent_min_chars(self) -> None:
        data = _build_pdf(["text", "text"])
        scan = pdf_pages.scan_text_layer(data, min_chars=10**9)
        self.assertEqual(scan.ocr_indices, [0, 1])


@unittest.skipIf(pymupdf is None, "PyMuPDF not installed")
class SplitTests(unittest.TestCase):
    def test_count_pages(self) -> None:
        data = _build_pdf(["text"] * 7)
        self.assertEqual(pdf_pages.count_pages(data), 7)
        self.assertEqual(pdf_pages.count_pages(b"not a pdf"), 0)

    def test_split_ranges_keeps_page_content(self) -> None:
        data = _build_pdf(["text"] * 7)
        parts = pdf_pages.split_ranges(data, [(0, 3), (3, 6), (6, 7)])
        self.assertEqual([pdf_pages.count_pages(p) for p in parts], [3, 3, 1])
        last = pdf_pages.scan_text_layer(parts[2], force_all=True)
        self.assertIn("PAGE HEADER 7", last.pages[0].text)
        middle = pdf_pages.scan_text_layer(parts[1], force_all=True)
        self.assertIn("PAGE HEADER 4", middle.pages[0].text)

    def test_split_ranges_pypdf_fallback_matches(self) -> None:
        data = _build_pdf(["text"] * 4)
        saved = pdf_pages._mupdf
        try:
            pdf_pages._mupdf = None
            parts = pdf_pages.split_ranges(data, [(0, 2), (2, 4)])
        finally:
            pdf_pages._mupdf = saved
        self.assertEqual([pdf_pages.count_pages(p) for p in parts], [2, 2])


class RangeMathTests(unittest.TestCase):
    def test_contiguous_runs(self) -> None:
        self.assertEqual(pdf_pages.contiguous_runs([]), [])
        self.assertEqual(pdf_pages.contiguous_runs([0, 1, 2, 5, 7, 8]), [(0, 3), (5, 6), (7, 9)])
        self.assertEqual(pdf_pages.contiguous_runs([3, 3, 1, 2]), [(1, 4)])

    def test_chunk_ranges(self) -> None:
        self.assertEqual(pdf_pages.chunk_ranges([(0, 70)], 30), [(0, 30), (30, 60), (60, 70)])
        self.assertEqual(pdf_pages.chunk_ranges([(2, 5), (6, 7)], 2), [(2, 4), (4, 5), (6, 7)])
        self.assertEqual(pdf_pages.chunk_ranges([], 15), [])
        self.assertEqual(pdf_pages.chunk_ranges([(0, 3)], 0), [(0, 1), (1, 2), (2, 3)])

    def test_two_thousand_pages_need_67_imageless_requests(self) -> None:
        self.assertEqual(len(pdf_pages.chunk_ranges([(0, 2000)], 30)), 67)
        self.assertEqual(len(pdf_pages.chunk_ranges([(0, 2000)], 15)), 134)


if __name__ == "__main__":
    unittest.main()
