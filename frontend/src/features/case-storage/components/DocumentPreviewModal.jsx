import React from "react";
import { OcrDocumentModal } from "@/features/ocr-viewer/components";

const normalizeDocumentForOcrViewer = (file) => {
  if (!file) return null;
  return {
    ...file,
    id:
      file.id ||
      file._id ||
      file.file_id ||
      file.fileId ||
      file.document_id ||
      file.metadata?.db_file_id ||
      file.metadata?.file_id,
    name:
      file.name ||
      file.originalname ||
      file.filename ||
      file.original_name ||
      "Untitled document",
    mimetype: file.mimetype || file.mimeType || file.type,
    viewUrl: file.viewUrl || file.view_url || null,
    previewUrl: file.previewUrl || file.preview_url || null,
    filePath: file.filePath || file.path || file.gcs_path || file.gcsPath || null,
    caseId: file.caseId || file.case_id || file.folderId || null,
  };
};

const DocumentPreviewModal = ({ document: file, onClose }) => {
  const document = normalizeDocumentForOcrViewer(file);

  if (!document?.id) {
    return null;
  }

  return <OcrDocumentModal document={document} onClose={onClose} />;
};

export default DocumentPreviewModal;
