import React, { useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type {
  OcrDisplayMode,
  OcrConfidenceFilter,
} from '../hooks/useOcrDocumentViewer';

export interface OcrToolbarProps {
  /** Compact OCR stats (total pages, current page, avg confidence) — shown after Download */
  ocrToolbarStats?: React.ReactNode;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  isFullSize: boolean;
  onToggleFullSize: () => void;
  onDownloadOriginalPdf: () => void;
  onDownloadOcrPlainPdf: () => void;
  onDownloadOcrWithBoxesPdf: () => void;
  onDownloadOcrBoxesMediumPdf: () => void;
  onDownloadOcrBoxesLowPdf: () => void;
  isOcrVisible: boolean;
  onToggleOcr: () => void;
  displayMode: OcrDisplayMode;
  onDisplayModeChange: (mode: OcrDisplayMode) => void;
  confidenceFilter: OcrConfidenceFilter;
  onConfidenceFilterChange: (filter: OcrConfidenceFilter) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const OcrToolbar: React.FC<OcrToolbarProps> = ({
  ocrToolbarStats,
  currentPage,
  totalPages,
  onPageChange,
  zoom,
  onZoomChange,
  isFullSize,
  onToggleFullSize,
  onDownloadOriginalPdf,
  onDownloadOcrPlainPdf,
  onDownloadOcrWithBoxesPdf,
  onDownloadOcrBoxesMediumPdf,
  onDownloadOcrBoxesLowPdf,
  isOcrVisible,
  onToggleOcr,
  displayMode,
  onDisplayModeChange,
  confidenceFilter,
  onConfidenceFilterChange,
}) => {
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDownloadMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(event.target as Node)
      ) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDownloadMenu]);

  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (totalPages && currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handleZoomIn = () => onZoomChange(clamp(zoom + 0.1, 0.5, 3));
  const handleZoomOut = () => onZoomChange(clamp(zoom - 0.1, 0.5, 3));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 relative">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-400">
          Page
        </span>
        <div className="inline-flex items-center rounded-full bg-white border border-gray-200 shadow-sm overflow-hidden">
          <button
            className="p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handlePrev}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 text-xs font-medium text-gray-800">
            {currentPage} / {totalPages || '—'}
          </span>
          <button
            className="p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleNext}
            disabled={!totalPages || currentPage >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {totalPages != null && totalPages > 0 && (
          <select
            aria-label="Jump to page"
            value={currentPage}
            onChange={(e) => onPageChange(Number(e.target.value))}
            className="ml-1 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-800 px-2.5 py-1.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent min-w-[4rem]"
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                Page {p}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex items-center rounded-full bg-white border border-gray-200 shadow-sm overflow-hidden">
          <button
            className="p-1.5 text-gray-500 hover:bg-gray-100"
            onClick={handleZoomOut}
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2 text-xs font-medium text-gray-800 min-w-[46px] text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            className="p-1.5 text-gray-500 hover:bg-gray-100"
            onClick={handleZoomIn}
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            className={`p-1.5 text-gray-500 hover:bg-gray-100 border-l border-gray-200 ${
              isFullSize ? 'bg-gray-100' : ''
            }`}
            onClick={onToggleFullSize}
            aria-label="Toggle full-screen view"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="relative" ref={downloadMenuRef}>
          <button
            type="button"
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shadow-sm"
            onClick={() => setShowDownloadMenu((open) => !open)}
          >
            Download
          </button>
          {showDownloadMenu && (
            <div className="absolute right-0 mt-1 w-56 rounded-md border border-gray-200 bg-white shadow-lg z-20 text-xs">
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                onClick={() => {
                  setShowDownloadMenu(false);
                  onDownloadOcrPlainPdf();
                }}
              >
                OCR PDF (PLAIN TEXT)
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                onClick={() => {
                  setShowDownloadMenu(false);
                  onDownloadOcrWithBoxesPdf();
                }}
              >
                OCR PDF (<span className="text-green-600 font-semibold">HIGH</span> CONFIDENCE)
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                onClick={() => {
                  setShowDownloadMenu(false);
                  onDownloadOcrBoxesMediumPdf();
                }}
              >
                OCR PDF (<span className="text-amber-600 font-semibold">Medium</span> CONFIDENCE)
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                onClick={() => {
                  setShowDownloadMenu(false);
                  onDownloadOcrBoxesLowPdf();
                }}
              >
                OCR PDF (<span className="text-red-600 font-semibold">LOW</span> CONFIDENCE)
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-t border-gray-100"
                onClick={() => {
                  setShowDownloadMenu(false);
                  onDownloadOriginalPdf();
                }}
              >
                Original PDF
              </button>
            </div>
          )}
        </div>

        {ocrToolbarStats ? (
          <div className="flex items-center shrink-0">{ocrToolbarStats}</div>
        ) : null}

        <div className="inline-flex items-center rounded-full bg-white border border-gray-200 shadow-sm overflow-hidden">
          <button
            className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium transition-colors ${
              isOcrVisible
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
            onClick={onToggleOcr}
          >
            {isOcrVisible ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>OCR</span>
          </button>
        </div>

        <div className="inline-flex items-center rounded-full bg-white border border-gray-200 shadow-sm overflow-hidden">
          <select
            className="bg-transparent text-xs px-2 py-1.5 focus:outline-none text-gray-700"
            value={displayMode}
            onChange={(e) =>
              onDisplayModeChange(e.target.value as OcrDisplayMode)
            }
          >
            <option value="words">Words (Tokens)</option>
            {/* <option value="lines">Lines</option>
            <option value="paragraphs">Paragraphs</option> */}
          </select>
        </div>

        <div className="inline-flex items-center rounded-full bg-white border border-gray-200 shadow-sm overflow-hidden">
          <span className="pl-3 pr-1 py-1.5 text-xs text-gray-500 whitespace-nowrap">
            H C
          </span>
          <select
            value={confidenceFilter}
            onChange={(e) =>
              onConfidenceFilterChange(e.target.value as OcrConfidenceFilter)
            }
            className="bg-transparent text-xs font-medium text-gray-700 px-0 py-1.5 pr-0 focus:outline-none focus:ring-0"
            aria-label="Show boxes by confidence level"
          >
            <option value="none">None</option>
            <option value="all">All</option>
            <option value="high">High (≥ 0.95)</option>
            <option value="medium">Medium (0.85–0.95)</option>
            <option value="low">Low (&lt; 0.85)</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default OcrToolbar;

