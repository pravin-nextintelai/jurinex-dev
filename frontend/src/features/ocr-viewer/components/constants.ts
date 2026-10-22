/** Fixed height per page for both PDF (left) and OCR (right) panels so scroll positions align 1:1. */
export const PDF_VIEWER_PAGE_HEIGHT = 900;

/** Height of the per-page "Page N" label row. Pinned to this value in BOTH panels — when one panel
 *  let the label take its natural height instead, the page rect below it started at a different y
 *  than the other panel's. */
export const PAGE_LABEL_HEIGHT = 18;

/** Vertical padding of a page slot (`py-1` = 4px top + 4px bottom), in both panels. */
export const PAGE_SLOT_PADDING_Y = 8;

/**
 * The height both panels draw a page rect at — the single source of scale for the viewer.
 *
 * Both panels MUST be height-driven from this one number, letting each page's width follow its own
 * aspect ratio. Previously only the PDF was height-driven; the OCR page was width-driven (`w-full`
 * + `aspectRatio` under a `flex items-stretch` parent, which resolved both axes and so made
 * `aspectRatio` a no-op). The OCR page therefore filled the whole panel rect while the PDF page was
 * letterboxed to its true aspect — two different rects, so a word's `top: (bbox.y / height) * 100%`
 * landed at a different y on each side.
 *
 * Subtracts the label AND the slot padding so the rect actually fits its flex-1 container; the old
 * `(PDF_VIEWER_PAGE_HEIGHT - PAGE_LABEL_HEIGHT)` overflowed it by the 8px padding and was clipped.
 */
export const pageRenderHeight = (zoom: number): number =>
  Math.round((PDF_VIEWER_PAGE_HEIGHT - PAGE_LABEL_HEIGHT - PAGE_SLOT_PADDING_Y) * zoom);
