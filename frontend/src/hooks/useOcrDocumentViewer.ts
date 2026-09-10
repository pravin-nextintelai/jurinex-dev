import { useCallback, useEffect, useRef, useState } from 'react';
import ocrApi from '../services/ocrApi';
import type { OcrDocumentOverview, OcrJson, OcrMetadata, OcrPage } from '../types/ocr';

export type OcrDisplayMode = 'words' | 'lines' | 'paragraphs';
export type OcrConfidenceFilter = 'none' | 'all' | 'high' | 'medium' | 'low';

const useOcrDocumentViewer = (documentId?: string | null) => {
  const [overview, setOverview] = useState<OcrDocumentOverview | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<OcrJson | null>(null);
  const [metadata, setMetadata] = useState<OcrMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isOcrVisible, setIsOcrVisible] = useState(false);
  const [displayMode, setDisplayMode] = useState<OcrDisplayMode>('words');
  const [confidenceFilter, setConfidenceFilter] = useState<OcrConfidenceFilter>('none');
  const [hasOcrData, setHasOcrData] = useState<boolean | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [isPollingOcr, setIsPollingOcr] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const loadedPagesRef = useRef<Set<number>>(new Set());
  const inFlightPagesRef = useRef<Set<number>>(new Set());

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const mergeOcrPages = useCallback(
    (incoming: OcrPage[], pageCount: number, markLoaded: number[] = []) => {
      incoming.forEach((page) => loadedPagesRef.current.add(page.page));
      markLoaded.forEach((page) => loadedPagesRef.current.add(page));
      setOcrData((prev) => {
        const byNumber = new Map((prev?.pages || []).map((page) => [page.page, page]));
        incoming.forEach((page) => byNumber.set(page.page, page));
        markLoaded.forEach((pageNumber) => {
          if (!byNumber.has(pageNumber)) {
            byNumber.set(pageNumber, {
              page: pageNumber,
              width: 1000,
              height: 1414,
              words: [],
            });
          }
        });
        return {
          documentId: documentId || prev?.documentId || '',
          pageCount: Math.max(prev?.pageCount || 0, pageCount || 0),
          pages: Array.from(byNumber.values()).sort((a, b) => a.page - b.page),
        };
      });
    },
    [documentId],
  );

  const ensureOcrRange = useCallback(
    async (fromPage: number, toPage: number) => {
      if (!documentId) return;
      const start = Math.max(1, fromPage);
      const end = Math.max(start, toPage);
      const missing: number[] = [];
      for (let page = start; page <= end; page += 1) {
        if (!loadedPagesRef.current.has(page) && !inFlightPagesRef.current.has(page)) {
          missing.push(page);
        }
      }
      if (!missing.length) return;
      const reqFrom = missing[0];
      const reqTo = Math.min(missing[missing.length - 1], reqFrom + 11);
      for (let page = reqFrom; page <= reqTo; page += 1) {
        inFlightPagesRef.current.add(page);
      }
      let fetched = false;
      try {
        const result = await ocrApi.fetchOcrPages(documentId, reqFrom, reqTo);
        const returned = new Set((result.pages || []).map((page) => page.page));
        const filled = [];
        for (let page = reqFrom; page <= reqTo; page += 1) {
          if (!returned.has(page)) filled.push(page);
        }
        mergeOcrPages(result.pages, result.pageCount, filled);
        setHasOcrData(Boolean(result.pageCount || result.pages.length));
        fetched = true;
      } catch (err) {
        console.warn('[OCR PREVIEW] Failed to load OCR page window', reqFrom, reqTo, err);
      } finally {
        for (let page = reqFrom; page <= reqTo; page += 1) {
          inFlightPagesRef.current.delete(page);
        }
      }
      if (!fetched) return;
      const stillMissing: number[] = [];
      for (let page = start; page <= end; page += 1) {
        if (!loadedPagesRef.current.has(page) && !inFlightPagesRef.current.has(page)) {
          stillMissing.push(page);
        }
      }
      if (stillMissing.length) {
        await ensureOcrRange(stillMissing[0], stillMissing[stillMissing.length - 1]);
      }
    },
    [documentId, mergeOcrPages],
  );

  useEffect(() => {
    if (!documentId) {
      setOverview(null);
      setPdfUrl(null);
      setOcrData(null);
      setMetadata(null);
      setHasOcrData(null);
      loadedPagesRef.current = new Set();
      inFlightPagesRef.current = new Set();
      return;
    }

    let cancelled = false;
    loadedPagesRef.current = new Set();
    inFlightPagesRef.current = new Set();

    const load = async () => {
      setLoading(true);
      setError(null);
      setHasOcrData(null);
      try {
        const overviewData = await ocrApi.getOcrDocument(documentId);
        if (cancelled) return;
        setOverview(overviewData);
        setPdfUrl(overviewData.pdf_signed_url || null);
        setOcrProgress(
          typeof overviewData.progress_percentage === 'number'
            ? overviewData.progress_percentage
            : null,
        );

        const seed = await ocrApi.fetchOcrJson(documentId);
        if (cancelled) return;
        const pageCount = Number(seed?.pageCount || overviewData.page_count || 0);
        setOcrData(
          seed || {
            documentId,
            pageCount,
            pages: [],
          },
        );
        seed?.pages?.forEach((page) => loadedPagesRef.current.add(page.page));
        setMetadata({
          documentId,
          pageCount,
          avgConfidence: overviewData.average_confidence,
          pages: [],
        });
        setHasOcrData(Boolean(pageCount || seed?.pages?.length));
        setOcrProgress(overviewData.ocr_available ? 100 : overviewData.progress_percentage ?? null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Unable to load OCR document');
        setOcrData(null);
        setMetadata(null);
        setHasOcrData(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const handleCompleted = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (!detail?.documentId || detail.documentId === documentId) reload();
    };
    window.addEventListener('ocr-completed', handleCompleted as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('ocr-completed', handleCompleted as EventListener);
    };
  }, [documentId, reloadVersion, reload]);

  useEffect(() => {
    if (!documentId || !isOcrVisible || !ocrData?.pageCount) return;
    const around = Math.max(1, currentPage);
    void ensureOcrRange(around, Math.min(ocrData.pageCount, around + 2));
  }, [documentId, isOcrVisible, currentPage, ocrData?.pageCount, ensureOcrRange]);

  useEffect(() => {
    if (!documentId || overview?.viewer_status !== 'processing_ocr') {
      setIsPollingOcr(false);
      return;
    }

    let cancelled = false;
    setIsPollingOcr(true);
    const interval = window.setInterval(async () => {
      try {
        const status = await ocrApi.getOcrStatus(documentId);
        if (cancelled) return;
        setOcrProgress(
          typeof status.progress_percentage === 'number' ? status.progress_percentage : null,
        );
        if (status.ocr_available || status.viewer_status === 'ready') {
          window.clearInterval(interval);
          setIsPollingOcr(false);
          reload();
        }
      } catch {
        if (!cancelled) setIsPollingOcr(false);
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setIsPollingOcr(false);
    };
  }, [documentId, overview?.viewer_status, reload]);

  return {
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
  };
};

export default useOcrDocumentViewer;
