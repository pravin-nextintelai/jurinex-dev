import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Search, Upload, FolderPlus, FolderOpen, Calendar, LayoutGrid, List, Archive,
  FileText, Trash2, MoreVertical, ChevronRight, Loader2, Eye, Download, Pencil,
  X, ZoomIn, ZoomOut, FilePlus, ChevronDown, FileEdit, Sparkles,
} from 'lucide-react';
import CaseStorageChat from '../components/CaseStorageChat';
import { FileManagerContext } from '../context/FileManagerContext';
import documentApi from '../services/documentApi';
import CreateFolderModal from '../components/FolderBrowser/CreateFolderModal';
import FolderPickerModal from '../components/FolderBrowser/FolderPickerModal';

const TEAL = '#21C1B6';
// Reserved parent path that keeps Case Storage folders out of the cases/Projects listing.
const STORAGE_PARENT_PATH = 'case-storage';
const PROCESSING_STATUSES = ['processing', 'queued', 'pending', 'batch_processing', 'batch_queued'];

const formatSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
};

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** ⋮ dropdown shared by folder and file cards. items: [{label, icon, danger, onClick}] */
const CardMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute top-full right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden min-w-[140px]">
            {items.map(({ label, icon: Icon, danger, onClick }) => (
              <button
                key={label}
                className={`w-full text-left px-4 py-2.5 text-xs font-medium flex items-center gap-2 transition-colors ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-50'}`}
                onClick={(e) => { e.stopPropagation(); setOpen(false); onClick(); }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const SkeletonCard = () => (
  <div className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
    <div className="w-10 h-10 rounded-xl bg-gray-100 mb-4" />
    <div className="h-3.5 bg-gray-100 rounded-full w-4/5 mb-2" />
    <div className="h-3 bg-gray-100 rounded-full w-2/5" />
  </div>
);

const FolderCard = ({ folder, onClick, menuItems }) => (
  <div
    className="group bg-white rounded-2xl border border-gray-100 p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden"
    style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
    onClick={onClick}
  >
    <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      style={{ background: `linear-gradient(90deg, ${TEAL}, #1AA49B)` }} />
    <div className="flex items-start justify-between mb-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
        style={{ background: '#f0fdfb' }}>
        <FolderOpen className="w-5 h-5" style={{ color: TEAL }} />
      </div>
      {menuItems && <CardMenu items={menuItems} />}
    </div>
    <h3 className="text-sm font-semibold text-gray-800 mb-3 leading-snug line-clamp-2 group-hover:text-[#21C1B6] transition-colors duration-150">
      {folder.case_title || folder.name}
    </h3>
    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
      <Calendar className="w-3 h-3 flex-shrink-0" />
      <span>Updated {formatDate(folder.created_at)}</span>
    </div>
  </div>
);

const FolderRow = ({ folder, onClick, menuItems }) => (
  <div
    className="group flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all duration-150"
    onClick={onClick}
  >
    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#f0fdfb' }}>
      <FolderOpen className="w-4 h-4" style={{ color: TEAL }} />
    </div>
    <span className="text-sm font-semibold text-gray-800 flex-1 truncate group-hover:text-[#21C1B6] transition-colors">
      {folder.case_title || folder.name}
    </span>
    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 flex-shrink-0">
      <Calendar className="w-3 h-3" />
      <span>{formatDate(folder.created_at)}</span>
    </div>
    {menuItems && <CardMenu items={menuItems} />}
  </div>
);

const PROVIDER_LABELS = { google: 'Google Docs', zoho: 'Zoho Writer' };

const FileCard = ({ file, onView, onDownload, onDelete, onEdit, onAsk, view }) => {
  const processing = PROCESSING_STATUSES.includes((file.status || '').toLowerCase());
  const provider = file.status === 'external' ? file.metadata?.provider : null;

  const menu = (
    <CardMenu
      items={provider ? [
        { label: 'Ask Jurinex', icon: Sparkles, onClick: () => onAsk(file) },
        { label: 'Edit', icon: FileEdit, onClick: () => onEdit(file) },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(file) },
      ] : [
        { label: 'Ask Jurinex', icon: Sparkles, onClick: () => onAsk(file) },
        { label: 'View', icon: Eye, onClick: () => onView(file) },
        { label: 'Download', icon: Download, onClick: () => onDownload(file) },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(file) },
      ]}
    />
  );

  const providerChip = provider && (
    <span
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={provider === 'google'
        ? { background: '#e8f0fe', color: '#1a73e8' }
        : { background: '#fdecec', color: '#d3372c' }}
    >
      {PROVIDER_LABELS[provider] || provider}
    </span>
  );

  const handleOpen = () => (provider ? onEdit(file) : onView(file));

  const status = processing ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium">
      <Loader2 className="w-3 h-3 animate-spin" />
      Processing…
    </span>
  ) : null;

  if (view === 'list') {
    return (
      <div
        className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all duration-150"
        onClick={handleOpen}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50">
          {provider ? <FileEdit className="w-4 h-4" style={{ color: provider === 'google' ? '#1a73e8' : '#d3372c' }} /> : <FileText className="w-4 h-4 text-gray-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
            {provider ? providerChip : <>{formatSize(file.size)} ·</>} {formatDate(file.created_at)} {status && <>· {status}</>}
          </p>
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 p-5 relative cursor-pointer transition-all duration-200 hover:shadow-lg"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
      onClick={handleOpen}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50">
          {provider ? <FileEdit className="w-5 h-5" style={{ color: provider === 'google' ? '#1a73e8' : '#d3372c' }} /> : <FileText className="w-5 h-5 text-gray-400" />}
        </div>
        {menu}
      </div>
      <h3 className="text-sm font-semibold text-gray-800 mb-2 leading-snug line-clamp-2 break-all">{file.name}</h3>
      <p className="text-[11px] text-gray-400">{provider ? providerChip : <>{formatSize(file.size)} · {formatDate(file.created_at)}</>}</p>
      {status && <div className="mt-2">{status}</div>}
    </div>
  );
};

const CaseStoragePage = () => {
  const { folders, loadFoldersAndFiles, loading, error } = useContext(FileManagerContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const openFolderName = searchParams.get('folder');

  const [activeTab, setActiveTab] = useState('documents');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [casesPage, setCasesPage] = useState(1); // pagination — My Cases tab only
  const [viewMode, setViewMode] = useState('grid');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const [storageFolders, setStorageFolders] = useState([]);
  const [storageLoading, setStorageLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // 0-100 while uploading
  const [uploadCount, setUploadCount] = useState(0);

  const uploadInputRef = useRef(null);
  const uploadFolderRef = useRef(null);
  const pollRef = useRef(null);

  const loadStorageFolders = useCallback(async () => {
    try {
      const data = await documentApi.getStorageFolders();
      setStorageFolders(data.folders);
    } catch (err) {
      console.error('Failed to load storage folders:', err);
      toast.error('Failed to load Case Storage folders.');
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => { loadFoldersAndFiles(); loadStorageFolders(); }, [loadFoldersAndFiles, loadStorageFolders]);

  const isStorageFolder = useCallback(
    (folderName) => storageFolders.some((f) => f.name === folderName),
    [storageFolders]
  );

  const fetchFiles = useCallback(async (folderName) => {
    try {
      const data = await documentApi.getDocumentsInFolder(folderName);
      const list = (data.files || []).map((f) => ({
        id: f.id || f._id,
        name: f.name || f.originalname || f.filename || f.original_name || 'Unnamed Document',
        size: f.size || f.fileSize || 0,
        created_at: f.created_at || f.createdAt || f.uploadedAt,
        status: f.status || f.processing_status || 'unknown',
        mimetype: f.mimetype || f.mimeType,
        metadata: f.metadata || null,
      }));
      setFiles(list);
      return list;
    } catch (err) {
      console.error('Failed to fetch folder files:', err);
      toast.error('Failed to load folder contents.');
      setFiles([]);
      return [];
    }
  }, []);

  // Load files when a folder is open; poll every 4s while anything is still processing.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!openFolderName) { setFiles([]); return undefined; }
    setFilesLoading(true);
    fetchFiles(openFolderName).finally(() => setFilesLoading(false));
    pollRef.current = setInterval(async () => {
      const list = await fetchFiles(openFolderName);
      const stillProcessing = list.some((f) => PROCESSING_STATUSES.includes((f.status || '').toLowerCase()));
      if (!stillProcessing) clearInterval(pollRef.current);
    }, 4000);
    return () => clearInterval(pollRef.current);
  }, [openFolderName, fetchFiles]);

  const openFolder = (folderName) => {
    setSearchQuery('');
    setPreviewFile(null);
    setSearchParams({ folder: folderName });
  };
  const closeFolder = () => { setSearchQuery(''); setPreviewFile(null); setSearchParams({}); };

  const tabFolders = activeTab === 'documents' ? storageFolders : folders;
  const tabLoading = activeTab === 'documents' ? storageLoading : loading;

  const visibleFolders = [...tabFolders]
    .filter((f) =>
      (f.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.case_title || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') return (a.case_title || a.name).localeCompare(b.case_title || b.name);
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const visibleFiles = files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Pagination (My Cases tab only — My Documents keeps the full list).
  const CASES_PAGE_SIZE = 9;
  const isCasesTab = activeTab === 'cases';
  const totalCasePages = Math.max(1, Math.ceil(visibleFolders.length / CASES_PAGE_SIZE));
  const safeCasesPage = Math.min(casesPage, totalCasePages); // clamps after deletes/filtering
  const pagedFolders = isCasesTab
    ? visibleFolders.slice((safeCasesPage - 1) * CASES_PAGE_SIZE, safeCasesPage * CASES_PAGE_SIZE)
    : visibleFolders;

  // Back to page 1 whenever the visible set changes shape.
  useEffect(() => { setCasesPage(1); }, [activeTab, searchQuery, sortBy]);

  const handleCreateFolder = async (folderName) => {
    try {
      await documentApi.createFolder(folderName, STORAGE_PARENT_PATH);
      toast.success('Folder created');
      setIsCreatingFolder(false);
      setActiveTab('documents');
      await loadStorageFolders();
    } catch (err) {
      toast.error(`Error creating folder: ${err.response?.data?.details || err.message}`);
    }
  };

  const triggerUpload = (folderName) => {
    uploadFolderRef.current = folderName;
    uploadInputRef.current?.click();
  };

  const handleFilesSelected = async (fileList) => {
    const selected = Array.from(fileList || []);
    const folderName = uploadFolderRef.current;
    if (!selected.length || !folderName) return;

    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (selected.some((f) => f.size > MAX_FILE_SIZE)) {
      toast.error('File size limit exceeded. You can upload only up to 100 MB.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadCount(selected.length);
    try {
      // Storage-only: keep the file, skip the OCR/embedding pipeline entirely.
      const res = await documentApi.uploadDocuments(folderName, selected, null, {
        process: false,
        onProgress: setUploadProgress,
      });
      if (res.success === false && res.message) {
        toast.error(res.message, { autoClose: 7000 });
        return;
      }
      // uploadDocuments collects per-file failures instead of throwing — surface them.
      const failed = (res.documents || []).filter((d) => d.status === 'failed' || d.error);
      if (failed.length) {
        toast.error(
          `${failed.length} file${failed.length > 1 ? 's' : ''} failed to upload${failed[0].error ? `: ${failed[0].error}` : ''}`,
          { autoClose: 7000 }
        );
      }
      const okCount = selected.length - failed.length;
      if (okCount > 0) toast.success(`${okCount} file${okCount > 1 ? 's' : ''} uploaded`);
      if (openFolderName !== folderName) openFolder(folderName);
      else {
        // Re-run the load effect's polling by refetching now
        await fetchFiles(folderName);
        clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const list = await fetchFiles(folderName);
          if (!list.some((f) => PROCESSING_STATUSES.includes((f.status || '').toLowerCase()))) clearInterval(pollRef.current);
        }, 4000);
      }
    } catch (e) {
      console.error('Upload failed:', e);
      toast.error(e.response?.data?.message || e.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadCount(0);
    }
  };

  const handleDeleteFile = async (file) => {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      await documentApi.deleteFile(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (e) {
      toast.error(`Failed to delete: ${e.response?.data?.error || e.message}`);
    }
  };

  // Preview modal state — same tab. Opens IMMEDIATELY with a spinner; the signed URL
  // and the document itself stream in after, so the click always feels instant.
  const [askFile, setAskFile] = useState(null); // file for the Ask Jurinex chat modal

  // Editor-backed docs (Google/Zoho) are snapshotted first (fresh export of the
  // CURRENT content) so the chat grounds on what the document says right now.
  const handleAskFile = async (f) => {
    if (f.status === 'external' && f.metadata?.provider) {
      const toastId = toast.loading('Preparing document for chat…');
      try {
        const res = await documentApi.getChatSource(f.id);
        toast.dismiss(toastId);
        setAskFile({ id: res.chat_file_id, name: f.name });
      } catch (err) {
        toast.dismiss(toastId);
        const detail = err.response?.data?.detail;
        toast.error(typeof detail === 'string' ? detail : detail?.message || err.message || 'Could not prepare document for chat');
      }
    } else {
      setAskFile(f);
    }
  };
  const [previewFile, setPreviewFile] = useState(null); // { file, url|null }
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewReady, setPreviewReady] = useState(false);

  const closePreview = () => { setPreviewFile(null); setPreviewZoom(100); setPreviewReady(false); };

  const handleViewFile = async (file) => {
    setPreviewFile({ file, url: null });
    setPreviewZoom(100);
    setPreviewReady(false);
    try {
      const info = await documentApi.getDocumentViewInfo(file.id);
      if (!info?.viewUrl) throw new Error('No view URL returned');
      setPreviewFile((prev) => (prev && prev.file.id === file.id ? { file, url: info.viewUrl } : prev));
    } catch (e) {
      closePreview();
      toast.error(`Could not open file: ${e.response?.data?.detail || e.message}`);
    }
  };

  const isPdfPreview = previewFile
    && (/\.pdf$/i.test(previewFile.file.name) || (previewFile.file.mimetype || '').includes('pdf'));
  // Chrome/Firefox built-in PDF viewers honor #zoom= on load; changing it reloads the frame.
  const previewSrc = previewFile?.url
    ? (isPdfPreview ? `${previewFile.url}#zoom=${previewZoom}` : previewFile.url)
    : null;

  const handleDownloadFile = async (file) => {
    try {
      const info = await documentApi.getDocumentViewInfo(file.id);
      if (!info?.viewUrl) throw new Error('No download URL returned');
      try {
        // Fetch as blob so the browser saves instead of previewing.
        const res = await fetch(info.viewUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (_) {
        // Bucket CORS may block the blob fetch — fall back to opening the signed URL.
        window.open(info.viewUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      toast.error(`Could not download file: ${e.response?.data?.detail || e.message}`);
    }
  };

  const [renameTarget, setRenameTarget] = useState(null); // folder being renamed
  const [renameValue, setRenameValue] = useState('');

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await documentApi.renameStorageFolder(renameTarget.id, renameValue.trim());
      toast.success('Folder renamed');
      setRenameTarget(null);
      await loadStorageFolders();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Failed to rename folder');
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (!window.confirm(`Delete folder "${folder.name}" and all its files? This cannot be undone.`)) return;
    try {
      // Delete the folder's files first — the folder-delete endpoint matches files by the
      // folder's full path, but storage files use the short name, so they'd be orphaned.
      const data = await documentApi.getDocumentsInFolder(folder.name);
      for (const f of data.files || []) {
        if (f.id || f._id) await documentApi.deleteFile(f.id || f._id);
      }
      await documentApi.deleteFolderWithContents(folder.name);
      toast.success('Folder deleted');
      await loadStorageFolders();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Failed to delete folder');
    }
  };

  const storageFolderMenu = (folder) => [
    { label: 'Rename', icon: Pencil, onClick: () => { setRenameTarget(folder); setRenameValue(folder.name); } },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDeleteFolder(folder) },
  ];

  // ── Create Document (Google Docs / Zoho Writer) ────────────────────────────
  const [createDocMenuOpen, setCreateDocMenuOpen] = useState(false);
  const [docTitleModal, setDocTitleModal] = useState(null); // { provider, folderName }
  const [docTitleValue, setDocTitleValue] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [googleConnect, setGoogleConnect] = useState(null); // { authUrl }
  // Distinguishes what the folder picker was opened for: 'upload' | {createDoc: provider}
  const pendingActionRef = useRef(null);

  const [editorSession, setEditorSession] = useState(null); // { file, url|null }
  const [editorReady, setEditorReady] = useState(false);
  const closeEditor = () => { setEditorSession(null); setEditorReady(false); };

  const openEditor = async (file) => {
    setEditorSession({ file, url: null });
    setEditorReady(false);
    try {
      const session = await documentApi.getEditorSession(file.id);
      const url = session.iframeUrl || session.iframe_url || session.editorUrl;
      if (!url) throw new Error('No editor URL returned');
      setEditorSession((prev) => (prev && prev.file.id === file.id ? { file, url } : prev));
    } catch (e) {
      closeEditor();
      const detail = e.response?.data?.detail;
      toast.error(`Could not open editor: ${typeof detail === 'string' ? detail : detail?.message || e.message}`);
    }
  };

  const startCreateDocument = (provider) => {
    setCreateDocMenuOpen(false);
    if (openFolderName) {
      setDocTitleModal({ provider, folderName: openFolderName });
      setDocTitleValue('');
    } else {
      pendingActionRef.current = { createDoc: provider };
      setIsPickerOpen(true);
    }
  };

  const handleCreateDocumentSubmit = async (e) => {
    e.preventDefault();
    if (!docTitleModal || !docTitleValue.trim() || creatingDoc) return;
    const { provider, folderName } = docTitleModal;
    setCreatingDoc(true);
    try {
      if (provider === 'google') {
        const auth = await documentApi.getGoogleAuthStatus();
        if (!auth?.connected) {
          setCreatingDoc(false);
          setDocTitleModal(null);
          setGoogleConnect({ authUrl: auth?.authUrl || null });
          return;
        }
      }
      const result = await documentApi.createStorageDocument(folderName, provider, docTitleValue.trim());
      setDocTitleModal(null);
      toast.success('Document created');
      if (openFolderName === folderName) await fetchFiles(folderName);
      else openFolder(folderName);
      if (result?.file?.id) openEditor({ ...result.file, metadata: result.file.metadata });
    } catch (err) {
      const detail = err.response?.data?.detail;
      // detail may arrive as an object or a stringified dict depending on the error handler
      const notConnected = detail?.code === 'GOOGLE_NOT_CONNECTED' || String(detail).includes('GOOGLE_NOT_CONNECTED');
      if (notConnected) {
        setDocTitleModal(null);
        setGoogleConnect({ authUrl: null });
      } else {
        toast.error(typeof detail === 'string' ? detail : detail?.message || err.message || 'Failed to create document');
      }
    } finally {
      setCreatingDoc(false);
    }
  };

  const handleConnectGoogle = async () => {
    let url = googleConnect?.authUrl;
    let serverError = null;
    if (!url) {
      try {
        const auth = await documentApi.getGoogleAuthStatus();
        url = auth?.authUrl;
        serverError = auth?.error;
      } catch (_) {}
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else toast.error(serverError || 'Could not get the Google connection link from the auth service.');
  };

  const handleCreateNewForUpload = async (folderName) => {
    try {
      await documentApi.createFolder(folderName, STORAGE_PARENT_PATH);
      setActiveTab('documents');
      await loadStorageFolders();
      openFolder(folderName);
    } catch (err) {
      toast.error(`Error creating folder: ${err.response?.data?.details || err.message}`);
    }
  };

  const inFolder = Boolean(openFolderName);

  // Ask Jurinex takes over the content area (app sidebar stays visible).
  if (askFile) {
    return <CaseStorageChat file={askFile} folderName={openFolderName} onClose={() => setAskFile(null)} />;
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { handleFilesSelected(e.target.files); e.target.value = ''; }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f0fdfb' }}>
                <Archive className="w-4 h-4" style={{ color: TEAL }} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Case Storage</h1>
            </div>
            <p className="text-sm text-gray-400 ml-10">Create folders and upload documents into them</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                if (inFolder) { triggerUpload(openFolderName); }
                else { pendingActionRef.current = 'upload'; setIsPickerOpen(true); }
              }}
              disabled={uploading}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all duration-200 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-teal-600" /> : <Upload className="w-4 h-4 text-teal-600" />}
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <div className="relative">
              <button
                onClick={() => setCreateDocMenuOpen((o) => !o)}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all duration-200"
              >
                <FilePlus className="w-4 h-4 text-teal-600" />
                Create Document
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {createDocMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setCreateDocMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden min-w-[170px]">
                    <button
                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                      onClick={() => startCreateDocument('google')}
                    >
                      <FileEdit className="w-3.5 h-3.5" style={{ color: '#1a73e8' }} />
                      Google Docs
                    </button>
                    <button
                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                      onClick={() => startCreateDocument('zoho')}
                    >
                      <FileEdit className="w-3.5 h-3.5" style={{ color: '#d3372c' }} />
                      Zoho Writer
                    </button>
                  </div>
                </>
              )}
            </div>
            {!inFolder && (
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="flex items-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                style={{ background: TEAL }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1AA49B')}
                onMouseLeave={(e) => (e.currentTarget.style.background = TEAL)}
              >
                <FolderPlus className="w-4 h-4" />
                New Folder
              </button>
            )}
          </div>
        </div>

        {/* Tabs (top level only) */}
        {!inFolder && (
          <div className="flex items-center gap-1 mb-6 bg-white border border-gray-100 rounded-xl p-1 w-fit" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <button
              onClick={() => setActiveTab('documents')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={activeTab === 'documents' ? { background: '#f0fdfb', color: TEAL } : { color: '#9ca3af' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TEAL }} />
              My Documents
            </button>
            <button
              onClick={() => setActiveTab('cases')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={activeTab === 'cases' ? { background: '#eefdf3', color: '#16a34a' } : { color: '#9ca3af' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              My Cases
            </button>
          </div>
        )}

        {/* Search & Controls */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={inFolder ? 'Search files in this folder...' : 'Search files, folders, documents...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none transition-all bg-gray-50 text-gray-800 placeholder-gray-400"
            />
          </div>

          {!inFolder && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value="activity">Recent Activity</option>
                <option value="name">Name</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-1 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className="p-1.5 rounded-lg transition-colors"
              style={viewMode === 'grid' ? { background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : {}}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" style={{ color: viewMode === 'grid' ? TEAL : '#9ca3af' }} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="p-1.5 rounded-lg transition-colors"
              style={viewMode === 'list' ? { background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : {}}
              title="List view"
            >
              <List className="w-4 h-4" style={{ color: viewMode === 'list' ? TEAL : '#9ca3af' }} />
            </button>
          </div>
        </div>

        {/* Breadcrumb (inside a folder) */}
        {inFolder && (
          <div className="flex items-center gap-1.5 mb-5 text-sm">
            <button onClick={closeFolder} className="font-semibold text-[#21C1B6] hover:underline">
              {isStorageFolder(openFolderName) ? 'My Documents' : 'My Cases'}
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            <span className="font-bold text-gray-800 truncate">{openFolderName}</span>
          </div>
        )}

        {/* Content */}
        {/* Upload progress bar — live byte progress across all selected files */}
        {inFolder && uploadProgress !== null && (
          <div className="mb-4 bg-white rounded-2xl border border-gray-100 p-4" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEAL }} />
                Uploading {uploadCount} file{uploadCount > 1 ? 's' : ''}…
              </span>
              <span className="text-sm font-semibold text-gray-500">{uploadProgress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e6f7f5' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.max(uploadProgress, 2)}%`, background: TEAL }}
              />
            </div>
          </div>
        )}

        {inFolder ? (
          filesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-100">
              <h3 className="text-base font-semibold text-gray-700 mb-1">
                {searchQuery ? 'No matching files' : 'This folder is empty'}
              </h3>
              <p className="text-sm text-gray-400 mb-5">
                {searchQuery ? 'Try a different search term' : 'Upload a document to get started.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => triggerUpload(openFolderName)}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
                  style={{ background: TEAL }}
                >
                  <Upload className="w-4 h-4" />
                  Upload Documents
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleFiles.map((file) => (
                <FileCard key={file.id} file={file} view="grid" onView={handleViewFile} onDownload={handleDownloadFile} onDelete={handleDeleteFile} onEdit={openEditor} onAsk={handleAskFile} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleFiles.map((file) => (
                <FileCard key={file.id} file={file} view="list" onView={handleViewFile} onDownload={handleDownloadFile} onDelete={handleDeleteFile} onEdit={openEditor} onAsk={handleAskFile} />
              ))}
            </div>
          )
        ) : tabLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-red-50">
              <FolderOpen className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">Failed to load folders</h3>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        ) : visibleFolders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#f0fdfb' }}>
              <FolderOpen className="w-8 h-8" style={{ color: TEAL }} />
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">No folders found</h3>
            <p className="text-sm text-gray-400 mb-5">
              {searchQuery ? 'Try adjusting your search terms' : 'Create a folder to start uploading documents'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ background: TEAL }}
              >
                <FolderPlus className="w-4 h-4" />
                Create Your First Folder
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pagedFolders.map((folder) => (
              <FolderCard
                key={folder.id || folder.name}
                folder={folder}
                onClick={() => openFolder(folder.name)}
                menuItems={activeTab === 'documents' ? storageFolderMenu(folder) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {pagedFolders.map((folder) => (
              <FolderRow
                key={folder.id || folder.name}
                folder={folder}
                onClick={() => openFolder(folder.name)}
                menuItems={activeTab === 'documents' ? storageFolderMenu(folder) : undefined}
              />
            ))}
          </div>
        )}

        {/* Pagination — My Cases tab */}
        {!inFolder && isCasesTab && totalCasePages > 1 && !tabLoading && (
          <div className="mt-6 flex items-center justify-center gap-1.5">
            <button
              onClick={() => setCasesPage((p) => Math.max(1, p - 1))}
              disabled={safeCasesPage === 1}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            {Array.from({ length: totalCasePages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setCasesPage(p)}
                className="w-9 h-9 rounded-lg text-sm font-semibold transition-colors"
                style={p === safeCasesPage
                  ? { background: TEAL, color: '#fff' }
                  : { background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb' }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setCasesPage((p) => Math.min(totalCasePages, p + 1))}
              disabled={safeCasesPage === totalCasePages}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {!inFolder && visibleFolders.length > 0 && !tabLoading && (
          <div className="mt-5 text-center text-xs text-gray-400 font-medium">
            {isCasesTab && totalCasePages > 1
              ? `Showing ${(safeCasesPage - 1) * CASES_PAGE_SIZE + 1}–${Math.min(safeCasesPage * CASES_PAGE_SIZE, visibleFolders.length)} of ${visibleFolders.length} cases`
              : `Showing ${visibleFolders.length} folder${visibleFolders.length !== 1 ? 's' : ''}`}
          </div>
        )}
        {inFolder && visibleFiles.length > 0 && !filesLoading && (
          <div className="mt-5 text-center text-xs text-gray-400 font-medium">
            Showing {visibleFiles.length} file{visibleFiles.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <CreateFolderModal
        isOpen={isCreatingFolder}
        onClose={() => setIsCreatingFolder(false)}
        onCreate={handleCreateFolder}
      />

      <FolderPickerModal
        isOpen={isPickerOpen}
        onClose={() => { setIsPickerOpen(false); pendingActionRef.current = null; }}
        folders={storageFolders}
        onChooseExisting={(folderName) => {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          openFolder(folderName);
          if (action && action.createDoc) {
            setDocTitleModal({ provider: action.createDoc, folderName });
            setDocTitleValue('');
          } else {
            triggerUpload(folderName);
          }
        }}
        onCreateNew={async (folderName) => {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          if (action && action.createDoc) {
            try {
              await documentApi.createFolder(folderName, STORAGE_PARENT_PATH);
              setActiveTab('documents');
              await loadStorageFolders();
              openFolder(folderName);
              setDocTitleModal({ provider: action.createDoc, folderName });
              setDocTitleValue('');
            } catch (err) {
              toast.error(`Error creating folder: ${err.response?.data?.details || err.message}`);
            }
          } else {
            await handleCreateNewForUpload(folderName);
          }
        }}
      />

      {/* Create Document: title modal */}
      {docTitleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              New {PROVIDER_LABELS[docTitleModal.provider]} document
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              Will be created in <span className="font-semibold text-gray-600">{docTitleModal.folderName}</span>
            </p>
            <form onSubmit={handleCreateDocumentSubmit}>
              <input
                autoFocus
                type="text"
                value={docTitleValue}
                onChange={(e) => setDocTitleValue(e.target.value)}
                placeholder="Document title..."
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setDocTitleModal(null)}
                  disabled={creatingDoc}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingDoc || !docTitleValue.trim()}
                  className="px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-60"
                  style={{ backgroundColor: TEAL }}
                >
                  {creatingDoc && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {creatingDoc ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Drive not connected */}
      {googleConnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 p-6 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect Google Drive</h3>
            <p className="text-sm text-gray-500 mb-5">
              To create Google Docs, connect your Google account first. After connecting, try again.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setGoogleConnect(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnectGoogle}
                className="px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors"
                style={{ backgroundColor: '#1a73e8' }}
              >
                Connect Google Drive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document editor modal — same tab (Google Docs / Zoho Writer) */}
      {editorSession && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-full flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-0.5">Document Editor</p>
                <h3 className="text-base font-bold text-gray-900 truncate">{editorSession.file.name}</h3>
              </div>
              <button
                onClick={closeEditor}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
                aria-label="Close editor"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 relative" style={{ background: '#f1f5f9' }}>
              {(!editorSession.url || !editorReady) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: TEAL }} />
                  <p className="text-sm text-gray-400 font-medium">Opening editor…</p>
                </div>
              )}
              {editorSession.url && (
                <iframe
                  src={editorSession.url}
                  title={editorSession.file.name}
                  className="w-full h-full border-0"
                  onLoad={() => setEditorReady(true)}
                  allow="clipboard-read; clipboard-write"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Document preview modal — same tab, no OCR/page controls.
          White backdrop (no dark dimming) and near-full-width panel. */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" style={{ background: '#f8fafc' }}>
          <div className="bg-white rounded-2xl w-[96vw] max-w-[1700px] h-full flex flex-col overflow-hidden border border-gray-200 shadow-lg">
            {/* Header */}
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-0.5">Document Preview</p>
                  <h3 className="text-base font-bold text-gray-900 truncate">{previewFile.file.name}</h3>
                </div>
                <button
                  onClick={closePreview}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <div className="flex items-center gap-1 border border-gray-200 rounded-xl px-1 py-0.5">
                  <button
                    onClick={() => setPreviewZoom((z) => Math.max(50, z - 25))}
                    disabled={!isPdfPreview}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold text-gray-600 w-11 text-center">{previewZoom}%</span>
                  <button
                    onClick={() => setPreviewZoom((z) => Math.min(300, z + 25))}
                    disabled={!isPdfPreview}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => handleDownloadFile(previewFile.file)}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 relative" style={{ background: '#f1f5f9' }}>
              {(!previewSrc || !previewReady) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: TEAL }} />
                  <p className="text-sm text-gray-400 font-medium">Loading preview…</p>
                </div>
              )}
              {previewSrc && (
                <iframe
                  key={previewSrc}
                  src={previewSrc}
                  title={previewFile.file.name}
                  className="w-full h-full border-0"
                  onLoad={() => setPreviewReady(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rename folder</h3>
            <form onSubmit={handleRenameSubmit}>
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors"
                  style={{ backgroundColor: TEAL }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TEAL)}
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaseStoragePage;
