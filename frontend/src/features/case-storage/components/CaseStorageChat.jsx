import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toast } from 'react-toastify';
import {
  X, Loader2, Sparkles, Plus, AlignLeft, ArrowLeft, ArrowUp,
  Info, ChevronDown, Copy, Check, CornerDownRight, MoreVertical, RefreshCw, FileDown,
  Folder, FolderOpen, Upload, ChevronLeft,
} from 'lucide-react';
import apiService from '@/shared/api/api';
import documentApi from '@/shared/api/documentApi';
import googleDriveApi, {
  openGooglePicker,
  getGooglePickerApiKey,
  validateGooglePickerApiKey,
} from '@/shared/api/googleDriveApi';
import driveLogo from '@/assets/3128271.png';
import {
  ensureTableSeparators,
  normalizeMarkdownFormatting,
  markdownTableComponents,
  markdownRehypePlugins,
} from '@/shared/utils/markdownUtils';
import '@/features/chat/styles/ChatInterface.css';

const TEAL = '#21C1B6';
const TEAL_DARK = '#0f766e';

const SUGGESTED_PROMPTS = [
  'Summarize this document',
  'List key dates and events',
  'Extract the parties and their claims',
];

// Fixed marker prompt for the auto AI Overview: its session is filtered out of
// the History tab by exact match, and the result is cached per file locally.
const OVERVIEW_PROMPT =
  'Provide a concise overview of this document in 3-4 sentences: what it is, the parties or subject involved, and its key points. Respond with the overview only.';
const overviewCacheKey = (fileId) => `jnx_ai_overview_${fileId}`;

// Plain document-style tables (bordered cells, tinted header — the md-doc-table
// look) instead of the interactive data grid with search/sort/CSV controls.
const docTableComponents = {
  ...markdownTableComponents,
  table: ({ node, ...props }) => (
    <div className="md-table-scroll">
      <table className="md-doc-table" {...props} />
    </div>
  ),
};

/** Assistant answer rendered through the same pipeline ChatModel uses:
 * normalize (broken tables, ASCII art, stray HTML) → repair missing table
 * separators → GFM markdown with plain document-style tables.
 * Memoized so streaming re-renders only reprocess the message being streamed. */
const AssistantMarkdown = React.memo(({ text }) => {
  const processed = useMemo(
    () => ensureTableSeparators(normalizeMarkdownFormatting(text || '')),
    [text]
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={markdownRehypePlugins}
      components={docTableComponents}
    >
      {processed}
    </ReactMarkdown>
  );
});

/** "Today" / "Yesterday" / "12 Aug 2026" for history rows. */
const formatRelativeDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const sessionTitle = (s) =>
  s.title || s.first_question || s.question || s.messages?.[0]?.question || 'Chat session';

/** Small file-type badge like Drive's (red square for PDF, gray otherwise). */
const FileTypeBadge = ({ name }) => {
  const ext = (name || '').split('.').pop().toLowerCase();
  const isPdf = ext === 'pdf';
  const label = isPdf ? 'PDF' : (ext || 'DOC').slice(0, 4).toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[8px] font-bold text-white flex-shrink-0"
      style={{ background: isPdf ? '#dc2626' : '#64748b' }}
    >
      {label}
    </span>
  );
};

// Backend cap: chat accepts up to max_upload_files (default 8) files per question.
const MAX_SOURCES = 8;

/**
 * "Add from Case Storage" picker — browse storage folders, multi-select files,
 * confirm. Files already attached as sources show as disabled "Added" rows.
 */
const SourcePickerModal = ({ open, onClose, onAdd, existingIds }) => {
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(null); // opened folder name, null = folder list
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState({}); // id -> file

  useEffect(() => {
    if (!open) return;
    setFolder(null);
    setFiles([]);
    setSelected({});
    setLoading(true);
    documentApi
      .getStorageFolders()
      .then((data) => setFolders(data.folders || []))
      .catch(() => toast.error('Failed to load Case Storage folders.'))
      .finally(() => setLoading(false));
  }, [open]);

  const openFolder = async (name) => {
    setFolder(name);
    setFiles([]);
    setLoading(true);
    try {
      const data = await documentApi.getDocumentsInFolder(name);
      setFiles(
        (data.files || []).map((f) => ({
          id: f.id || f._id,
          name: f.name || f.originalname || f.filename || f.original_name || 'Unnamed Document',
          status: f.status || f.processing_status || '',
          metadata: f.metadata || null,
        }))
      );
    } catch (_) {
      toast.error('Failed to load folder contents.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  const picked = Object.values(selected);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
          {folder && (
            <button
              onClick={() => { setFolder(null); setFiles([]); }}
              className="p-1 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Back to folders"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <h4 className="text-[15px] font-semibold text-gray-900 truncate">
            {folder || 'Add from Case Storage'}
          </h4>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEAL }} />
            </div>
          ) : !folder ? (
            folders.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No Case Storage folders yet.</p>
            ) : (
              folders.map((fo) => (
                <button
                  key={fo.name}
                  onClick={() => openFolder(fo.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors"
                >
                  <Folder className="w-5 h-5 flex-shrink-0" style={{ color: TEAL_DARK }} />
                  <span className="text-sm text-gray-800 truncate">{fo.name}</span>
                </button>
              ))
            )
          ) : files.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">This folder is empty.</p>
          ) : (
            files.map((f) => {
              const already = existingIds.has(String(f.id));
              const isPicked = !!selected[f.id];
              return (
                <label
                  key={f.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    already ? 'opacity-50 cursor-default' : 'hover:bg-gray-50 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={already || isPicked}
                    disabled={already}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        if (next[f.id]) delete next[f.id];
                        else next[f.id] = f;
                        return next;
                      })
                    }
                    className="w-4 h-4 rounded flex-shrink-0"
                    style={{ accentColor: TEAL }}
                  />
                  <FileTypeBadge name={f.name} />
                  <span className="text-sm text-gray-700 truncate flex-1">{f.name}</span>
                  {already && <span className="text-xs text-gray-400 flex-shrink-0">Added</span>}
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onAdd(picked)}
            disabled={picked.length === 0}
            className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: TEAL }}
          >
            Add{picked.length > 0 ? ` (${picked.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

/** One history row: ≡ icon, single-line title, relative day below (reference style). */
const SessionRow = ({ s, active, onOpen }) => (
  <button
    onClick={() => onOpen(s.session_id || s.id)}
    className="w-full text-left px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-start gap-3"
    style={active ? { background: '#f0fdfb' } : {}}
  >
    <AlignLeft className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
    <span className="min-w-0">
      <span className="block text-[13px] text-gray-800 truncate">{sessionTitle(s)}</span>
      <span className="block text-xs text-gray-500 mt-0.5">
        {formatRelativeDay(s.last_message_at || s.first_message_at || s.created_at)}
      </span>
    </span>
  </button>
);

/**
 * "Ask Jurinex" — chat about one Case Storage file, in-page (same tab).
 *
 * Reuses the ChatModel document-chat backend (agentic-chat-service /api/chat/*):
 * messages reference the file by user_files id only; the backend streams the raw
 * GCS object to the LLM, so unprocessed (storage-only) files work without OCR.
 */
const CaseStorageChat = ({ file, folderName, onClose }) => {
  const [messages, setMessages] = useState([]); // {role: 'user'|'assistant', text, streaming?}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('sources'); // 'sources' | 'history'
  const [copiedIdx, setCopiedIdx] = useState(null);

  // Grounding sources for the chat. The opened file is always the first source;
  // more can be added from Case Storage or uploaded from the device (Gemini-style).
  const [sources, setSources] = useState([{ id: file.id, name: file.name, checked: true }]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false); // uploading / snapshotting new sources
  const uploadRef = useRef(null);

  const sourceIds = useMemo(() => new Set(sources.map((s) => String(s.id))), [sources]);
  const checkedSources = sources.filter((s) => s.checked);

  const addSources = (items) => {
    // items: [{id, name}] — dedupe against current, enforce the backend cap.
    setSources((prev) => {
      const existing = new Set(prev.map((s) => String(s.id)));
      const fresh = items.filter((it) => it.id && !existing.has(String(it.id)));
      if (!fresh.length) return prev;
      const merged = [...prev, ...fresh.map((it) => ({ id: it.id, name: it.name, checked: true }))];
      if (merged.length > MAX_SOURCES) {
        toast.error(`You can use up to ${MAX_SOURCES} sources per chat.`);
        return merged.slice(0, MAX_SOURCES);
      }
      return merged;
    });
  };

  const toggleSource = (id) =>
    setSources((prev) => prev.map((s) => (String(s.id) === String(id) ? { ...s, checked: !s.checked } : s)));

  // Picker confirm: external (Google/Zoho) docs are snapshotted first so the chat
  // grounds on their current content — same flow as opening Ask Jurinex on them.
  const handlePickerAdd = async (picked) => {
    setPickerOpen(false);
    if (!picked.length) return;
    if (sources.length + picked.length > MAX_SOURCES) {
      toast.error(`You can use up to ${MAX_SOURCES} sources per chat.`);
      return;
    }
    setAddBusy(true);
    try {
      const items = [];
      for (const f of picked) {
        if (f.status === 'external' && f.metadata?.provider) {
          const res = await documentApi.getChatSource(f.id);
          items.push({ id: res.chat_file_id, name: f.name });
        } else {
          items.push({ id: f.id, name: f.name });
        }
      }
      addSources(items);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : detail?.message || err.message || 'Could not add source');
    } finally {
      setAddBusy(false);
    }
  };

  // Add from Google Drive → connect (popup OAuth if needed), open the native
  // Google Picker, then server-side import into this chat's folder as
  // storage-only rows (process:false) and attach them as sources.
  const importDriveFiles = async (pickedFiles, accessToken) => {
    if (!pickedFiles?.length) return;
    if (sources.length + pickedFiles.length > MAX_SOURCES) {
      toast.error(`You can use up to ${MAX_SOURCES} sources per chat.`);
      return;
    }
    setAddBusy(true);
    try {
      const res = await googleDriveApi.downloadMultipleFiles(pickedFiles, accessToken, folderName, { process: false });
      const docs = res.documents || [];
      const ok = docs.filter((d) => d.id && !d.error);
      const failedCount = res.summary?.failed || docs.filter((d) => d.error || d.status === 'failed').length;
      if (failedCount) toast.error(`${failedCount} file${failedCount > 1 ? 's' : ''} failed to import from Google Drive`);
      if (ok.length) {
        addSources(ok.map((d) => ({ id: d.id, name: d.originalname || d.document_name || 'Document' })));
        toast.success(`${ok.length} source${ok.length > 1 ? 's' : ''} added from Google Drive`);
      }
    } catch (e) {
      if (e.response?.data?.needsAuth) toast.error('Google Drive authorization expired. Please reconnect.');
      else toast.error(e.response?.data?.message || e.message || 'Failed to import from Google Drive');
    } finally {
      setAddBusy(false);
    }
  };

  const handleAddFromDrive = async () => {
    if (!folderName) {
      toast.error('Open a folder to import new sources.');
      return;
    }
    setAddBusy(true);
    try {
      const status = await googleDriveApi.getConnectionStatus();
      if (!status.connected) {
        // One-time OAuth in a popup (Google blocks OAuth inside iframes/pages).
        const { authUrl } = await googleDriveApi.initiateAuth();
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(authUrl, 'google-drive-auth', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`);
        await new Promise((resolve) => {
          const t = setInterval(() => { if (!popup || popup.closed) { clearInterval(t); resolve(); } }, 500);
        });
        const again = await googleDriveApi.getConnectionStatus();
        if (!again.connected) {
          toast.info('Google Drive was not connected.');
          return;
        }
      }
      const keyValidation = validateGooglePickerApiKey(getGooglePickerApiKey());
      if (!keyValidation.valid) {
        toast.error('Google Drive Picker is not configured. Set VITE_GOOGLE_DRIVE_API_KEY in frontend/.env.');
        return;
      }
      let tokenData;
      try {
        tokenData = await googleDriveApi.getAccessToken();
      } catch (e) {
        if (e.response?.data?.needsAuth) {
          toast.info('Please reconnect your Google Drive');
          return;
        }
        throw e;
      }
      await openGooglePicker({
        accessToken: tokenData.accessToken,
        multiselect: true,
        onSelect: (picked) => importDriveFiles(picked, tokenData.accessToken),
        onCancel: () => {},
      });
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to open Google Drive');
    } finally {
      // The picker renders its own overlay; the busy row returns during import.
      setAddBusy(false);
    }
  };

  // Upload from device → storage-only upload (process=false) into this chat's
  // folder, then attach the new rows as sources.
  const handleDeviceFiles = async (fileList) => {
    const selected = Array.from(fileList || []);
    if (uploadRef.current) uploadRef.current.value = '';
    if (!selected.length) return;
    if (!folderName) {
      toast.error('Uploads need a Case Storage folder — use "Add from Case Storage" instead.');
      return;
    }
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (selected.some((f) => f.size > MAX_FILE_SIZE)) {
      toast.error('File size limit exceeded. You can upload only up to 100 MB.');
      return;
    }
    if (sources.length + selected.length > MAX_SOURCES) {
      toast.error(`You can use up to ${MAX_SOURCES} sources per chat.`);
      return;
    }
    setAddBusy(true);
    try {
      const res = await documentApi.uploadDocuments(folderName, selected, null, { process: false });
      if (res.success === false && res.message) {
        toast.error(res.message, { autoClose: 7000 });
        return;
      }
      const docs = res.documents || [];
      const failed = docs.filter((d) => d.status === 'failed' || d.error);
      if (failed.length) {
        toast.error(`${failed.length} file${failed.length > 1 ? 's' : ''} failed to upload`);
      }
      const ok = docs.filter((d) => d.id && !d.error);
      if (ok.length) {
        addSources(ok.map((d) => ({ id: d.id, name: d.originalname || d.document_name || 'Document' })));
        toast.success(`${ok.length} source${ok.length > 1 ? 's' : ''} added`);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Upload failed. Please try again.');
    } finally {
      setAddBusy(false);
    }
  };

  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiService.getChatModelSessions(file.id);
      // Hide the auto AI-Overview session — it's not a user conversation.
      const list = (res?.data?.sessions || []).filter(
        (s) => (s.messages?.[0]?.question || '') !== OVERVIEW_PROMPT
      );
      setSessions(list);
    } catch (_) {
      setSessions([]);
    }
  }, [file.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => () => { abortRef.current?.abort(); overviewAbortRef.current?.abort(); }, []);

  // ── AI Overview: auto-summary shown when the chat opens (cached per file) ──
  const [overview, setOverview] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewMenuOpen, setOverviewMenuOpen] = useState(false);
  const overviewAbortRef = useRef(null);

  const generateOverview = useCallback(async (force = false) => {
    if (!force) {
      const cached = localStorage.getItem(overviewCacheKey(file.id));
      if (cached) { setOverview(cached); return; }
    }
    setOverview('');
    setOverviewLoading(true);
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    // Stale-stream guard: StrictMode (and Regenerate) can abort+restart; only
    // the latest controller may touch state.
    const isCurrent = () => overviewAbortRef.current === controller;
    try {
      await apiService.askChatModelQuestionStream(
        OVERVIEW_PROMPT,
        file.id,
        null, // its own throwaway session — never reuses/sets the chat session
        (piece) => { if (isCurrent()) setOverview((prev) => prev + piece); },
        null, null,
        (done) => {
          if (!isCurrent()) return;
          const text = done?.answer || '';
          if (text) {
            setOverview(text);
            try { localStorage.setItem(overviewCacheKey(file.id), text); } catch (_) {}
          }
          setOverviewLoading(false);
        },
        () => { if (isCurrent()) setOverviewLoading(false); },
        null, false, null, null, null,
        { disable_cache: true, chat_source: 'case_storage' }, // no cache; tagged out of ChatModel's history
        null, null, null,
        controller.signal
      );
    } catch (_) {
      if (isCurrent()) setOverviewLoading(false);
    }
  }, [file.id]);

  // No run-once ref: StrictMode's setup→cleanup→setup cycle aborts the first
  // stream, so the effect must restart it on the second setup.
  useEffect(() => {
    generateOverview();
    return () => overviewAbortRef.current?.abort();
  }, [generateOverview]);

  const loadSession = async (sid) => {
    setHistoryLoading(true);
    setSidebarTab('sources');
    try {
      const res = await apiService.getChatModelHistory(file.id, sid);
      const history = res?.data?.history || [];
      const msgs = [];
      history.forEach((h) => {
        msgs.push({ role: 'user', text: h.prompt_label || h.question });
        msgs.push({ role: 'assistant', text: h.answer });
      });
      setMessages(msgs);
      setSessionId(sid);
      scrollToBottom();
    } catch (e) {
      console.error('Failed to load chat history:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setSending(false);
    setStatusText('');
  };

  const sendMessage = async (overrideText = null) => {
    const question = (overrideText ?? input).trim();
    if (!question || sending) return;
    const activeIds = sources.filter((s) => s.checked).map((s) => String(s.id));
    if (!activeIds.length) {
      toast.error('Select at least one source to ask about.');
      return;
    }
    setInput('');
    setSending(true);
    setStatusText('');
    setMessages((prev) => [...prev, { role: 'user', text: question }, { role: 'assistant', text: '', streaming: true }]);
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;

    const appendToAssistant = (piece) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + piece, streaming: true };
        return next;
      });
      scrollToBottom();
    };

    try {
      await apiService.askChatModelQuestionStream(
        question,
        activeIds[0],
        sessionId,
        appendToAssistant, // onChunk
        (status, message) => setStatusText(message || status || ''), // onStatus
        (meta) => { if (meta?.session_id) setSessionId(meta.session_id); }, // onMetadata
        (done) => { // onDone
          if (done?.session_id) setSessionId(done.session_id);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', text: done?.answer || last.text };
            }
            return next;
          });
          setStatusText('');
          setSending(false);
          loadSessions();
          scrollToBottom();
        },
        (message) => { // onError
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant' && !last.text) {
              next[next.length - 1] = { role: 'assistant', text: `⚠️ ${message || 'Something went wrong. Please try again.'}` };
            }
            return next;
          });
          setStatusText('');
          setSending(false);
        },
        null, false, null, null, null,
        { disable_cache: true, chat_source: 'case_storage' }, // extraFetchParams — no cache; tagged out of ChatModel's history
        activeIds.length > 1 ? activeIds : null, // fileIds — multi-source grounding
        null, // onThought
        null, // onUsage
        controller.signal
      );
    } catch (e) {
      setStatusText('');
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Download one answer as PDF/Word via the existing merged-export endpoints
  // (documentApi.exportMergedPdf/Docx build the file server-side and save it).
  const [exporting, setExporting] = useState(null); // { idx, kind: 'pdf'|'word' }

  const exportMessage = async (m, idx, kind) => {
    if (exporting) return;
    const question = messages[idx - 1]?.role === 'user' ? messages[idx - 1].text : 'Question';
    const baseName = (file.name || 'document').replace(/\.[^.]+$/, '');
    const title = `${baseName} — Jurinex Answer`;
    setExporting({ idx, kind });
    try {
      const sections = [{ question, answer: m.text }];
      if (kind === 'pdf') await documentApi.exportMergedPdf(title, sections, true);
      else await documentApi.exportMergedDocx(title, sections, true);
    } catch (e) {
      toast.error(`Could not download ${kind === 'pdf' ? 'PDF' : 'Word'} file. Please try again.`);
    } finally {
      setExporting(null);
    }
  };

  const copyMessage = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (_) {
      toast.error('Could not copy to clipboard');
    }
  };


  return (
    // Fills the app's content area (main sidebar stays visible, like other pages).
    // -m-8 cancels MainContent's p-8 so the chat runs edge-to-edge; flex-1 takes
    // the full remaining height of the layout column.
    <div className="flex-1 min-h-0 -m-8 bg-white flex flex-col">
      {/* Header — the conversation's first question becomes the title */}
      <div className="flex items-center gap-3 px-5 pt-8 pb-2 flex-shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
          title="Back to Case Storage"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-base font-semibold text-gray-900 truncate">Ask Jurinex</h3>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="Close chat"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0 px-4 pb-14 gap-4">
        {/* Sources / History — floating card, like the reference panel */}
        <div className="w-80 flex-shrink-0 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex px-3 border-b border-gray-100 flex-shrink-0">
            <button
              onClick={() => setSidebarTab('sources')}
              className="px-3 py-3 text-sm font-semibold transition-colors"
              style={sidebarTab === 'sources'
                ? { color: TEAL_DARK, borderBottom: `3px solid ${TEAL}` }
                : { color: '#6b7280', borderBottom: '3px solid transparent' }}
            >
              Your sources ({sources.length})
            </button>
            <button
              onClick={() => setSidebarTab('history')}
              className="px-3 py-3 text-sm font-semibold transition-colors"
              style={sidebarTab === 'history'
                ? { color: TEAL_DARK, borderBottom: `3px solid ${TEAL}` }
                : { color: '#6b7280', borderBottom: '3px solid transparent' }}
            >
              History
            </button>
          </div>

          {sidebarTab === 'sources' ? (
            <div className="p-3 flex-1 overflow-y-auto min-h-0">
              {/* Add pill + info */}
              <div className="flex items-center justify-between mb-3">
                <div className="relative">
                  <button
                    onClick={() => setAddMenuOpen((o) => !o)}
                    disabled={addBusy}
                    className="flex items-center gap-1 pl-4 pr-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:brightness-95 disabled:opacity-50"
                    style={{ background: '#e6f7f5', color: TEAL_DARK }}
                  >
                    Add
                    <ChevronDown className="w-4 h-4" style={{ transform: addMenuOpen ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  {addMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />
                      <div className="absolute top-full left-0 mt-1.5 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden min-w-[220px] py-1">
                        <button
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                          onClick={() => { setAddMenuOpen(false); setPickerOpen(true); }}
                        >
                          <FolderOpen className="flex-shrink-0" style={{ color: TEAL_DARK, width: 18, height: 18 }} />
                          Add from Case Storage
                        </button>
                        <button
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                          onClick={() => { setAddMenuOpen(false); handleAddFromDrive(); }}
                        >
                          <img src={driveLogo} alt="" className="flex-shrink-0" style={{ width: 18, height: 18 }} />
                          Upload from Drive
                        </button>
                        <button
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                          onClick={() => { setAddMenuOpen(false); uploadRef.current?.click(); }}
                        >
                          <Upload className="flex-shrink-0" style={{ color: TEAL_DARK, width: 18, height: 18 }} />
                          Upload from device
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <span title="Answers are grounded in your selected sources.">
                  <Info className="w-4 h-4 text-gray-400" />
                </span>
              </div>
              {/* Source rows — toggle which files ground the next question */}
              {sources.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={s.checked}
                    onChange={() => toggleSource(s.id)}
                    className="w-4 h-4 rounded flex-shrink-0"
                    style={{ accentColor: TEAL }}
                  />
                  <FileTypeBadge name={s.name} />
                  <span className="text-sm text-gray-700 truncate">{s.name}</span>
                </label>
              ))}
              {addBusy && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Adding source…
                </div>
              )}
              {/* Hidden input for "Upload from device" */}
              <input
                ref={uploadRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tiff"
                className="hidden"
                onChange={(e) => handleDeviceFiles(e.target.files)}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
              {sessions.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No previous chats for this file.</p>
              ) : (
                <>
                  {/* Suggested = most recent session; All = everything (reference layout) */}
                  <p className="text-xs font-medium text-gray-500 px-2 pt-1 pb-1.5">Suggested</p>
                  {sessions.slice(0, 1).map((s) => (
                    <SessionRow key={`sug-${s.session_id || s.id}`} s={s} active={sessionId === (s.session_id || s.id)} onOpen={loadSession} />
                  ))}
                  <p className="text-xs font-medium text-gray-500 px-2 pt-3 pb-1.5">All</p>
                  {sessions.map((s) => (
                    <SessionRow key={s.session_id || s.id} s={s} active={sessionId === (s.session_id || s.id)} onOpen={loadSession} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* Bottom: new chat */}
          <div className="mt-auto p-3 flex-shrink-0">
            <button
              onClick={startNewChat}
              className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium text-gray-700 transition-colors hover:brightness-95"
              style={{ background: '#f1f5f9' }}
            >
              <Plus className="w-4 h-4" style={{ color: TEAL_DARK }} />
              New chat
            </button>
          </div>
        </div>

        {/* Chat pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-6 py-2">
            <div className="max-w-3xl mx-auto space-y-7">
              {historyLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: TEAL }} />
                </div>
              ) : messages.length === 0 ? (
                /* AI Overview — auto document summary, offset from the top (reference layout) */
                <div className="pt-24">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="relative inline-flex">
                        <AlignLeft className="w-5 h-5 text-gray-700" />
                        <Sparkles className="w-3 h-3 absolute -top-1 -right-1.5" style={{ color: TEAL }} />
                      </span>
                      <h4 className="text-[15px] font-semibold text-gray-900">AI Overview</h4>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setOverviewMenuOpen((o) => !o)}
                        className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        aria-label="Overview options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {overviewMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setOverviewMenuOpen(false)} />
                          <div className="absolute top-full right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden min-w-[150px]">
                            <button
                              className="w-full text-left px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2 transition-colors disabled:opacity-50"
                              disabled={overviewLoading}
                              onClick={() => { setOverviewMenuOpen(false); generateOverview(true); }}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Regenerate
                            </button>
                            <button
                              className="w-full text-left px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2 transition-colors disabled:opacity-50"
                              disabled={!overview}
                              onClick={() => { setOverviewMenuOpen(false); copyMessage(overview, 'overview'); }}
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Copy
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {overview ? (
                    <div className="text-[15px] text-gray-800 leading-relaxed formatted-assistant-markdown [&>*:first-child]:mt-0">
                      <AssistantMarkdown text={overview} />
                    </div>
                  ) : overviewLoading ? (
                    <span className="inline-flex items-center gap-2 text-gray-400 text-sm">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating overview…
                    </span>
                  ) : (
                    <p className="text-sm text-gray-400">
                      Ask any question about this document — answers come from the document itself.
                    </p>
                  )}
                </div>
              ) : (
                messages.map((m, i) => (
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div
                        className="max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-gray-800"
                        style={{ background: '#e9f6f5' }}
                      >
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={i}>
                      {/* Sparkle on its own line, then the answer full width — no bubble */}
                      <Sparkles className="w-5 h-5 mb-3" style={{ color: TEAL }} />
                      <div className="text-[15px] text-gray-800 leading-relaxed formatted-assistant-markdown [&>*:first-child]:mt-0">
                        {m.text ? (
                          <AssistantMarkdown text={m.text} />
                        ) : m.streaming ? (
                          <span className="inline-flex items-center gap-2 text-gray-400 text-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {statusText || 'Thinking…'}
                          </span>
                        ) : null}
                      </div>
                      {/* Action row under a completed answer */}
                      {m.text && !m.streaming && (
                        <div className="flex items-center gap-1 mt-3 -ml-1">
                          <button
                            onClick={() => copyMessage(m.text, i)}
                            className="flex items-center gap-1.5 text-[13px] text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            {copiedIdx === i
                              ? <Check className="w-3.5 h-3.5" style={{ color: TEAL_DARK }} />
                              : <Copy className="w-3.5 h-3.5" />}
                            {copiedIdx === i ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            onClick={() => exportMessage(m, i, 'pdf')}
                            disabled={!!exporting}
                            className="flex items-center gap-1.5 text-[13px] text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            {exporting?.idx === i && exporting?.kind === 'pdf'
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <FileDown className="w-3.5 h-3.5" />}
                            PDF
                          </button>
                          <button
                            onClick={() => exportMessage(m, i, 'word')}
                            disabled={!!exporting}
                            className="flex items-center gap-1.5 text-[13px] text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            {exporting?.idx === i && exporting?.kind === 'word'
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <FileDown className="w-3.5 h-3.5" />}
                            Word
                          </button>
                        </div>
                      )}
                    </div>
                  )
                ))
              )}
            </div>
          </div>

          {/* Composer — z-50 keeps Send clickable above the floating AI-Help FAB (z-40) */}
          <div className="px-2 sm:px-6 pb-2 pt-1 flex-shrink-0 relative z-50 bg-white">
            <div className="max-w-3xl mx-auto">
              {/* Three suggested questions above the input (reference layout) — until the chat starts */}
              {messages.length === 0 && !historyLoading && (
                <div className="mb-3">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      disabled={sending}
                      className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <CornerDownRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-[13.5px] font-medium text-gray-800">{p}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Single row: file badge · input · send — all inline */}
              <div
                className="flex items-center gap-3 border border-gray-300 rounded-3xl pl-3 pr-2 py-2 shadow-sm transition-colors focus-within:border-[#21C1B6]"
              >
                <span
                  title={checkedSources.map((s) => s.name).join(', ') || file.name}
                  className="flex items-center gap-1.5 flex-shrink-0"
                >
                  <FileTypeBadge name={checkedSources[0]?.name || file.name} />
                  {checkedSources.length > 1 && (
                    <span className="text-xs font-semibold text-gray-500">+{checkedSources.length - 1}</span>
                  )}
                </span>
                <textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Jurinex"
                  className="flex-1 resize-none bg-transparent text-[15px] text-gray-800 placeholder-gray-400 focus:outline-none max-h-32 py-1.5"
                  style={{ minHeight: 24 }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={sending || !input.trim()}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-40 flex-shrink-0"
                  style={{ background: input.trim() || sending ? TEAL : '#cbd5e1' }}
                  aria-label="Send"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4.5 h-4.5" />}
                </button>
              </div>
              <p className="text-center text-[11px] text-gray-400 mt-1">
                Jurinex AI can make mistakes. Verify important information.
              </p>
            </div>
          </div>
        </div>
      </div>

      <SourcePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={handlePickerAdd}
        existingIds={sourceIds}
      />
    </div>
  );
};

export default CaseStorageChat;
