import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { OcrJson } from '../../types/ocr';
import useOcrDocumentViewer from '../../hooks/useOcrDocumentViewer';
import OcrToolbar from './OcrToolbar';
import OcrStats from './OcrStats';
import PdfPanel from './PdfPanel';
import DocxPanel from './DocxPanel';
import OcrPanel from './OcrPanel';
import { resolvePreviewKind } from './previewKind';
import { getFileExtension } from '../../utils/fileHelpers';
import { PDF_VIEWER_PAGE_HEIGHT } from './constants';

interface OcrDocumentModalProps {
  document: {
    id: string;
    name?: string;
    mimetype?: string;
    status?: string;
    viewUrl?: string | null;
    previewUrl?: string | null;
    caseId?: string | null;
    filePath?: string | null;
  };
  onClose: () => void;
}

const OcrDocumentModal: React.FC<OcrDocumentModalProps> = ({
  document,
  onClose,
}) => {
  // Debug log for received props
  React.useEffect(() => {
    console.log('[OCR PREVIEW] OcrDocumentModal received document props:', {
      id: document?.id,
      name: document?.name,
      caseId: document?.caseId,
      hasFilePath: !!document?.filePath,
    });
  }, [document]);

  const [isFullSize, setIsFullSize] = useState(false);

  const leftScrollerRef = useRef<HTMLDivElement | null>(null);
  const rightScrollerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const lastSyncedPageRef = useRef(1);
  // Bumped when a panel hands over its scroller so the mirror effect re-attaches. The refs are never
  // cleared elsewhere: Virtuoso's scrollerRef callback fires once, so nulling them would strand it.
  const [scrollersReady, setScrollersReady] = useState(0);

  // Bail out when handed the element we already hold: Virtuoso re-invokes scrollerRef on re-render, so
  // an unguarded setState here re-renders and re-invokes it again — an infinite update loop.
  const onLeftScrollerRef = useCallback((el: HTMLDivElement | null) => {
    if (leftScrollerRef.current === el) return;
    leftScrollerRef.current = el;
    if (el) setScrollersReady((v) => v + 1);
  }, []);
  const onRightScrollerRef = useCallback((el: HTMLDivElement | null) => {
    if (rightScrollerRef.current === el) return;
    rightScrollerRef.current = el;
    if (el) setScrollersReady((v) => v + 1);
  }, []);

  const {
    overview,
    pdfUrl,
    ocrData,
    metadata,
    loading,
    error,
    currentPage,
    setCurrentPage,
    zoom,
    setZoom,
    isOcrVisible,
    setIsOcrVisible,
    displayMode,
    setDisplayMode,
    hasOcrData,
    ocrProgress,
    isPollingOcr,
    reload,
    confidenceFilter,
    setConfidenceFilter,
    ensureOcrRange,
  } = useOcrDocumentViewer(document?.id);

  const modalRoot =
    typeof window !== 'undefined' && window.document?.body
      ? window.document.body
      : null;

  const totalPagesFromOcr: number =
    Number((ocrData as OcrJson | null)?.pageCount || 0) ||
    Number(overview?.page_count || 0) ||
    Number((ocrData as OcrJson | null)?.pages?.length || 0);

  const handleClose = () => {
    console.log('[OCR PREVIEW] Close button clicked, closing modal');
    // Clear any ongoing polling
    if ((window as any).__ocrPollingInterval) {
      console.log('[OCR PREVIEW] Clearing OCR polling interval on modal close');
      clearInterval((window as any).__ocrPollingInterval);
      delete (window as any).__ocrPollingInterval;
    }
    onClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      console.log('[OCR PREVIEW] Modal backdrop clicked, closing modal');
      // Clear any ongoing polling
      if ((window as any).__ocrPollingInterval) {
        console.log('[OCR PREVIEW] Clearing OCR polling interval on modal close');
        clearInterval((window as any).__ocrPollingInterval);
        delete (window as any).__ocrPollingInterval;
      }
      onClose();
    }
  };

  const pdfUrlResolved =
    pdfUrl || document.previewUrl || document.viewUrl || null;

  // The URL above serves the RAW upload, so the renderer has to be chosen by what that file actually is
  // rather than assumed to be a PDF. The view response is authoritative (it reads the user_files row);
  // the caller's props are the fallback for when that request failed and returned no document at all.
  const originalName = overview?.file_name || document?.name || null;
  const previewKind = resolvePreviewKind(
    overview?.mimetype || document?.mimetype,
    originalName,
  );

  // Debug log for PDF URL resolution
  React.useEffect(() => {
    if (pdfUrlResolved) {
      console.log('[OCR PREVIEW] Loading original PDF into left panel');
      console.log('[OCR PREVIEW] pdfUrlResolved:', pdfUrlResolved?.substring(0, 100) + '...');
    }
    if (ocrData) {
      console.log('[OCR PREVIEW] Loading OCR JSON into right panel');
      console.log('[OCR PREVIEW] OCR loaded successfully');
    }
  }, [pdfUrlResolved, ocrData]);
  
  // Log when PDF URL changes to pass to PdfPanel
  React.useEffect(() => {
    console.log('[OCR PREVIEW] PDF URL changed, passing to PdfPanel:', {
      pdfUrl: pdfUrlResolved,
      hasUrl: !!pdfUrlResolved,
      urlType: typeof pdfUrlResolved,
      urlLength: pdfUrlResolved?.length || 0
    });
  }, [pdfUrlResolved]);
  
  // Listen for OCR completion events
  React.useEffect(() => {
    const handleOcrCompleted = (event: CustomEvent) => {
      console.log('[OCR PREVIEW] OCR completion event received in modal:', event.detail);
      // The hook will handle reloading data automatically
    };
    
    window.addEventListener('ocr-completed', handleOcrCompleted as EventListener);
    
    return () => {
      window.removeEventListener('ocr-completed', handleOcrCompleted as EventListener);
    };
  }, []);
  
  // Cleanup polling interval on unmount
  React.useEffect(() => {
    return () => {
      console.log('[OCR PREVIEW] Clearing OCR polling interval');
      if ((window as any).__ocrPollingInterval) {
        clearInterval((window as any).__ocrPollingInterval);
        delete (window as any).__ocrPollingInterval;
      }
    };
  }, []);

  // Both panels now render into our own DOM as virtualized lists sharing PDF_VIEWER_PAGE_HEIGHT, so a
  // scroll offset means the same thing in each and can be mirrored 1:1. This modal owns every scroll:
  // panels only expose their scroller and report the page they land on.
  const scrollTo = useCallback((top: number) => {
    isSyncingScrollRef.current = true;
    const left = leftScrollerRef.current;
    const right = rightScrollerRef.current;
    if (left) left.scrollTop = top;
    if (right) right.scrollTop = top;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  // Mirror scrolling between the panels and derive the page from the offset. The page is computed from
  // scrollTop rather than Virtuoso's rangeChanged because that reports the *rendered* range, which
  // includes the increaseViewportBy overscan and would name a page above the one on screen.
  // Assigning an unchanged scrollTop fires no scroll event, so the mirror settles after one hop.
  useEffect(() => {
    const left = leftScrollerRef.current;
    const right = rightScrollerRef.current;
    const scrollers = [left, right].filter(Boolean) as HTMLDivElement[];
    if (!scrollers.length) return;

    const onScroll = (from: HTMLDivElement) => () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      const top = from.scrollTop;
      for (const other of scrollers) {
        if (other !== from) other.scrollTop = top;
      }
      const page = Math.max(1, Math.floor(top / PDF_VIEWER_PAGE_HEIGHT) + 1);
      if (page !== lastSyncedPageRef.current) {
        lastSyncedPageRef.current = page;
        setCurrentPage(page);
      }
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    };

    const handlers = scrollers.map((el) => {
      const handler = onScroll(el);
      el.addEventListener('scroll', handler, { passive: true });
      return { el, handler };
    });
    return () => {
      for (const { el, handler } of handlers) {
        el.removeEventListener('scroll', handler);
      }
    };
  }, [isOcrVisible, scrollersReady, setCurrentPage]);

  const setCurrentPageFromToolbar = useCallback(
    (page: number) => {
      lastSyncedPageRef.current = page;
      setCurrentPage(page);
      scrollTo((page - 1) * PDF_VIEWER_PAGE_HEIGHT);
    },
    [setCurrentPage, scrollTo],
  );

  // Base and extension must come from the SAME name, or a caller that only knows the placeholder
  // "Untitled document" would pair it with the real file's extension: "Untitled_document.docx".
  const safeBaseFilename = useCallback(() => {
    const rawName = originalName || 'document';
    return rawName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'document';
  }, [originalName]);

  // This button downloads the ORIGINAL bytes, so it has to keep the original extension. It used to hard
  // code ".pdf", which handed back a .docx named .pdf that the OS then opened with the wrong app.
  const originalDownloadName = useCallback(
    () => `${safeBaseFilename()}${getFileExtension(originalName || '') || '.pdf'}`,
    [safeBaseFilename, originalName],
  );

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = filename;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const downloadUrl = useCallback(
    async (url: string | null, filename: string) => {
      if (!url) {
        alert('Download URL is not available yet.');
        return;
      }
      const cleanUrl = url.split('#')[0];
      try {
        const response = await fetch(cleanUrl);
        if (!response.ok) {
          throw new Error(`Download failed with HTTP ${response.status}`);
        }
        const blob = await response.blob();
        triggerBlobDownload(blob, filename);
      } catch (err) {
        console.warn('[OCR PREVIEW] Direct blob download failed; opening signed URL instead:', err);
        window.open(cleanUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [triggerBlobDownload],
  );

  const wordMatchesConfidence = useCallback(
    (confidence: number, variant: 'plain' | 'high' | 'medium' | 'low') => {
      if (variant === 'plain') return false;
      if (variant === 'high') return confidence >= 0.95;
      if (variant === 'medium') return confidence >= 0.85 && confidence < 0.95;
      return confidence < 0.85;
    },
    [],
  );

  const confidenceStrokeColor = useCallback((variant: 'plain' | 'high' | 'medium' | 'low') => {
    if (variant === 'high') return [16, 185, 129] as const;
    if (variant === 'medium') return [245, 158, 11] as const;
    if (variant === 'low') return [239, 68, 68] as const;
    return [17, 24, 39] as const;
  }, []);

  const sortedWordsForPage = useCallback(
    (page: NonNullable<typeof ocrData>['pages'][number]) => {
      const words = [...(page.words || [])];
      words.sort((a, b) => {
        const dy = (a.bbox?.y || 0) - (b.bbox?.y || 0);
        if (Math.abs(dy) > 8) return dy;
        return (a.bbox?.x || 0) - (b.bbox?.x || 0);
      });
      return words;
    },
    [],
  );

  const downloadOcrPdf = useCallback(
    async (variant: 'plain' | 'high' | 'medium' | 'low') => {
      if (!ocrData?.pages?.length) {
        alert('OCR reconstruction is not available for download.');
        return;
      }

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
      const pageWidthPt = pdf.internal.pageSize.getWidth();
      const pageHeightPt = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const usableWidth = pageWidthPt - margin * 2;
      const usableHeight = pageHeightPt - margin * 2;
      const drawBoxes = variant !== 'plain';

      ocrData.pages.forEach((page, pageIndex) => {
        if (pageIndex > 0) pdf.addPage('a4', 'portrait');

        const sourceWidth = Math.max(1, Number(page.width || 1000));
        const sourceHeight = Math.max(1, Number(page.height || 1414));
        const scale = Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight);
        const renderedWidth = sourceWidth * scale;
        const renderedHeight = sourceHeight * scale;
        const offsetX = (pageWidthPt - renderedWidth) / 2;
        const offsetY = (pageHeightPt - renderedHeight) / 2;

        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidthPt, pageHeightPt, 'F');
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.5);
        pdf.rect(offsetX, offsetY, renderedWidth, renderedHeight, 'S');

        const strokeColor = confidenceStrokeColor(variant);
        const words = sortedWordsForPage(page);

        words.forEach((word) => {
          const bbox = word.bbox || { x: 0, y: 0, w: 0, h: 0 };
          const x = offsetX + Number(bbox.x || 0) * scale;
          const y = offsetY + Number(bbox.y || 0) * scale;
          const w = Math.max(1, Number(bbox.w || 1) * scale);
          const h = Math.max(1, Number(bbox.h || 1) * scale);
          const confidence = Number(word.confidence ?? 1);
          const fontSize = Math.max(3.5, Math.min(11, h * 0.72));

          if (drawBoxes && wordMatchesConfidence(confidence, variant)) {
            pdf.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
            pdf.setLineWidth(0.6);
            pdf.rect(x, y, w, h, 'S');
          }

          pdf.setTextColor(17, 24, 39);
          pdf.setFont('times', 'normal');
          pdf.setFontSize(fontSize);
          pdf.text(String(word.text || ''), x + w / 2, y + h * 0.72, {
            align: 'center',
            maxWidth: Math.max(1, w),
            baseline: 'alphabetic',
          });
        });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page ${page.page || pageIndex + 1}`, margin, pageHeightPt - 10);
      });

      const suffix = variant === 'plain' ? 'reconstructed' : `confidence-${variant}`;
      pdf.save(`${safeBaseFilename()}-ocr-${suffix}.pdf`);
    },
    [confidenceStrokeColor, ocrData, safeBaseFilename, sortedWordsForPage, wordMatchesConfidence],
  );


  const content = (
    <div
      className={`fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center ${
        isFullSize ? 'p-0' : 'p-4'
      }`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white flex flex-col overflow-hidden ${
          isFullSize ? '' : 'rounded-2xl shadow-2xl'
        }`}
        style={
          isFullSize
            ? {
                width: '92vw',
                height: '98vh',
              }
            : {
                width: '100%',
                maxWidth: '80rem',
                height: '90vh',
                maxHeight: '95vh',
              }
        }
      >
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              Document preview
            </p>
            <h2 className="text-lg font-semibold text-gray-900 truncate max-w-[70vw]">
              {document?.name || 'Untitled document'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#21C1B6] rounded-full p-1"
            aria-label="Close preview"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <OcrToolbar
          ocrToolbarStats={
            isOcrVisible && ocrData?.pages?.length ? (
              <OcrStats
                variant="compact"
                ocrData={ocrData}
                metadata={metadata}
                currentPage={currentPage}
              />
            ) : undefined
          }
          currentPage={currentPage}
          totalPages={totalPagesFromOcr || (overview?.page_count ?? 0)}
          onPageChange={setCurrentPageFromToolbar}
          zoom={zoom}
          onZoomChange={setZoom}
          isFullSize={isFullSize}
          onToggleFullSize={() => setIsFullSize((prev) => !prev)}
          onDownloadOriginalPdf={() => {
            downloadUrl(pdfUrlResolved, originalDownloadName());
          }}
          onDownloadOcrPlainPdf={() => {
            downloadOcrPdf('plain');
          }}
          onDownloadOcrWithBoxesPdf={() => {
            downloadOcrPdf('high');
          }}
          onDownloadOcrBoxesMediumPdf={() => {
            downloadOcrPdf('medium');
          }}
          onDownloadOcrBoxesLowPdf={() => {
            downloadOcrPdf('low');
          }}
          isOcrVisible={isOcrVisible}
          onToggleOcr={() => setIsOcrVisible(!isOcrVisible)}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          confidenceFilter={confidenceFilter}
          onConfidenceFilterChange={setConfidenceFilter}
        />

        <div className="flex-1 min-h-0 flex gap-3 px-4 py-3 bg-gray-50">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
              <div className="flex flex-col items-center gap-2 text-gray-700">
                <div className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-[#21C1B6] animate-spin" />
                <p className="text-sm font-medium">Loading OCR document…</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <p className="text-red-500 mb-3 text-sm font-medium">
                {error || 'Unable to load OCR document'}
              </p>
              <button
                className="mt-1 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white"
                style={{ backgroundColor: '#21C1B6' }}
                onClick={handleClose}
              >
                Close
              </button>
            </div>
          )}

          {!error && (
            <>
              <div
                className={`${
                  isOcrVisible ? 'basis-1/2' : 'basis-full'
                } flex-1 flex flex-col min-w-0 min-h-0`}
              >
                {!overview && loading ? (
                  // Until the view response lands there is nothing authoritative to classify, and the
                  // caller's props may carry no usable name or mimetype — which would resolve to
                  // 'unsupported' and flash "cannot be previewed" through the translucent loading
                  // overlay before settling on the real renderer.
                  <div className="flex flex-col h-full min-h-0 gap-3">
                    <h3 className="text-sm font-semibold text-gray-900 shrink-0">
                      Original Document
                    </h3>
                    <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-100" />
                  </div>
                ) : previewKind === 'docx' ? (
                  // DocxPanel deliberately does not hand over a scroller: its pages are laid out by the
                  // document's own geometry, not the fixed PDF_VIEWER_PAGE_HEIGHT slots the mirroring
                  // maps 1:1, so syncing the two would scroll the OCR panel to the wrong place. The
                  // mirror effect handles a single scroller, so the OCR side still tracks its own pages.
                  <DocxPanel
                    url={pdfUrlResolved}
                    zoom={zoom}
                    onDownload={() =>
                      downloadUrl(pdfUrlResolved, originalDownloadName())
                    }
                  />
                ) : (
                  <PdfPanel
                    pdfUrl={pdfUrlResolved}
                    pageCount={totalPagesFromOcr}
                    currentPage={currentPage}
                    onScrollerRef={onLeftScrollerRef}
                    zoom={zoom}
                    previewKind={previewKind}
                    onDownload={() =>
                      downloadUrl(pdfUrlResolved, originalDownloadName())
                    }
                  />
                )}
              </div>

              {isOcrVisible && (
                <div className="basis-1/2 flex-1 flex flex-col min-w-0 min-h-0">
                  {overview?.viewer_status === 'processing_ocr' || isPollingOcr ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-3">
                      <div>
                        <p className="text-sm text-gray-700 mb-1">
                          OCR is processing...
                        </p>
                        <p className="text-xs text-gray-500">
                          This may take a few minutes. The viewer will automatically update when complete.
                        </p>
                      </div>
                      <div className="flex flex-col items-center space-y-2">
                        <div className="h-6 w-6 rounded-full border-2 border-gray-200 border-t-[#21C1B6] animate-spin" />
                        <p className="text-xs text-gray-600">
                          Processing OCR…
                          {typeof ocrProgress === 'number'
                            ? ` ${ocrProgress.toFixed(1)}%`
                            : ''}
                        </p>
                      </div>
                    </div>
                  ) : hasOcrData === false ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-3">
                      <div>
                        <p className="text-sm text-gray-700 mb-1">
                          OCR reconstruction not available
                        </p>
                        <p className="text-xs text-gray-500 max-w-md">
                          OCR is generated once during case upload and document processing.
                          This file does not have stored OCR JSON available for the
                          reconstructed view.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <OcrPanel
                      ocrData={ocrData}
                      metadata={metadata}
                      onScrollerRef={onRightScrollerRef}
                      onVisibleRange={ensureOcrRange}
                      displayMode={displayMode}
                      zoom={zoom}
                      confidenceFilter={confidenceFilter}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (modalRoot) {
    return createPortal(content, modalRoot);
  }

  return content;
};

export default OcrDocumentModal;

