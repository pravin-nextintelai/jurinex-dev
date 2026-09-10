import { DOCS_BASE_URL } from '../config/apiConfig';
import documentApi from './documentApi';
import type { OcrDocumentOverview, OcrJson, OcrMetadata, OcrPage, OcrWord } from '../types/ocr';

const viewCache = new Map<string, Promise<any>>();

const getViewData = async (fileId: string, force = false) => {
  if (!force && viewCache.has(fileId)) {
    return viewCache.get(fileId)!;
  }
  const request = documentApi.getDocumentViewInfo(fileId, 1);
  viewCache.set(fileId, request);
  try {
    return await request;
  } catch (error) {
    viewCache.delete(fileId);
    throw error;
  }
};

const unwrapStructured = (value: any): any => {
  if (!value) return null;
  if (value.structuredJson) return unwrapStructured(value.structuredJson);
  if (value.structured_json) return unwrapStructured(value.structured_json);
  if (value.rawResponse) return unwrapStructured(value.rawResponse);
  if (value.raw_response) return unwrapStructured(value.raw_response);
  return value;
};

const numberOr = (value: any, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getPageSize = (page: any) => {
  const dimension = page?.dimension || page?.dimensions || {};
  const width = numberOr(dimension.width, 1000);
  const height = numberOr(dimension.height, 1414);
  return { width, height };
};

const normalizeConfidence = (value: any, fallback = 0.95) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
};

const normalizeBox = (rawBox: any, width: number, height: number) => {
  const box = rawBox || {};
  let left = Number(box.left ?? box.x ?? 0);
  let top = Number(box.top ?? box.y ?? 0);
  let w = Number(box.width ?? box.w ?? 0);
  let h = Number(box.height ?? box.h ?? 0);

  const looksNormalized = left <= 1 && top <= 1 && w <= 1 && h <= 1;
  if (looksNormalized) {
    left *= width;
    top *= height;
    w *= width;
    h *= height;
  }

  return {
    x: Math.round(clamp(left, 0, width)),
    y: Math.round(clamp(top, 0, height)),
    w: Math.max(2, Math.round(clamp(w, 2, width))),
    h: Math.max(10, Math.round(clamp(h, 10, height))),
  };
};

const wordsFromTextLine = (
  text: string,
  lineBox: { x: number; y: number; w: number; h: number },
  confidence: number,
): OcrWord[] => {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const totalChars = tokens.reduce((sum, token) => sum + token.length, 0) + Math.max(0, tokens.length - 1);
  let cursor = 0;
  return tokens.map((token, index) => {
    const share = totalChars > 0 ? (token.length + (index < tokens.length - 1 ? 1 : 0)) / totalChars : 1 / tokens.length;
    const tokenWidth = Math.max(6, lineBox.w * share);
    const word: OcrWord = {
      text: token,
      confidence,
      bbox: {
        x: Math.round(lineBox.x + cursor),
        y: lineBox.y,
        w: Math.round(tokenWidth),
        h: lineBox.h,
      },
    };
    cursor += tokenWidth;
    return word;
  });
};

const wordsFromLayoutItem = (item: any, width: number, height: number, fallbackY: number): OcrWord[] => {
  const text = String(item?.text || item?.content || '').trim();
  if (!text) return [];
  const confidence = normalizeConfidence(item?.confidence);
  const rawBox = item?.boundingBox || item?.bounding_box || item?.bbox || item?.layout?.boundingBox;
  const lineBox = rawBox
    ? normalizeBox(rawBox, width, height)
    : { x: Math.round(width * 0.08), y: fallbackY, w: Math.round(width * 0.84), h: 18 };
  return wordsFromTextLine(text, lineBox, confidence);
};

const fallbackWordsFromPageText = (text: string, width: number, height: number): OcrWord[] => {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const usableLines = lines.length ? lines : String(text || '').trim().match(/.{1,90}(?:\s|$)/g)?.map((line) => line.trim()).filter(Boolean) || [];
  const top = height * 0.08;
  const lineHeight = Math.max(18, height * 0.018);
  return usableLines.flatMap((line, index) =>
    wordsFromTextLine(
      line,
      {
        x: Math.round(width * 0.08),
        y: Math.round(top + index * lineHeight * 1.35),
        w: Math.round(width * 0.84),
        h: Math.round(lineHeight),
      },
      0.9,
    ),
  );
};

const convertPage = (page: any, index: number): OcrPage => {
  const { width, height } = getPageSize(page);
  const existingWords = Array.isArray(page?.words) ? page.words : [];
  let words: OcrWord[] = existingWords
    .map((word: any) => {
      const text = String(word?.text || '').trim();
      const rawBox = word?.bbox || word?.boundingBox || word?.bounding_box;
      if (!text || !rawBox) return null;
      return {
        text,
        confidence: normalizeConfidence(word?.confidence),
        bbox: normalizeBox(rawBox, width, height),
      } as OcrWord;
    })
    .filter(Boolean) as OcrWord[];

  if (!words.length) {
    const groups = [page?.lines, page?.paragraphs, page?.blocks].filter(Array.isArray);
    const preferredGroup = groups.find((group) => group.some((item: any) => item?.boundingBox || item?.bounding_box || item?.bbox)) || groups.find((group) => group.length) || [];
    words = preferredGroup.flatMap((item: any, itemIndex: number) =>
      wordsFromLayoutItem(item, width, height, Math.round(height * 0.08 + itemIndex * 24)),
    );
  }

  if (!words.length) {
    words = fallbackWordsFromPageText(page?.text || '', width, height);
  }

  const avgConfidence = words.length
    ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
    : undefined;

  return {
    page: Number(page?.page ?? page?.pageNumber ?? index + 1),
    width,
    height,
    words,
    avgConfidence,
  };
};

export const convertBackendOcrToOcrJson = (fileId: string, ocrPayload: any): OcrJson | null => {
  const structured = unwrapStructured(ocrPayload);
  const pages = Array.isArray(structured?.pages) ? structured.pages : [];
  const extractedText = String(ocrPayload?.extractedText || structured?.text || '').trim();
  const declaredCount = Number(ocrPayload?.pageCount || structured?.pageCount || 0);

  if (!pages.length && !extractedText && declaredCount <= 0) return null;

  // Virtualized responses send pageCount=N but only the visible window in `pages`.
  // Never collapse that into a single page from the full extractedText blob.
  const convertedPages = pages.length
    ? pages.map(convertPage)
    : extractedText && declaredCount <= 1
      ? [
          {
            page: 1,
            width: 1000,
            height: 1414,
            words: fallbackWordsFromPageText(extractedText, 1000, 1414),
            avgConfidence: normalizeConfidence(ocrPayload?.confidence, 0.9),
          },
        ]
      : [];

  return {
    documentId: fileId,
    pageCount: declaredCount || convertedPages.length || 0,
    pages: convertedPages,
  };
};

const metadataFromOcr = (fileId: string, ocrData: OcrJson | null, ocrPayload: any): OcrMetadata | null => {
  if (!ocrData) return null;
  const pages = ocrData.pages.map((page) => ({
    page: page.page,
    avgConfidence: page.avgConfidence,
    wordCount: page.words.length,
  }));
  const confidenceValues = pages.map((page) => page.avgConfidence).filter((value): value is number => typeof value === 'number');
  const avgConfidence = typeof ocrPayload?.confidence === 'number'
    ? normalizeConfidence(ocrPayload.confidence)
    : confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : undefined;
  return {
    documentId: fileId,
    pageCount: ocrData.pageCount || pages.length,
    avgConfidence,
    pages,
  };
};

const statusLooksProcessing = (status: any) => {
  const normalized = String(status || '').toLowerCase();
  return normalized.includes('processing') || normalized.includes('queued') || normalized.includes('pending') || normalized.includes('embedding');
};

const ocrApi = {
  getOcrDocument: async (fileId: string): Promise<OcrDocumentOverview & { _ocrPayload?: any }> => {
    try {
      const viewData = await getViewData(fileId, true);
      const ocrPayload = viewData?.ocr || null;
      const ocrData = convertBackendOcrToOcrJson(fileId, ocrPayload);
      const doc = viewData?.document || {};
      const pdfUrl = viewData?.viewUrl || viewData?.signedUrl || viewData?.viewUrlWithPage || null;
      const ocrAvailable = Boolean(ocrData?.pageCount || ocrData?.pages?.length);
      return {
        document_id: fileId,
        file_id: fileId,
        status: doc.status || ocrPayload?.status || '',
        viewer_status: ocrAvailable ? 'ready' : statusLooksProcessing(doc.status) ? 'processing_ocr' : 'missing_ocr',
        ocr_available: ocrAvailable,
        ocr_processing: statusLooksProcessing(doc.status),
        // `document.mimetype`/`name` come from the user_files row and are the authoritative answer to
        // "what is behind pdf_signed_url". Dropping them used to leave the viewer assuming PDF.
        mimetype: doc.mimetype || null,
        file_name: doc.name || null,
        pdf_signed_url: pdfUrl,
        ocr_signed_url: ocrAvailable ? 'inline-structured-json' : null,
        page_count: ocrData?.pageCount || ocrPayload?.pageCount || viewData?.pageCount || 0,
        average_confidence: typeof ocrPayload?.confidence === 'number' ? normalizeConfidence(ocrPayload.confidence) : undefined,
        progress_percentage: statusLooksProcessing(doc.status) ? 50 : ocrAvailable ? 100 : 0,
        pages_processed: ocrData?.pageCount || 0,
        _ocrPayload: ocrPayload,
      };
    } catch (error) {
      const status = await documentApi.getFileProcessingStatus(fileId);
      const processing = statusLooksProcessing(status?.status || status?.processing_status);
      return {
        document_id: fileId,
        file_id: fileId,
        status: status?.status || status?.processing_status || '',
        viewer_status: processing ? 'processing_ocr' : 'missing_ocr',
        ocr_available: Boolean(status?.ocr_available),
        ocr_processing: processing,
        pdf_signed_url: null,
        ocr_signed_url: null,
        page_count: Number(status?.ocr_page_count || status?.page_count || 0),
        average_confidence: typeof status?.ocr_confidence === 'number' ? normalizeConfidence(status.ocr_confidence) : undefined,
        progress_percentage: Number(status?.processing_progress || status?.progress || 0),
        pages_processed: null,
      };
    }
  },

  fetchOcrJson: async (fileId: string): Promise<OcrJson | null> => {
    const viewData = await getViewData(fileId);
    return convertBackendOcrToOcrJson(fileId, viewData?.ocr || null);
  },

  fetchOcrPages: async (
    fileId: string,
    fromPage: number,
    toPage: number,
  ): Promise<{ pageCount: number; pages: OcrPage[] }> => {
    const data = await documentApi.getOcrPages(fileId, fromPage, toPage);
    const converted = convertBackendOcrToOcrJson(fileId, data?.ocr || null);
    return {
      pageCount: Number(data?.pageCount || converted?.pageCount || 0),
      pages: converted?.pages || [],
    };
  },

  fetchMetadataJson: async (fileId: string): Promise<OcrMetadata | null> => {
    const viewData = await getViewData(fileId);
    const ocrData = convertBackendOcrToOcrJson(fileId, viewData?.ocr || null);
    return metadataFromOcr(fileId, ocrData, viewData?.ocr || null);
  },

  getOcrStatus: async (fileId: string) => {
    const status = await documentApi.getFileProcessingStatus(fileId);
    return {
      ...status,
      viewer_status: status?.ocr_available ? 'ready' : statusLooksProcessing(status?.status) ? 'processing_ocr' : 'missing_ocr',
      ocr_available: Boolean(status?.ocr_available),
      ocr_processing: statusLooksProcessing(status?.status),
      progress_percentage: Number(status?.processing_progress || status?.progress || 0),
    };
  },


  getOriginalPdfDownloadUrl: (fileId: string) => `${DOCS_BASE_URL}/file/${fileId}/view`,
  getOcrPlainPdfDownloadUrl: (fileId: string) => `${DOCS_BASE_URL}/file/${fileId}/view`,
  getOcrBoxesPdfDownloadUrl: (fileId: string) => `${DOCS_BASE_URL}/file/${fileId}/view`,
};

export default ocrApi;
