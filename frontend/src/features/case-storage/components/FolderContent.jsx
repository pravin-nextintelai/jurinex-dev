import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import documentApi from "@/shared/api/documentApi";
import { FileManagerContext } from "@/shared/context/FileManagerContext";
import DocumentCard from "./DocumentCard";
import { toast } from 'react-toastify';
import { DOCS_BASE_URL, getUserIdForDrafting } from "@/config/apiConfig";
import GoogleDrivePicker from "./GoogleDrivePicker";
import { extractUploadPolicyErrorMessage } from "@/shared/utils/llmQuotaMessages";

const FolderContent = ({ onDocumentClick }) => {
 const {
 selectedFolder,
 documents,
 setDocuments,
 setChatSessions,
 setSelectedChatSessionId,
 error: contextError,
 } = useContext(FileManagerContext);

 const [loading, setLoading] = useState(false);
 const [error, setError] = useState(false);
 const [uploading, setUploading] = useState(false);
 const [processingDocuments, setProcessingDocuments] = useState(new Map());

 const pollingIntervalsRef = useRef(new Map());
 const lastProgressRef = useRef(new Map());
 const requestIdRef = useRef(0);

 const getAuthToken = () =>
 localStorage.getItem("token") || localStorage.getItem("authToken");
 const getAuthHeaders = () => {
 const token = getAuthToken();
 return token ? { Authorization: `Bearer ${token}` } : {};
 };

 const fetchFolderContent = useCallback(
 async (forceRefresh = false) => {
 const requestId = ++requestIdRef.current;
 if (!selectedFolder) {
 setDocuments([]);
 return;
 }

 setLoading(true);
 setError(null);

 try {
 const data = await documentApi.getDocumentsInFolder(selectedFolder);
 let filesList = [];
 if (Array.isArray(data)) filesList = data;
 else if (data.files) filesList = data.files;
 else if (data.documents) filesList = data.documents;
 else if (data.data) filesList = data.data;

 const normalizedFiles = filesList.map((file) => ({
 id: file.id || file._id,
 name:
 file.name ||
 file.originalname ||
 file.filename ||
 file.original_name ||
 "Unnamed Document",
 originalname:
 file.originalname ||
 file.name ||
 file.filename ||
 file.original_name,
 size: file.size || file.fileSize || 0,
 created_at:
 file.created_at ||
 file.createdAt ||
 file.uploadedAt ||
 new Date().toISOString(),
 status: file.status || file.processing_status || "unknown",
 processing_progress: parseFloat(
 file.processing_progress || file.progress || 0
 ),
 current_operation: file.current_operation || file.message || "",
 mimetype: file.mimetype || file.mimeType || file.type,
 path: file.path || file.filePath,
 viewUrl: file.viewUrl || file.view_url,
 previewUrl: file.previewUrl || file.preview_url,
 }));

 if (requestIdRef.current === requestId) {
 setDocuments(normalizedFiles);
 }
 } catch (err) {
 console.error("❌ Error fetching folder content:", err);
 if (requestIdRef.current === requestId) {
 setError("Failed to fetch folder content.");
 setDocuments([]);
 }
 } finally {
 if (requestIdRef.current === requestId) {
 setLoading(false);
 }
 }
 },
 [selectedFolder, setDocuments, documents.length]
 );

 useEffect(() => {
 setDocuments([]);
 fetchFolderContent(true);
 if (setChatSessions) setChatSessions([]);
 if (setSelectedChatSessionId) setSelectedChatSessionId(null);
 }, [selectedFolder]);

 useEffect(() => {
 return () => {
 pollingIntervalsRef.current.forEach((interval) => clearInterval(interval));
 pollingIntervalsRef.current.clear();
 lastProgressRef.current.clear();
 };
 }, []);

 useEffect(() => {
 const processingStatuses = [
 "processing",
 "queued",
 "pending",
 "batch_processing",
 "batch_queued",
 ];
 documents.forEach((doc) => {
 if (
 processingStatuses.includes(doc.status) &&
 !pollingIntervalsRef.current.has(doc.id)
 ) {
 startIndividualPolling(doc.id, doc.name);
 }
 });
 }, [documents]);

 const checkProcessingStatus = async (documentId) => {
 try {
 const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
 const uid = getUserIdForDrafting();
 if (uid) headers["X-User-Id"] = uid;
 const response = await fetch(`${DOCS_BASE_URL}/status/${encodeURIComponent(documentId)}`, {
 method: "GET",
 headers,
 cache: "no-store",
 });

 if (!response.ok) throw new Error(`HTTP ${response.status}`);
 const data = await response.json();
 return data;
 } catch (err) {
 console.error(`❌ Error fetching status for ${documentId}:`, err.message);
 return null;
 }
 };

 const formatOperationLabel = (raw) => {
 if (!raw || typeof raw !== "string") return "";
 const key = raw.trim().toLowerCase();
 const map = {
 transcribing_audio: "Transcribing audio (Speech-to-Text)…",
 vector_indexing: "Saving chunks and building search index…",
 ocr_and_validation: "Extracting text from document…",
 completed: "Completed",
 failed: "Processing failed",
 };
 return map[key] || raw;
 };

 const extractStatusData = (data) => {
 if (!data) return { status: "unknown", progress: 0, currentOperation: "" };

 const status =
 data.status?.toLowerCase() ||
 data.processing_status?.toLowerCase() ||
 "unknown";

 let progress = 0;
 const val =
 data.progress ??
 data.processing_progress ??
 data.progress_percentage ??
 0;
 if (typeof val === "string") {
 progress = parseFloat(val.replace("%", ""));
 } else progress = parseFloat(val);
 if (isNaN(progress)) progress = 0;
 progress = Math.min(100, Math.max(0, progress));

 const fromApi = data.current_operation || data.message || data.stage || "";
 const currentOperation =
 formatOperationLabel(fromApi) ||
 inferCurrentOperation(progress, status);

 return { status, progress, currentOperation };
 };

 const inferCurrentOperation = (progress, status) => {
 if (status === "processed" || status === "completed") return "Completed";
 if (status === "error" || status === "failed") return "Failed";
 
 const p = parseFloat(progress) || 0;
 
 if (status === "batch_queued") {
 if (p < 5) return "Initializing document processing";
 if (p < 15) return "Uploading document to cloud storage";
 return "Preparing batch operation";
 }
 
 if (status === "batch_processing") {
 if (p < 20) return "Starting Document AI batch processing";
 if (p < 25) return "Document uploaded to processing queue";
 if (p < 30) return "OCR analysis in progress";
 if (p < 35) return "Extracting text from document";
 if (p < 40) return "Processing document layout";
 return "Completing OCR extraction";
 }
 
 if (status === "processing") {
 if (p < 45) return "Fetching OCR results";
 if (p < 48) return "Loading chunking configuration";
 if (p < 52) return "Initializing chunking";
 if (p < 58) return "Chunking document into segments";
 if (p < 64) return "Preparing for embedding";
 if (p < 70) return "Connecting to embedding service";
 if (p < 76) return "Generating AI embeddings";
 if (p < 79) return "Preparing database storage";
 if (p < 82) return "Saving chunks to database";
 if (p < 85) return "Preparing vector embeddings";
 if (p < 88) return "Storing vector embeddings";
 if (p < 92) return "Generating AI summary";
 if (p < 96) return "Saving document summary";
 if (p < 98) return "Updating document metadata";
 if (p < 100) return "Finalizing document processing";
 return "Processing complete";
 }
 
 return "Queued";
 };

 const updateDocumentProgress = (
 documentId,
 documentName,
 status,
 progress,
 operation
 ) => {
 const last = lastProgressRef.current.get(documentId) || 0;
 const lastStatus = lastProgressRef.current.get(`${documentId}_status`);

 const lastOp = lastProgressRef.current.get(`${documentId}_op`) || "";
 if (progress < last && status === lastStatus && operation === lastOp) return;
 if (progress === last && status === lastStatus && operation === lastOp) return;

 lastProgressRef.current.set(documentId, progress);
 lastProgressRef.current.set(`${documentId}_status`, status);
 lastProgressRef.current.set(`${documentId}_op`, operation || "");

 setProcessingDocuments((prev) => {
 const newMap = new Map(prev);
 newMap.set(documentId, {
 name: documentName,
 status,
 progress,
 current_operation: operation,
 lastUpdated: Date.now(),
 });
 return newMap;
 });

 setDocuments((prevDocs) =>
 prevDocs.map((d) =>
 d.id === documentId
 ? { ...d, status, processing_progress: progress, current_operation: operation }
 : d
 )
 );
 };

 const pollDocument = async (documentId, documentName) => {
 const data = await checkProcessingStatus(documentId);
 if (!data) return;
 const { status, progress, currentOperation } = extractStatusData(data);
 updateDocumentProgress(documentId, documentName, status, progress, currentOperation);

 const done = ["completed", "processed", "success"].includes(status);
 const failed = ["failed", "error"].includes(status);
 if (done || progress >= 100) stopPolling(documentId, documentName, true);
 if (failed) stopPolling(documentId, documentName, false);
 };

 const stopPolling = (documentId, documentName, success = true) => {
 const interval = pollingIntervalsRef.current.get(documentId);
 if (interval) {
 clearInterval(interval);
 pollingIntervalsRef.current.delete(documentId);
 console.log(`${success ? "✅" : "❌"} Stopped polling ${documentName}`);
 }
  if (success) {
    // Re-fetch folder file metadata once processing completes so fresh
    // preview/view URLs are available immediately without manual refresh.
    fetchFolderContent(true);
  }
 };

 const startIndividualPolling = (documentId, documentName) => {
 if (pollingIntervalsRef.current.has(documentId)) return;

 const doc = documents.find((d) => d.id === documentId);
 if (doc) {
 lastProgressRef.current.set(documentId, doc.processing_progress || 0);
 lastProgressRef.current.set(`${documentId}_status`, doc.status || "queued");
 lastProgressRef.current.set(
 `${documentId}_op`,
 doc.current_operation || ""
 );
 }

 pollDocument(documentId, documentName);
 const interval = setInterval(() => pollDocument(documentId, documentName), 2000);
 pollingIntervalsRef.current.set(documentId, interval);
 };

 const startStatusPolling = (arr) => {
 arr.forEach(({ id, name }) => startIndividualPolling(id, name));
 };

  const handleUploadDocuments = async (files) => {
  if (!files?.length) return alert("Please select at least one file.");
  if (!selectedFolder) return alert("Please select a folder first.");

 const MAX_FILE_SIZE = 100 * 1024 * 1024;
 const oversizedFiles = Array.from(files).filter(file => file.size > MAX_FILE_SIZE);
 
 if (oversizedFiles.length > 0) {
   toast.error('File size limit exceeded. You can upload only up to 100 MB.', {
     autoClose: 5000
   });
   return;
 }

  setUploading(true);
  try {
  const res = await documentApi.uploadDocuments(selectedFolder, files);

  // Surface server-side rejection messages (429 rate limit, 413 file policy, etc.)
  if (res.success === false && res.message) {
    toast.error(res.message, { autoClose: 7000 });
    return;
  }

  const uploaded = res.documents || res.files || [];
  const getTrackedFileId = (doc) =>
    doc?.id ||
    doc?._id ||
    doc?.file_id ||
    doc?.fileId ||
    doc?.document_id ||
    doc?.metadata?.db_file_id ||
    doc?.metadata?.file_id ||
    doc?.metadata?.id ||
    null;
  const newDocs = uploaded
    .map((doc) => ({
  id: getTrackedFileId(doc),
  name:
    doc.document_name ||
    doc.originalname ||
   doc.name ||
   doc.filename ||
   "Unnamed",
 originalname: doc.originalname || doc.name || doc.document_name,
 size: doc.size || doc.metadata?.size || 0,
 created_at: doc.created_at || doc.updated_at || new Date().toISOString(),
 status: doc.status || "queued",
 processing_progress: parseFloat(doc.processing_progress || 0),
 current_operation: doc.current_operation || "Starting...",
 mimetype: doc.mimetype || doc.mimeType,
 }))
   .filter((d) => d.id);
 if (uploaded.length > 0 && newDocs.length === 0) {
   toast.error("Upload returned no file id — cannot track status. Try refreshing the folder.");
 }
 setDocuments((prev) => [...prev, ...newDocs]);
 const info = newDocs.map((d) => ({ id: d.id, name: d.name }));
 setTimeout(() => startStatusPolling(info), 800);
 } catch (e) {
 console.error("❌ Upload failed:", e);
 const policyMsg = extractUploadPolicyErrorMessage(e);
 const data = e?.response?.data;
 const serverMsg = policyMsg ||
   (data?.detail && typeof data.detail === 'object' ? data.detail.message : null) ||
   (typeof data?.detail === 'string' ? data.detail : null) ||
   data?.message ||
   null;
 toast.error(serverMsg || e.message || 'Upload failed. Please try again.', { autoClose: 7000 });
 } finally {
  setUploading(false);
    }
  };

  // Handle Google Drive upload completion
  const handleGoogleDriveUpload = (uploadedDocs) => {
    // Google Drive files have been downloaded to server
    const newDocs = uploadedDocs
      .filter(doc => doc.status !== 'failed')
      .map((doc) => ({
        id: doc.id || doc._id,
        name: doc.originalname || doc.name || doc.filename || "Unnamed",
        originalname: doc.originalname || doc.name,
        size: doc.file_size || doc.size || 0,
        status: doc.status || "uploaded",
        created_at: new Date().toISOString(),
        processing_progress: 0,
        current_operation: "",
        source: "google_drive",
      }));

    if (newDocs.length > 0) {
      setDocuments((prev) => [...prev, ...newDocs]);
      const info = newDocs.map((d) => ({ id: d.id, name: d.name }));
      setTimeout(() => startStatusPolling(info), 800);
      toast.success(`${newDocs.length} file(s) uploaded from Google Drive`);
    }
  };

  const handleDocumentClick = (doc) => {
 const processing = ["processing", "queued", "pending", "batch_processing", "batch_queued"].includes(
 doc.status?.toLowerCase()
 );
 if (processing) {
 console.log("Document is still processing, please wait...");
 return;
 }

 if (typeof onDocumentClick === "function") {
 onDocumentClick(doc);
 }
 };

 const handleDeleteDocument = async (id) => {
 if (!id) return;
 try {
 stopPolling(id, "Document");
 await documentApi.deleteFile(id);
 setDocuments((prev) => prev.filter((d) => d.id !== id));
 } catch (e) {
 setError(`Failed to delete: ${e.message}`);
 }
 };


 if (!selectedFolder)
 return (
 <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
 Select a folder to view its contents.
 </div>
 );

 return (
 <div className="flex-1 flex flex-col min-h-0 text-gray-800 h-full overflow-hidden">
 <style
 dangerouslySetInnerHTML={{
 __html: `
 .custom-scrollbar::-webkit-scrollbar { width: 12px; }
 .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 6px; }
 .custom-scrollbar::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 6px; border: 2px solid #f1f5f9; }
 .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #64748b; }
 .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9; }
 `,
 }}
 />
<div className="flex justify-between items-start mb-3 flex-shrink-0 gap-3">
<h2 className="text-lg font-semibold min-w-0 flex-1 break-words pr-2">
Case: {selectedFolder}
</h2>
<div className="flex-shrink-0 flex gap-2 items-center">
{/* Local file upload button */}
<label
htmlFor="document-upload"
className={`cursor-pointer ${
uploading ? "bg-gray-400 cursor-not-allowed" : "bg-[#21C1B6] hover:bg-[#1AA49B]"
} text-white px-3 py-1.5 rounded-md text-sm transition-colors duration-200 flex items-center justify-center gap-1`}
title="Upload local files"
>
<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
</svg>
<span className="hidden sm:inline">{uploading ? "..." : "Local"}</span>
<input
id="document-upload"
type="file"
multiple
disabled={uploading}
className="hidden"
onChange={(e) => {
handleUploadDocuments(Array.from(e.target.files));
e.target.value = "";
}}
/>
</label>
{/* Google Drive upload button */}
<GoogleDrivePicker
folderName={selectedFolder}
onUploadComplete={handleGoogleDriveUpload}
buttonText=""
buttonClassName="p-2 hover:bg-gray-100 rounded-md transition-colors duration-200 flex items-center justify-center"
iconClassName="h-6 w-6"
multiselect={true}
disabled={uploading}
showIconOnly={true}
/>
</div>
</div>

 {(error || contextError) && (
 <div className="text-red-500 mb-3 p-2 bg-red-50 rounded border border-red-200 text-sm flex-shrink-0">
 <strong>Error:</strong> {error || contextError}
 </div>
 )}
 {uploading && (
 <div className="text-blue-500 mb-3 p-2 bg-blue-50 rounded border border-blue-200 text-sm flex-shrink-0">
 <strong>⬆️ Uploading documents...</strong>
 </div>
 )}
 {processingDocuments.size > 0 && (
 <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200 flex-shrink-0">
 <div className="flex items-center mb-2">
 <svg
 className="animate-spin h-4 w-4 mr-2 text-blue-600"
 xmlns="http://www.w3.org/2000/svg"
 fill="none"
 viewBox="0 0 24 24"
 >
 <circle
 className="opacity-25"
 cx="12"
 cy="12"
 r="10"
 stroke="currentColor"
 strokeWidth="4"
 ></circle>
 <path
 className="opacity-75"
 fill="currentColor"
 d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
 ></path>
 </svg>
 <strong className="text-blue-700 text-sm">
 🔄 Processing {processingDocuments.size} document
 {processingDocuments.size > 1 ? "s" : ""} - Real-time updates every
 2 seconds
 </strong>
 </div>
 </div>
 )}

 <div className="flex-1 overflow-y-auto space-y-2 min-h-0 custom-scrollbar overscroll-contain">
 {loading ? (
 <div className="flex items-center justify-center p-8">
 <div className="text-gray-500 text-sm">Loading files...</div>
 </div>
 ) : documents.length === 0 ? (
 <p className="text-gray-400 text-center p-8 text-sm">
 No files in this folder yet. Upload documents or audio to get started.
 </p>
 ) : (
 documents.map((doc) => (
 <DocumentCard
 key={doc.id}
 document={doc}
 individualStatus={processingDocuments.get(doc.id)}
 onDocumentClick={() => handleDocumentClick(doc)}
 onDelete={handleDeleteDocument}
 />
 ))
 )}
 </div>

 </div>
 );
};

export default FolderContent;
