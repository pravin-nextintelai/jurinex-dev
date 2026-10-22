import React, { useCallback, useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Virtuoso } from 'react-virtuoso';
import {
  PDF_VIEWER_PAGE_HEIGHT,
  PAGE_LABEL_HEIGHT,
  pageRenderHeight,
} from './constants';
import type { PreviewKind } from './previewKind';
import 'react-pdf/dist/Page/TextLayer.css';
// Vite resolves `?url` to the emitted worker asset; a bare specifier would not resolve here.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Fetch the PDF with a single plain GET. pdf.js otherwise pulls the file with HTTP Range requests,
 * which the browser blocks because the bucket's CORS omits `Range` from access-control-allow-headers.
 * Once Range/Content-Range are added to the bucket CORS these flags can be dropped for progressive
 * loading. Kept at module scope on purpose: a fresh object identity re-downloads the document.
 */
const PDF_OPTIONS = {
  disableRange: true,
  disableStream: true,
  disableAutoFetch: true,
};

export interface PdfPanelProps {
  pdfUrl: string | null;
  pageCount: number;
  currentPage: number;
  onPageCount?: (pageCount: number) => void;
  onScrollerRef?: (el: HTMLDivElement | null) => void;
  zoom: number;
  previewKind?: PreviewKind;
  onDownload?: () => void;
}

const PdfPanel: React.FC<PdfPanelProps> = ({
  pdfUrl,
  pageCount,
  currentPage,
  onPageCount,
  onScrollerRef,
  zoom,
  previewKind = 'pdf',
  onDownload,
}) => {
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const [pdfFailed, setPdfFailed] = useState(false);

  // Must keep a stable identity: Virtuoso re-invokes scrollerRef whenever the callback changes.
  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      onScrollerRef?.(el instanceof HTMLDivElement ? el : null);
    },
    [onScrollerRef],
  );

  // Signed URLs carry no fragment of their own, but strip one defensively so #page= stays ours.
  const baseUrl = pdfUrl ? pdfUrl.split('#')[0] : null;
  const totalPages = loadedPageCount || pageCount || 0;

  useEffect(() => {
    setPdfFailed(false);
    setLoadedPageCount(0);
  }, [baseUrl]);

  useEffect(() => {
    if (pageCount > 0) onPageCount?.(pageCount);
  }, [pageCount, onPageCount]);

  // Scroll position is owned by OcrDocumentModal, which drives this panel's scroller directly and
  // mirrors it to the OCR panel; both lists share PDF_VIEWER_PAGE_HEIGHT so their offsets map 1:1.

  if (!baseUrl) {
    return (
      <div className="flex flex-col h-full min-h-0 gap-3">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          Original Document
        </h3>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm bg-gray-50 rounded-lg border border-gray-200">
          Original file preview unavailable
        </div>
      </div>
    );
  }

  // A file the browser cannot display must never reach the iframe below. Navigating an iframe to, say, a
  // .docx makes the browser treat it as a download instead of a view, so the panel stayed blank AND the
  // file landed in Downloads just for opening the preview. Offer the download explicitly instead.
  if (previewKind === 'unsupported') {
    return (
      <div className="flex flex-col h-full min-h-0 gap-3">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          Original Document
        </h3>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              This file type cannot be previewed
            </p>
            <p className="text-xs text-gray-500 max-w-md">
              The reconstructed text is still shown in the OCR panel.
            </p>
          </div>
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white"
              style={{ backgroundColor: '#21C1B6' }}
            >
              Download original
            </button>
          )}
        </div>
      </div>
    );
  }

  // Fallback: if pdf.js cannot load the file (worker failure, CORS, corrupt PDF) hand the URL to the
  // browser's own viewer. It only honours #page=N on initial load, hence the key-based remount. Safe for
  // the kinds that reach here: the browser renders PDFs, images and text natively.
  if (pdfFailed || previewKind === 'native') {
    return (
      <div className="flex flex-col h-full min-h-0 gap-3">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          Original Document
        </h3>
        <div className="flex-1 min-h-0 overflow-auto bg-gray-100 rounded-lg border border-gray-200">
          <iframe
            key={currentPage}
            src={`${baseUrl}#page=${currentPage}`}
            title="Original document"
            className="w-full h-full min-h-[720px] border-0 bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <h3 className="text-sm font-semibold text-gray-900 shrink-0">
        Original Document ({Math.round(zoom * 100)}%)
      </h3>
      <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-100 overflow-hidden">
        <Document
          file={baseUrl}
          options={PDF_OPTIONS}
          onLoadSuccess={({ numPages }) => {
            setLoadedPageCount(numPages);
            onPageCount?.(numPages);
          }}
          onLoadError={(err) => {
            console.warn(
              '[OCR PREVIEW] pdf.js could not load the document; falling back to the browser viewer:',
              err,
            );
            setPdfFailed(true);
          }}
          loading={
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Loading PDF…
            </div>
          }
          className="h-full"
        >
          {totalPages > 0 && (
            <Virtuoso
              style={{ height: '100%' }}
              totalCount={totalPages}
              fixedItemHeight={PDF_VIEWER_PAGE_HEIGHT}
              defaultItemHeight={PDF_VIEWER_PAGE_HEIGHT}
              scrollerRef={handleScrollerRef}
              increaseViewportBy={{ top: 1200, bottom: 1800 }}
              itemContent={(index) => (
                <div
                  data-page={index + 1}
                  className="flex flex-col px-1 py-1 bg-gray-100"
                  style={{ height: PDF_VIEWER_PAGE_HEIGHT }}
                >
                  <div
                    className="mb-0 text-[10px] text-gray-500 flex items-center justify-between shrink-0"
                    style={{ height: PAGE_LABEL_HEIGHT }}
                  >
                    <span className="font-medium text-gray-700">
                      Page {index + 1}
                    </span>
                    <span className="opacity-70">
                      {index + 1} / {totalPages}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                    <Page
                      pageNumber={index + 1}
                      height={pageRenderHeight(zoom)}
                      renderAnnotationLayer={false}
                      renderTextLayer
                      loading={
                        <div className="text-xs text-gray-400">Rendering…</div>
                      }
                      className="shadow-sm bg-white"
                    />
                  </div>
                </div>
              )}
            />
          )}
        </Document>
      </div>
    </div>
  );
};

export default PdfPanel;
