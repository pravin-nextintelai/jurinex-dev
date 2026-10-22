export interface OcrWordBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrWordBbox;
}

export interface OcrPage {
  page: number;
  width: number;
  height: number;
  words: OcrWord[];
  avgConfidence?: number;
}

export interface OcrJson {
  documentId: string;
  pageCount: number;
  pages: OcrPage[];
}

export interface OcrMetadataPage {
  page: number;
  avgConfidence?: number;
  wordCount?: number;
}

export interface OcrMetadata {
  documentId: string;
  pageCount: number;
  avgConfidence?: number;
  pages: OcrMetadataPage[];
}

export interface OcrDocumentOverview {
  document_id?: string;
  file_id?: string;
  case_id?: string | null;
  status?: string;
  viewer_status?: 'ready' | 'processing_ocr' | 'missing_ocr' | 'failed' | string;
  ocr_available?: boolean;
  ocr_processing?: boolean;
  // The original upload's type and name, straight off the user_files row. The signed URL below points
  // at the RAW object, so the viewer must know what it is: only a PDF can go to pdf.js.
  mimetype?: string | null;
  file_name?: string | null;
  pdf_signed_url?: string | null;
  ocr_signed_url?: string | null;
  page_count?: number;
  average_confidence?: number;
  progress_percentage?: number | null;
  pages_processed?: number | null;
}
