import React, { useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { OcrJson, OcrMetadata, OcrPage } from '../../types/ocr';
import type {
  OcrDisplayMode,
  OcrConfidenceFilter,
} from '../../hooks/useOcrDocumentViewer';
import OcrPageView from './OcrPage';
import { PDF_VIEWER_PAGE_HEIGHT, PAGE_LABEL_HEIGHT } from './constants';

const OcrConfidenceLegend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-gray-500">
    <span className="font-medium text-gray-600 shrink-0 ">Legend:</span>
    <span className="inline-flex items-center gap-0.5">
      <span className="w-5 h-2 rounded-full bg-emerald-400/70 border border-emerald-500 shrink-0" />
      <span>High ≥0.95</span>
    </span>
    <span className="inline-flex items-center gap-0.5">
      <span className="w-5 h-2 rounded-full bg-amber-400/70 border border-amber-500 shrink-0" />
      <span>Med 0.85–0.95</span>
    </span>
    <span className="inline-flex items-center gap-0.5">
      <span className="w-5 h-2 rounded-full bg-red-400/70 border border-red-500 shrink-0" />
      <span>Low &lt;0.85</span>
    </span>
  </div>
);

export interface OcrPanelProps {
  ocrData: OcrJson | null;
  metadata: OcrMetadata | null;
  displayMode: OcrDisplayMode;
  zoom: number;
  confidenceFilter: OcrConfidenceFilter;
  onScrollerRef?: (el: HTMLDivElement | null) => void;
  onVisibleRange?: (fromPage: number, toPage: number) => void;
}

const OcrPanel: React.FC<OcrPanelProps> = ({
  ocrData,
  metadata,
  displayMode,
  zoom,
  confidenceFilter,
  onScrollerRef,
  onVisibleRange,
}) => {
  const totalPages =
    ocrData?.pageCount ||
    metadata?.pageCount ||
    ocrData?.pages?.length ||
    0;
  const hasOcrPages = totalPages > 0;

  const pageByNumber = useMemo(() => {
    const map = new Map<number, OcrPage>();
    (ocrData?.pages || []).forEach((page) => map.set(page.page, page));
    return map;
  }, [ocrData?.pages]);

  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      onScrollerRef?.(el instanceof HTMLDivElement ? el : null);
    },
    [onScrollerRef],
  );

  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      onVisibleRange?.(range.startIndex + 1, range.endIndex + 1);
    },
    [onVisibleRange],
  );

  // Scroll position is owned by OcrDocumentModal, which drives this panel's scroller directly and
  // mirrors it to the PDF panel; both lists share PDF_VIEWER_PAGE_HEIGHT so their offsets map 1:1.

  if (!hasOcrPages) {
    return (
      <div className="flex-1 flex flex-col gap-5">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-900">OCR View</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg bg-gray-50/60">
          OCR data unavailable
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          OCR View ({Math.round(zoom * 100)}%)
        </h3>
        <OcrConfidenceLegend />
      </div>

      {displayMode !== 'words' && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 mb-1">
          Display mode <strong>{displayMode}</strong> is not fully implemented
          yet. Showing word-level tokens for now.
        </div>
      )}

      <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
        <Virtuoso
          style={{ height: '100%' }}
          totalCount={totalPages}
          fixedItemHeight={PDF_VIEWER_PAGE_HEIGHT}
          defaultItemHeight={PDF_VIEWER_PAGE_HEIGHT}
          computeItemKey={(index) => index + 1}
          scrollerRef={handleScrollerRef}
          increaseViewportBy={{ top: 400, bottom: 800 }}
          rangeChanged={handleRangeChanged}
          itemContent={(index) => {
            const pageNumber = index + 1;
            const p = pageByNumber.get(pageNumber);
            if (!p) {
              return (
                <div
                  className="flex items-center justify-center text-xs text-gray-500 bg-gray-50"
                  style={{ height: PDF_VIEWER_PAGE_HEIGHT }}
                >
                  Loading page {pageNumber}…
                </div>
              );
            }
            if (!p.words?.length) {
              return (
                <div
                  className="flex items-center justify-center text-xs text-gray-400 bg-gray-50"
                  style={{ height: PDF_VIEWER_PAGE_HEIGHT }}
                >
                  No OCR text on page {pageNumber}
                </div>
              );
            }
            return (
              <div
                data-page={pageNumber}
                className="flex flex-col px-1 py-1 bg-gray-50"
                style={{ height: PDF_VIEWER_PAGE_HEIGHT }}
              >
                <div
                  className="mb-0 text-[10px] text-gray-500 flex items-center justify-between shrink-0"
                  style={{ height: PAGE_LABEL_HEIGHT }}
                >
                  <span className="font-medium text-gray-700">
                    Page {pageNumber}
                  </span>
                  <span className="opacity-70">
                    {pageNumber} / {totalPages || '—'}
                  </span>
                </div>
                <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                  <OcrPageView
                    page={p}
                    zoom={zoom}
                    confidenceFilter={confidenceFilter}
                  />
                </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
};

export default OcrPanel;

