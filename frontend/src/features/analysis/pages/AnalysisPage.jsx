import '../styles/AnalysisPage.css';
import PromptChipsBar from '@/features/chat/components/PromptChipsBar';
import { fetchSecretsList, peekSecretsList } from '@/shared/api/secretsService';
import CustomPromptBuilderModal from '@/features/chat/components/CustomPromptBuilder/CustomPromptBuilderModal';
import {
  fetchCustomPromptGroups,
  deleteCustomPrompt,
  deleteCustomPromptGroup,
} from '@/features/chat/api/customPromptsService';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useSidebar } from '@/shared/context/SidebarContext';
import { FileManagerContext } from '@/shared/context/FileManagerContext';
import DownloadPdf from '@/shared/components/DownloadPdf';
import UploadProgressPanel from '../components/UploadProgressPanel';
import ChatInputArea from '../components/ChatInputArea';
import MessagesList from '../components/MessageList';
import DocumentList from '../components/DocumentList';
import DocumentViewer from '../components/DocumentViewer';
import ProgressStagesPopup from '../components/ProgressStagesPopup';
import UploadOptionsMenu from '@/features/case-storage/components/UploadOptionsMenu';
import { convertJsonToPlainText } from '@/shared/utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '@/shared/utils/renderSecretPromptResponse';
import { formatFileSize } from '@/shared/utils/planUtils';
import { notifyResponseComplete, ensureNotificationPermission } from '@/shared/utils/responseNotifier';
import {
  getChatModelQuotaUserMessage,
  getLlmPolicyErrorUserText,
  parseLlmPolicyErrorForUi,
} from '@/shared/utils/llmQuotaMessages';
import ChatQuotaErrorModal from '@/features/billing/components/ChatQuotaErrorModal';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';
import UpgradePlanBanner from '@/features/billing/components/UpgradePlanBanner';
import MergeAnswersModal from '../components/MergeAnswersModal';
import { useLlmChatLimits } from '@/shared/hooks/useLlmChatLimits';
import { formatUploadLimitExceededMessage } from '@/shared/api/llmChatLimitsService';
import {
  API_BASE_URL,
  CHAT_MODEL_BASE_URL,
  SECRET_PROMPTS_API_BASE,
  DOCS_BASE_URL,
  getUserIdForDrafting,
} from '@/config/apiConfig';
import {
  Search,
  Send,
  FileText,
  Trash2,
  RotateCcw,
  ArrowRight,
  ChevronRight,
  AlertTriangle,
  Clock,
  Loader2,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  X,
  Eye,
  Quote,
  BookOpen,
  Copy,
  ChevronDown,
  Paperclip,
  MessageSquare,
  FileCheck,
  Bot,
  Check,
  Circle,
  CreditCard,
  Square,
  Mic,
  MicOff,
  Sparkles,
} from 'lucide-react';

const PROGRESS_STAGES = {
  INIT: { range: [0, 15], label: 'Initialization' },
  EXTRACT: { range: [15, 45], label: 'Text Extraction' },
  CHUNK: { range: [45, 62], label: 'Chunking' },
  EMBED: { range: [62, 78], label: 'Embeddings' },
  STORE: { range: [78, 90], label: 'Database Storage' },
  SUMMARY: { range: [90, 95], label: 'Summary Generation' },
  FINAL: { range: [95, 100], label: 'Finalization' },
};

const STAGE_COLORS = {
  INIT: 'from-blue-200 to-blue-400',
  EXTRACT: 'from-blue-300 to-blue-500',
  CHUNK: 'from-blue-400 to-blue-600',
  EMBED: 'from-blue-500 to-blue-700',
  STORE: 'from-blue-600 to-blue-800',
  SUMMARY: 'from-blue-700 to-blue-900',
  FINAL: 'from-blue-800 to-blue-950',
};

const getCurrentStage = (progress) => {
  for (const [key, stage] of Object.entries(PROGRESS_STAGES)) {
    if (progress >= stage.range[0] && progress < stage.range[1]) {
      return key;
    }
  }
  return 'FINAL';
};

const getStageColor = (progress) => {
  const stageKey = getCurrentStage(progress);
  return STAGE_COLORS[stageKey] || 'from-blue-500 to-blue-700';
};

const getStageStatus = (stageKey, progress) => {
  const stage = PROGRESS_STAGES[stageKey];
  if (progress >= stage.range[1]) return 'completed';
  if (progress >= stage.range[0] && progress < stage.range[1]) return 'active';
  return 'pending';
};

/** Map folder API file to the shape expected by DocumentList (matches FolderContent fields). */
const normalizeApiFileToUploadedDoc = (file) => {
  const id = file?.id || file?._id;
  if (!id) return null;
  return {
    id,
    fileName:
      file.originalname ||
      file.name ||
      file.filename ||
      file.original_name ||
      'Unnamed Document',
    fileSize: file.size || file.fileSize || 0,
    uploadedAt:
      file.created_at ||
      file.createdAt ||
      file.uploadedAt ||
      new Date().toISOString(),
    status: file.status || file.processing_status || 'unknown',
    processingProgress: parseFloat(file.processing_progress || file.progress || 0),
    currentOperation: file.current_operation || file.message || '',
    chunkCount: file.chunk_count,
    mimetype: file.mimetype || file.mimeType || file.type,
  };
};

/** Keep optimistic in-flight rows if the server list has not caught up yet. */
const mergeUploadedWithServer = (prev, serverDocs) => {
  const byId = new Map();
  for (const d of serverDocs) {
    if (d?.id) byId.set(d.id, d);
  }
  for (const p of prev) {
    if (!p?.id) continue;
    if (byId.has(p.id)) continue;
    const transient = ['uploading', 'pending', 'batch_processing', 'processing', 'queued'].includes(p.status);
    if (transient) byId.set(p.id, p);
  }
  return Array.from(byId.values());
};

const RealTimeProgressPanel = ({ processingStatus }) => {
  if (!processingStatus || !['processing', 'batch_processing', 'error'].includes(processingStatus.status)) return null;

  const progress = processingStatus.processing_progress || 0;
  const isError = processingStatus.status === 'error';
  const isBatch = processingStatus.status === 'batch_processing';

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getSubProgress = () => {
    if (processingStatus.embeddings_generated !== undefined && processingStatus.embeddings_total !== undefined) {
      return `${processingStatus.embeddings_generated}/${processingStatus.embeddings_total} embeddings`;
    }
    if (processingStatus.chunks_saved !== undefined) {
      return `${processingStatus.chunks_saved} chunks saved`;
    }
    if (processingStatus.estimated_pages !== undefined) {
      return `Estimated ${processingStatus.estimated_pages} pages`;
    }
    return null;
  };

  const subProgress = getSubProgress();

  return (
    <div className="fixed top-4 left-1/2 z-50 transform -translate-x-1/2">
      <div
        className={`bg-white rounded-lg shadow-xl p-4 w-80 border-2 max-w-sm transition-all duration-300 ${
          isError
            ? 'border-red-200 animate-pulse'
            : isBatch
            ? 'border-yellow-200'
            : 'border-blue-200'
        }`}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-semibold text-gray-900 flex items-center">
            {isError ? (
              <AlertTriangle className="h-4 w-4 text-red-500 mr-1.5 animate-pulse" />
            ) : isBatch ? (
              <FileText className="h-4 w-4 text-yellow-500 mr-1.5" />
            ) : (
              <Loader2 className="h-4 w-4 text-blue-500 mr-1.5 animate-spin" />
            )}
            {isError ? 'Processing Error' : isBatch ? 'Batch Processing' : 'Document Processing'}
          </h3>
        </div>
        {isError ? (
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3 animate-pulse" />
            <p className="text-red-700 text-xs mb-3 font-medium">
              {(typeof processingStatus.job_error === 'string' ? processingStatus.job_error : null) || 'An error occurred during processing'}
            </p>
            <p className="text-xs text-gray-500">Last updated: {formatDate(processingStatus.last_updated)}</p>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                <span>Progress</span>
                <span className="font-semibold text-blue-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden relative">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ease-out relative overflow-hidden bg-gradient-to-r ${getStageColor(
                    progress
                  )}`}
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <p className="text-xs text-gray-700 font-medium bg-blue-50 p-1.5 rounded text-blue-800 break-words">
                {processingStatus.current_operation || 'Processing document...'}
              </p>
              {subProgress && (
                <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">{subProgress}</p>
              )}
            </div>
            <div className="space-y-1.5 mb-3">
              {Object.entries(PROGRESS_STAGES).map(([key, { label }]) => {
                const status = getStageStatus(key, progress);
                return (
                  <div
                    key={key}
                    className={`flex items-center space-x-2 py-0.5 transition-all duration-300 ${
                      status === 'completed'
                        ? 'opacity-100'
                        : status === 'active'
                        ? 'opacity-100'
                        : 'opacity-50'
                    }`}
                  >
                    {status === 'completed' ? (
                      <Check className="h-3 w-3 text-green-500 animate-pulse" />
                    ) : status === 'active' ? (
                      <Loader2 className="h-3 w-3 text-[#21C1B6] animate-spin" />
                    ) : (
                      <Circle className="h-3 w-3 text-gray-300" />
                    )}
                    <span
                      className={`text-xs font-medium transition-colors ${
                        status === 'completed'
                          ? 'text-green-600'
                          : status === 'active'
                          ? 'text-[#21C1B6] font-semibold'
                          : 'text-gray-400'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
            {processingStatus.chunk_count > 0 && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <FileText className="h-3 w-3 mr-1 text-gray-500" />
                {processingStatus.chunk_count} chunks created
              </p>
            )}
            {processingStatus.chunking_method && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <BookOpen className="h-3 w-3 mr-1 text-gray-500" />
                Method: {processingStatus.chunking_method}
              </p>
            )}
            <p className="text-xs text-gray-400 flex items-center">
              <Clock className="h-3 w-3 mr-1" />
              Last updated: {formatDate(processingStatus.last_updated)}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const AnalysisPage = () => {
  const location = useLocation();
  const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
  const { setIsSidebarHidden, setIsSidebarCollapsed } = useSidebar();
  const navigate = useNavigate();

  const { maxUploadBytes, maxUploadMbLabel, loading: limitsLoading, error: limitsError } = useLlmChatLimits();
  const { showQuotaError } = useTokenQuota();

  // Get the currently selected case folder so uploads land in the right place
  const { selectedFolder, setDocuments, loadFoldersAndFiles } = React.useContext(FileManagerContext) || {};
  const activeFolderName = typeof selectedFolder === 'string'
    ? selectedFolder
    : (selectedFolder?.originalname || selectedFolder?.name || null);

  const [activeDropdown, setActiveDropdown] = useState('Custom Query');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [fileSizeLimitError, setFileSizeLimitError] = useState(null);

  const [documentData, setDocumentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [showProgressPopup, setShowProgressPopup] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState('');
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [customPromptGroups, setCustomPromptGroups] = useState([]);
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);
  const [showSplitView, setShowSplitView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showAllChats, setShowAllChats] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [learningModeActive, setLearningModeActive] = useState(false);

  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);

  const [batchUploads, setBatchUploads] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const prevFolderForSidebarRef = useRef(null);

  // After upload: merge with server. DocumentList reads uploadedDocuments, not context.documents.
  const refreshFileList = useCallback(() => {
    if (!activeFolderName) return;
    import('@/shared/api/documentApi').then(({ default: documentApi }) => {
      documentApi
        .getDocumentsInFolder(activeFolderName)
        .then((data) => {
          let filesList = [];
          if (Array.isArray(data)) filesList = data;
          else if (data?.files) filesList = data.files;
          else if (data?.documents) filesList = data.documents;
          else if (data?.data) filesList = data.data;
          const normalized = filesList.map(normalizeApiFileToUploadedDoc).filter(Boolean);
          if (setDocuments) setDocuments(filesList);
          setUploadedDocuments((prev) => mergeUploadedWithServer(prev, normalized));
        })
        .catch(() => {});
    });
  }, [activeFolderName, setDocuments]);

  useEffect(() => {
    if (!activeFolderName) {
      prevFolderForSidebarRef.current = null;
      return;
    }
    const folderChanged = prevFolderForSidebarRef.current !== activeFolderName;
    prevFolderForSidebarRef.current = activeFolderName;
    let cancelled = false;
    import('@/shared/api/documentApi').then(({ default: documentApi }) => {
      documentApi
        .getDocumentsInFolder(activeFolderName)
        .then((data) => {
          if (cancelled) return;
          let filesList = [];
          if (Array.isArray(data)) filesList = data;
          else if (data?.files) filesList = data.files;
          else if (data?.documents) filesList = data.documents;
          else if (data?.data) filesList = data.data;
          const normalized = filesList.map(normalizeApiFileToUploadedDoc).filter(Boolean);
          if (setDocuments) setDocuments(filesList);
          if (folderChanged) {
            setUploadedDocuments(normalized);
          } else {
            setUploadedDocuments((prev) => mergeUploadedWithServer(prev, normalized));
          }
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [activeFolderName, setDocuments]);

  const [overallUploadProgress, setOverallUploadProgress] = useState(0);
  const [overallBatchProcessingProgress, setOverallBatchProcessingProgress] = useState(0);
  const [activePollingFiles, setActivePollingFiles] = useState(new Set());
  const [showInsufficientFundsAlert, setShowInsufficientFundsAlert] = useState(false);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const styleDropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const animationFrameRef = useRef(null);
  const uploadIntervalRef = useRef(null);
  const batchPollingIntervalsRef = useRef({});
  const simulatedProgressIntervalsRef = useRef({});
  const streamBufferRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const streamPaintFrameRef = useRef(null);
  const [isStopped, setIsStopped] = useState(false);
  const currentRequestIdRef = useRef(null);
  
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // Speech recognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => setIsListening(true);
      recognitionInstance.onend = () => setIsListening(false);
      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        
        // Reset secret prompt if voice input is given
        if (isSecretPromptSelected) {
          setIsSecretPromptSelected(false);
          setActiveDropdown("Custom Query");
          setSelectedSecretId(null);
        }
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [isSecretPromptSelected]);

  const toggleListening = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };
  
  useEffect(() => {
    if (selectedMessageId && messages.length > 0 && currentResponse) {
      const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawAnswer = selectedMessage.answer || selectedMessage.response || '';
        const isSecretPrompt = selectedMessage.used_secret_prompt || false;
        const isCurrentResponseRawJson = isStructuredJsonResponse(currentResponse);
        const isRawAnswerStructured = isStructuredJsonResponse(rawAnswer);
        
        if (isSecretPrompt && isRawAnswerStructured && (isCurrentResponseRawJson || currentResponse === rawAnswer)) {
          const formattedResponse = renderSecretPromptResponse(rawAnswer);
          if (formattedResponse !== currentResponse) {
            setCurrentResponse(formattedResponse);
            setAnimatedResponseContent(formattedResponse);
          }
        }
      }
    }
  }, [selectedMessageId, messages, currentResponse]);


  const getAuthToken = () => {
    const tokenKeys = [
      'authToken',
      'token',
      'accessToken',
      'jwt',
      'bearerToken',
      'auth_token',
      'access_token',
      'api_token',
      'userToken',
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  /** Agentic service uses `/{folder}/intelligent-chat/stream` (DOCS_BASE_URL), not gateway `/files/chat/stream`. */
  const getIntelligentChatStreamHeaders = () => {
    const token = getAuthToken();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      Accept: 'text/event-stream',
    };
    const uid = getUserIdForDrafting();
    if (uid) headers['X-User-Id'] = uid;
    return headers;
  };

  const apiRequest = async (url, options = {}) => {
    try {
      const token = getAuthToken();
      const defaultHeaders = { 'Content-Type': 'application/json' };
      if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
      }
      const headers =
        options.body instanceof FormData
          ? token
            ? { 'Authorization': `Bearer ${token}` }
            : {}
          : { ...defaultHeaders, ...options.headers };
      const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP error! status: ${response.status}` };
        }
        const serverMsg = (errorData.detail && typeof errorData.detail === 'object'
          ? errorData.detail.message
          : typeof errorData.detail === 'string' ? errorData.detail : null)
          || errorData.message || errorData.error || null;
        switch (response.status) {
          case 401:
            throw new Error('Authentication required. Please log in again.');
          case 403:
            throw new Error(serverMsg || 'Access denied.');
          case 404:
            throw new Error('Resource not found.');
          case 413:
            throw new Error(serverMsg || 'File too large or exceeds page limit.');
          case 415:
            throw new Error('Unsupported file type.');
          case 429: {
            const quotaDisplay = parseLlmPolicyErrorForUi(429, errorData);
            const err = new Error(quotaDisplay.body);
            err.quotaDisplay = quotaDisplay;
            err.code = errorData?.detail?.code || errorData?.code;
            err.isQuotaError = true;
            err.details = errorData?.detail?.details || errorData?.details || {};
            throw err;
          }
          default:
            throw new Error(serverMsg || `Request failed with status ${response.status}`);
        }
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return response;
    } catch (error) {
      throw error;
    }
  };

  const loadCustomPromptGroups = useCallback(async () => {
    try {
      const groups = await fetchCustomPromptGroups();
      setCustomPromptGroups(Array.isArray(groups) ? groups : []);
    } catch {
      /* custom prompts are optional — keep the current list on failure */
    }
  }, []);

  const handleDeleteCustomPrompt = useCallback(async (prompt) => {
    if (!window.confirm(`Delete the prompt "${prompt.name}"?`)) return;
    try {
      await deleteCustomPrompt(prompt.id);
      await loadCustomPromptGroups();
    } catch (err) {
      setError(err?.message || 'Failed to delete the prompt.');
    }
  }, [loadCustomPromptGroups]);

  const handleDeleteCustomGroup = useCallback(async (group) => {
    const count = group.prompts?.length ?? 0;
    const warning = count
      ? `Delete the group "${group.name}" and the ${count} prompt(s) inside it?`
      : `Delete the empty group "${group.name}"?`;
    if (!window.confirm(warning)) return;
    try {
      await deleteCustomPromptGroup(group.id);
      await loadCustomPromptGroups();
    } catch (err) {
      setError(err?.message || 'Failed to delete the group.');
    }
  }, [loadCustomPromptGroups]);

  // Clicking a saved custom prompt runs it straight away. The thread shows only
  // the prompt's name — the body is sent to the model but never displayed,
  // matching how preset prompts behave.
  // Deliberately not memoized: it must call the current render's handleSend so
  // the send picks up the live fileId / sessionId.
  const handleCustomPromptSelect = (prompt) => {
    if (!prompt?.prompt_text || isLoading || isGeneratingInsights) return;
    void handleSend({ preventDefault: () => {} }, null, prompt);
  };

  const loadSecrets = async () => {
    const cached = peekSecretsList();
    if (cached?.length) setSecrets(cached);
    if (!cached?.length) setIsLoadingSecrets(true);
    try {
      setError(null);
      const secretsData = await fetchSecretsList();
      setSecrets(secretsData || []);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
    } catch (error) {
      console.error('Error fetching secrets:', error);
      setError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  const getProcessingStatus = async (file_id) => {
    try {
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`${DOCS_BASE_URL}/status/${file_id}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        console.error(`[getProcessingStatus] Status check failed for ${file_id}: ${response.status}`);
        return null;
      }
      const data = await response.json();
      console.log(`[getProcessingStatus] File ${file_id} status:`, data.status, 'progress:', data.processing_progress, 'operation:', data.current_operation);
      if (file_id === fileId) {
        const newProgress = data.processing_progress || 0;
        const isCompleted = data.status === 'processed' || data.status === 'completed';
        const isFailed = data.status === 'error' || data.status === 'failed';
       
        setProgressPercentage((currentProgress) => {
          if (newProgress > currentProgress || isCompleted || isFailed || newProgress === 0) {
            return newProgress;
          }
          console.log(`[getProcessingStatus] Skipping backwards progress for main file: ${newProgress}% <= ${currentProgress}%`);
          return currentProgress;
        });
       
        setProcessingStatus(data);
      }
      setUploadedDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id === file_id) {
            const currentProgress = doc.processingProgress || 0;
            const newProgress = data.processing_progress || 0;
            const isCompleted = data.status === 'processed' || data.status === 'completed';
            const isFailed = data.status === 'error' || data.status === 'failed';
           
            const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
            if (!shouldUpdate && data.status === doc.status) {
              console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
              return doc;
            }
           
            return {
              ...doc,
              status: data.status,
              processingProgress: newProgress,
              currentOperation: data.current_operation,
              chunkCount: data.chunk_count,
              lastUpdated: data.last_updated,
              embeddingsGenerated: data.embeddings_generated,
              embeddingsTotal: data.embeddings_total,
              chunksSaved: data.chunks_saved,
              estimatedPages: data.estimated_pages,
              chunkingMethod: data.chunking_method,
              jobError: data.job_error,
            };
          }
          return doc;
        })
      );
      setBatchUploads((prev) =>
        prev.map((upload) => {
          if (upload.fileId === file_id) {
            const currentProgress = upload.processingProgress || 0;
            const newProgress = data.processing_progress || 0;
            const isCompleted = data.status === 'processed' || data.status === 'completed';
            const isFailed = data.status === 'error' || data.status === 'failed';
           
            const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
            if (!shouldUpdate && data.status === upload.status) {
              console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
              return upload;
            }
           
            return {
              ...upload,
              status: data.status,
              processingProgress: newProgress,
              currentOperation: data.current_operation,
              chunkCount: data.chunk_count,
              lastUpdated: data.last_updated,
              embeddingsGenerated: data.embeddings_generated,
              embeddingsTotal: data.embeddings_total,
              chunksSaved: data.chunks_saved,
              estimatedPages: data.estimated_pages,
              chunkingMethod: data.chunking_method,
              jobError: data.job_error,
            };
          }
          return upload;
        })
      );
      if (data.status === 'processed') {
        console.log(`[getProcessingStatus] File ${file_id} completed processing`);
        if (batchPollingIntervalsRef.current[file_id]) {
          clearInterval(batchPollingIntervalsRef.current[file_id]);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
        if (file_id === fileId && pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setSuccess('Document processing completed!');
      } else if (data.status === 'error') {
        console.error(`[getProcessingStatus] File ${file_id} processing failed:`, data.job_error);
        setError((typeof data.job_error === 'string' ? data.job_error : null) || `Document processing failed for ${data.filename}`);
        if (batchPollingIntervalsRef.current[file_id]) {
          clearInterval(batchPollingIntervalsRef.current[file_id]);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
        if (file_id === fileId && pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
      return data;
    } catch (error) {
      console.error(`[getProcessingStatus] Error getting status for ${file_id}:`, error);
      return null;
    }
  };

  const startProcessingStatusPolling = (file_id) => {
    console.log(`[startProcessingStatusPolling] Starting 1s polling for file: ${file_id}`);
    if (pollingIntervalRef.current && file_id === fileId) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    const pollInterval = 1000;
    const intervalId = setInterval(async () => {
      const status = await getProcessingStatus(file_id);
      if (status && (status.status === 'processed' || status.status === 'error')) {
        clearInterval(intervalId);
        if (file_id === fileId) {
          pollingIntervalRef.current = null;
        }
      }
    }, pollInterval);
    if (file_id === fileId) {
      pollingIntervalRef.current = intervalId;
    }
  };

  const startBatchProcessingPolling = (fileIds) => {
    console.log(`[startBatchProcessingPolling] Starting 1s batch polling for ${fileIds.length} files`);
    fileIds.forEach((file_id) => {
      if (batchPollingIntervalsRef.current[file_id]) return;
      setActivePollingFiles((prev) => new Set([...prev, file_id]));
      const pollInterval = 1000;
      const intervalId = setInterval(async () => {
        const status = await getProcessingStatus(file_id);
        if (status && (status.status === 'processed' || status.status === 'error')) {
          clearInterval(intervalId);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
      }, pollInterval);
      batchPollingIntervalsRef.current[file_id] = intervalId;
    });
  };

  const batchUploadDocuments = async (files, secretId = null, llmName = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
   
    console.log(`[batchUploadDocuments] 🚀 Starting batch upload for ${files.length} files`);
    console.log(`[batchUploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[batchUploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);
   
    setIsUploading(true);
    setError(null);
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
   
    const initialBatchUploads = files.map((file, index) => {
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      console.log(`[batchUploadDocuments] 📄 File ${index + 1}: ${file.name} (${fileSizeMB}MB) - ${isLarge ? '🔴 LARGE (will use signed URL)' : '🟢 Small (regular upload)'}`);
      return {
        id: `${file.name}-${Date.now()}-${index}`,
        file: file,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        status: 'pending',
        fileId: null,
        error: null,
        processingProgress: 0,
        isLargeFile: isLarge,
      };
    });
    setBatchUploads(initialBatchUploads);
    setShowSplitView(true);
   
    try {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
     
      const largeFiles = files.filter(f => f.size > LARGE_FILE_THRESHOLD);
      const smallFiles = files.filter(f => f.size <= LARGE_FILE_THRESHOLD);
      const uploadedFileIds = [];
     
      console.log(`[batchUploadDocuments] 📊 Summary: ${largeFiles.length} large file(s) (signed URL), ${smallFiles.length} small file(s) (regular upload)`);
     
      for (let i = 0; i < largeFiles.length; i++) {
        const file = largeFiles[i];
        const matchingUpload = initialBatchUploads.find(u => u.file === file);
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
       
        try {
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'uploading', progress: 10 }
                : upload
            )
          );
         
          const generateUrlEndpoint = activeFolderName
            ? `${DOCS_BASE_URL}/${encodeURIComponent(activeFolderName)}/generate-upload-url`
            : `${DOCS_BASE_URL}/generate-upload-url`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
         
          const urlResponse = await fetch(generateUrlEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: file.name,
              mimetype: file.type,
              size: file.size,
            }),
          });
         
          if (!urlResponse.ok) {
            const errorData = await urlResponse.json().catch(() => ({}));
            const errorMessage = errorData.error || errorData.message || `Failed to get upload URL: ${urlResponse.statusText}`;
           
            const isSubscriptionError = urlResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const urlData = await urlResponse.json();
          const { signedUrl, gcsPath, filename } = urlData;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
          console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
          console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, progress: 30 }
                : upload
            )
          );
         
          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
         
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
           
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                const mappedProgress = 30 + Math.round((percentComplete / 100) * 40);
                setBatchUploads((prev) =>
                  prev.map((upload) =>
                    upload.id === matchingUpload.id
                      ? { ...upload, progress: mappedProgress }
                      : upload
                  )
                );
              }
            });
           
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);
                setBatchUploads((prev) =>
                  prev.map((upload) =>
                    upload.id === matchingUpload.id
                      ? { ...upload, progress: 70 }
                      : upload
                  )
                );
                resolve();
              } else {
                reject(new Error(`Failed to upload file to GCS: ${xhr.statusText}`));
              }
            });
           
            xhr.addEventListener('error', () => {
              reject(new Error('Network error during upload'));
            });
           
            xhr.addEventListener('abort', () => {
              reject(new Error('Upload aborted'));
            });
           
            xhr.open('PUT', signedUrl);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });
         
          const completeEndpoint = activeFolderName
            ? `${DOCS_BASE_URL}/${encodeURIComponent(activeFolderName)}/complete-upload`
            : `${DOCS_BASE_URL}/complete-upload`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
         
          const completeResponse = await fetch(completeEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              gcsPath,
              filename,
              mimetype: file.type,
              size: file.size,
              secret_id: secretId,
            }),
          });
         
          if (!completeResponse.ok) {
            const errorData = await completeResponse.json();
            const errorMessage = errorData.error || errorData.message || `Failed to complete upload: ${completeResponse.statusText}`;
           
            const isSubscriptionError = completeResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const completeData = await completeResponse.json();
          const fileId = completeData.file_id;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully! File ID: ${fileId}`);
          console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
                : upload
            )
          );
         
          setUploadedDocuments((prev) => [
            ...prev,
            {
              id: fileId,
              fileName: filename || matchingUpload.fileName,
              fileSize: matchingUpload.fileSize,
              uploadedAt: new Date().toISOString(),
              status: 'batch_processing',
              processingProgress: 0,
            },
          ]);
         
          uploadedFileIds.push(fileId);
         
          if (i === 0 && largeFiles.length > 0) {
            setFileId(fileId);
            setDocumentData({
              id: fileId,
              title: matchingUpload.fileName,
              originalName: matchingUpload.fileName,
              size: matchingUpload.fileSize,
              type: matchingUpload.file.type,
              uploadedAt: new Date().toISOString(),
              status: 'batch_processing',
              processingProgress: 0,
            });
            startProcessingStatusPolling(fileId);
            // Refresh the Files panel immediately after each large file is registered
            refreshFileList();
          }
        } catch (error) {
          console.error(`[📤 SIGNED URL UPLOAD] ❌ Upload failed for ${matchingUpload.fileName}:`, error);
          console.error(`[📤 SIGNED URL UPLOAD] Error details:`, error.message);
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'failed', error: error.message, progress: 0 }
                : upload
            )
          );
        }
      }
     
      if (smallFiles.length > 0) {
        const smallUploadEndpoint = activeFolderName
          ? `${DOCS_BASE_URL}/${encodeURIComponent(activeFolderName)}/upload`
          : `${API_BASE_URL}/files/batch-upload`;
        console.log(`\n[📦 REGULAR UPLOAD] Starting batch upload for ${smallFiles.length} small file(s)`);
        console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
        console.log(`[📦 REGULAR UPLOAD] Endpoint: ${smallUploadEndpoint}`);
       
        const formData = new FormData();
        // Folder-specific endpoint expects 'files'; gateway batch-upload expects 'document'
        const fileFieldName = activeFolderName ? 'files' : 'document';
        smallFiles.forEach((file) => {
          formData.append(fileFieldName, file);
        });
        if (secretId) {
          formData.append('secret_id', secretId);
          formData.append('trigger_initial_analysis_with_secret', 'true');
        }
        if (llmName) {
          formData.append('llm_name', llmName);
        }
       
        setBatchUploads((prev) =>
          prev.map((upload) => {
            const isSmallFile = smallFiles.includes(upload.file);
            return isSmallFile ? { ...upload, status: 'uploading', progress: 0 } : upload;
          })
        );
       
        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
         
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percentComplete = Math.round((e.loaded / e.total) * 100);
              setBatchUploads((prev) =>
                prev.map((upload) => {
                  const isSmallFile = smallFiles.includes(upload.file);
                  return isSmallFile
                    ? { ...upload, progress: percentComplete }
                    : upload;
                })
              );
            }
          });
         
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const responseData = JSON.parse(xhr.responseText);
                setBatchUploads((prev) =>
                  prev.map((upload) => {
                    const isSmallFile = smallFiles.includes(upload.file);
                    return isSmallFile
                      ? { ...upload, progress: 100 }
                      : upload;
                  })
                );
                resolve(responseData);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                const errorMessage = errorData.error || errorData.message || '';
                const isSubscriptionError = xhr.status === 500 ||
                  errorMessage.toLowerCase().includes('subscription') ||
                  errorMessage.toLowerCase().includes('insufficient') ||
                  errorMessage.toLowerCase().includes('no plan') ||
                  errorMessage.toLowerCase().includes('plan required');
               
                if (isSubscriptionError) {
                  const error = new Error(errorMessage || 'Subscription required');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(errorMessage || `Upload failed with status ${xhr.status}`));
                }
              } catch {
                if (xhr.status === 500) {
                  const error = new Error('Subscription required to upload files');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(`Upload failed with status ${xhr.status}`));
                }
              }
            }
          });
         
          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
          });
         
          xhr.addEventListener('abort', () => {
            reject(new Error('Upload aborted'));
          });
         
          xhr.open('POST', smallUploadEndpoint);
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
          xhr.send(formData);
        });
        console.log('[batchUploadDocuments] Batch upload response:', data);

        // Normalize response: gateway returns { uploaded_files: [...] },
        // folder-specific endpoint returns { uploadedFiles: [...] }
        const rawList = data.uploaded_files || data.uploadedFiles || [];
        const normalizedFiles = rawList.map((f) => ({
          file_id: f.file_id || f.metadata?.db_file_id || null,
          filename: f.filename || f.document_name || f.name || null,
          error: f.error || null,
          operation_name: f.operation_name || null,
        }));

        if (normalizedFiles.length > 0) {
          normalizedFiles.forEach((uploadedFile, index) => {
            const matchingUpload = initialBatchUploads.find(u => smallFiles.includes(u.file) &&
              initialBatchUploads.filter(up => smallFiles.includes(up.file)).indexOf(u) === index);

            if (!matchingUpload) return;

            if (uploadedFile.error) {
              console.error(`[batchUploadDocuments] Upload failed for ${matchingUpload.fileName}:`, uploadedFile.error);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'failed', error: uploadedFile.error, progress: 0 }
                    : upload
                )
              );
            } else {
              const fileId = uploadedFile.file_id;
              console.log(`[batchUploadDocuments] Successfully uploaded ${matchingUpload.fileName} with ID: ${fileId}`);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
                    : upload
                )
              );
              setUploadedDocuments((prev) => [
                ...prev,
                {
                  id: fileId,
                  fileName: uploadedFile.filename || matchingUpload.fileName,
                  fileSize: matchingUpload.fileSize,
                  uploadedAt: new Date().toISOString(),
                  status: 'batch_processing',
                  operationName: uploadedFile.operation_name,
                  processingProgress: 0,
                },
              ]);
              if (fileId) uploadedFileIds.push(fileId);

              if (uploadedFileIds.length === largeFiles.length + 1) {
                setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                  status: 'batch_processing',
                  processingProgress: 0,
                });
                startProcessingStatusPolling(fileId);
              }
            }
          });
        }
      }
     
      if (uploadedFileIds.length > 0) {
        startBatchProcessingPolling(uploadedFileIds);
        // Refresh the Files panel so the newly uploaded file appears immediately
        refreshFileList();
      }

      const successCount = uploadedFileIds.length;
      const failCount = initialBatchUploads.length - successCount;
     
      if (successCount > 0) {
        setSuccess(`${successCount} document(s) uploaded successfully! Processing...`);
      }
      if (failCount > 0) {
        setError(`${failCount} document(s) failed to upload.`);
      }
    } catch (error) {
      console.error('[batchUploadDocuments] Batch upload error:', error);
     
      if (error.isSubscriptionError) {
        setShowInsufficientFundsAlert(true);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: 'Subscription required' }))
        );
      } else {
        setError(`Batch upload failed: ${error.message}`);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: error.message }))
        );
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Paint the live SSE stream buffer at most once per animation frame.
  // ChatResponsePanel renders it block-by-block with memoized blocks, so each
  // paint only re-parses the growing tail block — no whole-document work.
  const paintStreamingResponse = () => {
    if (streamPaintFrameRef.current) return;
    streamPaintFrameRef.current = requestAnimationFrame(() => {
      streamPaintFrameRef.current = null;
      setIsAnimatingResponse(true);
      setShowSplitView(true);
      setAnimatedResponseContent(streamBufferRef.current);
    });
  };

  const cancelStreamPaint = () => {
    if (streamPaintFrameRef.current) {
      cancelAnimationFrame(streamPaintFrameRef.current);
      streamPaintFrameRef.current = null;
    }
  };

  // Final display: the answer streamed live already, so show the complete
  // formatted text in a single paint (no replay animation).
  const animateResponse = (text = '', isAlreadyFormatted = false) => {
    cancelStreamPaint();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);
    setAnimatedResponseContent(typeof plainText === 'string' ? plainText : plainText || '');
    setIsAnimatingResponse(false);
    setShowSplitView(true);
    requestAnimationFrame(() => {
      if (responseRef.current) {
        responseRef.current.scrollTop = responseRef.current.scrollHeight;
      }
    });
  };

  const showResponseImmediately = (text = '') => {
    const plainText = convertJsonToPlainText(text);

    cancelStreamPaint();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    console.log('[showResponseImmediately] Displaying text immediately. Length:', plainText.length);
    setAnimatedResponseContent(plainText);
    setIsAnimatingResponse(false);
    setShowSplitView(true);
    requestAnimationFrame(() => {
      if (responseRef.current) {
        responseRef.current.scrollTop = responseRef.current.scrollHeight;
      }
    });
  };

  const stopResponseAnimation = () => {
    if (!isAnimatingResponse) return;
    const fullText = currentResponse || animatedResponseContent || '';
    showResponseImmediately(fullText);
  };

  const stopGeneration = async () => {
    setIsStopped(true);
    setIsLoading(false);
    setIsGeneratingInsights(false);
    
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
        console.warn('[stopGeneration] Error canceling stream:', e);
      }
      streamReaderRef.current = null;
    }
    
    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }
    
    if (streamBufferRef.current) {
      const finalResponse = streamBufferRef.current;
      const isStructured = isStructuredJsonResponse(finalResponse);
      const responseToDisplay = isStructured 
        ? renderSecretPromptResponse(finalResponse) 
        : convertJsonToPlainText(finalResponse);
      setCurrentResponse(responseToDisplay);
      animateResponse(responseToDisplay, isStructured);
    }
    
    setSuccess('Generation stopped.');
  };

  const baseSendDisabled =
    isLoading ||
    isGeneratingInsights ||
    (!chatInput.trim() && !isSecretPromptSelected);

  const isGenerating = isLoading || isGeneratingInsights;
  const sendButtonType = (isAnimatingResponse || isGenerating) ? 'button' : 'submit';
  const isSendButtonDisabled = (isAnimatingResponse || isGenerating) ? false : baseSendDisabled;
  const sendButtonTitle = isGenerating ? 'Stop Generation' : (isAnimatingResponse ? 'Stop rendering' : 'Send Message');

  const handleSendButtonClick = (event) => {
    if (isGenerating) {
      event.preventDefault();
      stopGeneration();
    } else if (isAnimatingResponse) {
      event.preventDefault();
      stopResponseAnimation();
    }
  };

  const getSendButtonClassName = (size = 'default') => {
    const paddingClass = size === 'small' ? 'p-1.5' : 'p-1.5 sm:p-2';
    const colorClass = (isAnimatingResponse || isGenerating)
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300';
    return `${paddingClass} text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed ${colorClass}`;
  };

  const renderSendButtonIcon = (size = 'default') => {
    const baseClass = size === 'small' ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5';
    if (isGenerating) {
      return <Square className={`${baseClass} fill-current`} />;
    }
    if (isAnimatingResponse) {
      return <Square className={baseClass} />;
    }
    return <Send className={baseClass} />;
  };

  const chatWithDocument = async (file_id, question, currentSessionId, llm_name = null, displayLabel = null) => {
    // Create message BEFORE streaming starts with a unique ID
    const messageId = Date.now();
    const questionText = question.trim();

    // Create placeholder message immediately
    const placeholderChat = {
      id: messageId,
      file_id: file_id,
      session_id: currentSessionId,
      question: questionText,
      answer: '', // Will be updated when streaming completes
      // Custom prompts are shown by name only — the body goes to the model but
      // is never displayed, matching how preset prompts behave.
      display_text_left_panel: displayLabel || questionText,
      timestamp: new Date().toISOString(),
      used_chunk_ids: [],
      confidence: 0.8,
      type: 'chat',
      used_secret_prompt: false,
      isStreaming: true,
    };
    
    // Add placeholder message immediately
    setMessages((prev) => [...prev, placeholderChat]);
    setSelectedMessageId(messageId);
    setCurrentResponse('');
    setAnimatedResponseContent('');
    
    // Use a local buffer for this specific stream instead of shared ref
    let localStreamBuffer = '';
    streamBufferRef.current = '';
    setError(null);
    ensureNotificationPermission();
    setIsLoading(true);
    setIsAnimatingResponse(false);
    
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
      }
      streamReaderRef.current = null;
    }
    
    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }

    try {
      console.log('[chatWithDocument] Sending custom query with streaming. LLM:', llm_name || 'default (backend)');
      const useFolderChat = Boolean(activeFolderName);
      const streamUrl = useFolderChat
        ? `${DOCS_BASE_URL}/${encodeURIComponent(activeFolderName)}/intelligent-chat/stream`
        : `${API_BASE_URL}/files/chat/stream`;
      const body = useFolderChat
        ? {
            question: questionText,
            // Custom prompts send their name so the thread and history show the
            // label instead of the prompt body.
            ...(displayLabel ? { prompt_label: displayLabel } : {}),
            session_id: currentSessionId,
            llm_name: llm_name || 'gemini',
          }
        : {
            file_id: file_id,
            question: questionText,
            used_secret_prompt: false,
            prompt_label: displayLabel || null,
            session_id: currentSessionId,
            ...(llm_name ? { llm_name } : {}),
          };

      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: getIntelligentChatStreamHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorData = {};
        try { errorData = await response.json(); } catch {}
        if (response.status === 429 || response.status === 503) {
          const quotaDisplay = parseLlmPolicyErrorForUi(response.status, errorData);
          const err = new Error(quotaDisplay.body);
          err.quotaDisplay = quotaDisplay;
          throw err;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let newSessionId = currentSessionId;
      let finalMetadata = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (isStopped) {
            setIsLoading(false);
            if (localStreamBuffer) {
              const plainTextResponse = convertJsonToPlainText(localStreamBuffer);
              // Update the specific message with this ID
              setMessages((prev) => prev.map(msg => 
                msg.id === messageId 
                  ? { ...msg, answer: plainTextResponse, isStreaming: false }
                  : msg
              ));
              if (selectedMessageId === messageId) {
                setCurrentResponse(plainTextResponse);
                animateResponse(plainTextResponse);
              }
            }
            break;
          }
          
          setIsLoading(false);
          const finalResponse = localStreamBuffer;
          if (finalMetadata) {
            newSessionId = finalMetadata.session_id || newSessionId;
          }
          
          const plainTextResponse = convertJsonToPlainText(finalResponse);
          
          // Update the specific message with this ID instead of creating a new one
          setMessages((prev) => prev.map(msg => 
            msg.id === messageId 
              ? { 
                  ...msg, 
                  answer: plainTextResponse,
                  session_id: newSessionId,
                  used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                  confidence: finalMetadata?.confidence || 0.8,
                  isStreaming: false,
                }
              : msg
          ));
          
          if (selectedMessageId === messageId) {
            setSelectedMessageId(messageId);
            setSessionId(newSessionId);
            setChatInput('');
            setCurrentResponse(plainTextResponse);
            animateResponse(plainTextResponse);
            setHasResponse(true);
          }
          setSuccess('Question answered!');
          break;
        }
        
        if (isStopped) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.replace(/^data: /, '').trim();
          
          if (data === '[PING]') {
            continue;
          }
          
            if (data === '[DONE]') {
              if (isStopped) {
                setIsLoading(false);
                if (localStreamBuffer) {
                  const plainTextResponse = convertJsonToPlainText(localStreamBuffer);
                  // Update the specific message with this ID
                  setMessages((prev) => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, answer: plainTextResponse, isStreaming: false }
                      : msg
                  ));
                  if (selectedMessageId === messageId) {
                    setCurrentResponse(plainTextResponse);
                    animateResponse(plainTextResponse);
                  }
                }
                return;
              }
              
              setIsLoading(false);
              const finalResponse = localStreamBuffer;
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || newSessionId;
              }
              
              const plainTextResponse = convertJsonToPlainText(finalResponse);
              
              // Update the specific message with this ID instead of creating a new one
              setMessages((prev) => prev.map(msg => 
                msg.id === messageId 
                  ? { 
                      ...msg, 
                      answer: plainTextResponse,
                      session_id: newSessionId,
                      used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                      confidence: finalMetadata?.confidence || 0.8,
                      isStreaming: false,
                    }
                  : msg
              ));
              
              if (selectedMessageId === messageId) {
                setSelectedMessageId(messageId);
                setSessionId(newSessionId);
                setChatInput('');
                setCurrentResponse(plainTextResponse);
                animateResponse(plainTextResponse);
                setHasResponse(true);
              }
              setSuccess('Question answered!');
              return;
            }
          
          if (isStopped) {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              if (!isStopped) {
                localStreamBuffer += parsed.text || '';
                streamBufferRef.current = localStreamBuffer; // Keep ref updated for compatibility
                // Live paint (rAF-throttled). The panel prefers a message's stored
                // answer, so this only shows for the in-flight message the user
                // was just switched to.
                paintStreamingResponse();
              }

              if (isStopped) {
                break;
              }
            } else if (parsed.type === 'done') {
              if (isStopped) {
                setIsLoading(false);
                if (localStreamBuffer) {
                  const plainTextResponse = convertJsonToPlainText(localStreamBuffer);
                  // Update the specific message with this ID
                  setMessages((prev) => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, answer: plainTextResponse, isStreaming: false }
                      : msg
                  ));
                  if (selectedMessageId === messageId) {
                    setCurrentResponse(plainTextResponse);
                    animateResponse(plainTextResponse);
                  }
                }
                return;
              }
              
              finalMetadata = parsed;
              const finalResponse = localStreamBuffer;
              const plainTextResponse = convertJsonToPlainText(finalResponse);
              
              // Update the specific message with this ID
              setMessages((prev) => prev.map(msg => 
                msg.id === messageId 
                  ? { 
                      ...msg, 
                      answer: plainTextResponse,
                      session_id: finalMetadata?.session_id || msg.session_id,
                      used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                      confidence: finalMetadata?.confidence || 0.8,
                      isStreaming: false,
                    }
                  : msg
              ));
              
              if (selectedMessageId === messageId) {
                setCurrentResponse(plainTextResponse);
                animateResponse(plainTextResponse);
              }
              setIsLoading(false);
              notifyResponseComplete();
            } else if (parsed.type === 'error') {
              const errMsg = parsed.error;
              const quota =
                errMsg && typeof errMsg === 'object'
                  ? getChatModelQuotaUserMessage({
                      code: errMsg.code,
                      details: errMsg.details,
                      response: { data: errMsg },
                    })
                  : null;
              setError(
                quota ||
                  (typeof errMsg === 'string'
                    ? errMsg
                    : errMsg?.message || errMsg?.detail || JSON.stringify(errMsg) || 'An error occurred')
              );
              cancelStreamPaint();
              setIsAnimatingResponse(false);
              setIsLoading(false);
            }
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error('[chatWithDocument] Streaming error:', error);
      if (error.message && error.message.includes('No content found')) {
        setError('Document is still processing. Please wait a few moments and try again.');
        if (file_id) {
          const status = await getProcessingStatus(file_id);
          if (status) {
            setProcessingStatus(status);
            setProgressPercentage(status.processing_progress || 0);
            if (status.status !== 'processed' && status.status !== 'error') {
              startProcessingStatusPolling(file_id);
            }
          }
        }
      } else if (error?.isQuotaError || error?.quotaDisplay) {
        if (!showQuotaError(error)) setError(error.quotaDisplay || error);
      } else {
        setError(`Chat failed: ${error.message}`);
      }
      setIsLoading(false);
      throw error;
    } finally {
      cancelStreamPaint();
      setIsLoading(false);
      streamReaderRef.current = null;
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    console.log('Files selected:', files.length);
    if (files.length === 0) return;

    if (limitsLoading) {
      setError('Loading upload limits from server… Please try again in a moment.');
      event.target.value = '';
      return;
    }
    if (limitsError || maxUploadBytes == null) {
      setError('Could not load upload limits (llm_chat_config). Please refresh the page.');
      event.target.value = '';
      return;
    }

    const maxSize = maxUploadBytes;

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/tiff',
      // Audio formats — transcribed via Google Cloud Speech-to-Text
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/flac',
      'audio/x-flac',
      'audio/mp3',
      'audio/mpeg',
      'audio/ogg',
      'audio/webm',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/aac',
    ];
    
    const audioExtensions = new Set(['.mp3', '.wav', '.wave', '.flac', '.ogg', '.opus', '.webm', '.m4a', '.aac', '.amr']);
    const isAudioByExtension = (name) => {
      const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
      return audioExtensions.has(ext);
    };

    let hasFileSizeError = false;
    const validFiles = files.filter((file) => {
      const effectiveType = file.type || (isAudioByExtension(file.name) ? 'audio/mpeg' : '');
      if (!allowedTypes.includes(effectiveType)) {
        setError(`File "${file.name}" has an unsupported type.`);
        return false;
      }
      
      if (file.size > maxSize) {
        const fileSizeFormatted = formatFileSize(file.size);
        console.log('File size limit exceeded:', { fileName: file.name, fileSize: fileSizeFormatted, maxSizeMB: maxUploadMbLabel });
        hasFileSizeError = true;
        setFileSizeLimitError({
          message: formatUploadLimitExceededMessage({
            fileName: file.name,
            fileSizeFormatted,
            limitMbLabel: maxUploadMbLabel,
          }),
        });
        return false;
      }
      
      return true;
    });
    
    if (validFiles.length > 0) {
      setFileSizeLimitError(null);
    }
    
    if (validFiles.length === 0) {
      if (!hasFileSizeError) {
        event.target.value = '';
      } else {
        setTimeout(() => {
          if (event.target) {
            event.target.value = '';
          }
        }, 100);
      }
      return;
    }
    
    try {
      await batchUploadDocuments(validFiles, selectedSecretId, selectedLlmName);
    } catch (error) {
      console.error('Upload error:', error);
    }
    event.target.value = '';
  };

  // Handle Google Drive file upload
  const handleGoogleDriveUpload = async (documents) => {
    console.log('[handleGoogleDriveUpload] Received documents from Google Drive:', documents);
    
    if (!documents || documents.length === 0) {
      console.log('[handleGoogleDriveUpload] No documents received');
      return;
    }

    // Filter out failed uploads
    const successfulDocs = documents.filter(doc => doc.status !== 'failed' && !doc.error);
    
    if (successfulDocs.length === 0) {
      setError('No files were successfully uploaded from Google Drive');
      return;
    }

    setIsUploading(true);
    setShowSplitView(true);

    // Create batch uploads for the uploaded documents
    const newBatchUploads = successfulDocs.map((doc, index) => ({
      id: `gdrive-${doc.id || Date.now()}-${index}`,
      file: null,
      fileName: doc.originalname || doc.name || 'Google Drive File',
      fileSize: doc.file_size || doc.size || 0,
      status: 'batch_processing',
      progress: 100,
      error: null,
      fileId: doc.id,
      processingProgress: 0,
      isLargeFile: false,
      source: 'google_drive',
    }));

    setBatchUploads(newBatchUploads);

    // Add to uploaded documents
    const newUploadedDocs = successfulDocs.map((doc) => ({
      id: doc.id,
      fileName: doc.originalname || doc.name || 'Google Drive File',
      fileSize: doc.file_size || doc.size || 0,
      uploadedAt: new Date().toISOString(),
      status: 'batch_processing',
      processingProgress: 0,
      source: 'google_drive',
    }));

    setUploadedDocuments((prev) => [...prev, ...newUploadedDocs]);

    // Set the first file as the active file
    if (successfulDocs.length > 0 && successfulDocs[0].id) {
      const firstDoc = successfulDocs[0];
      setFileId(firstDoc.id);
      setDocumentData({
        id: firstDoc.id,
        title: firstDoc.originalname || firstDoc.name || 'Google Drive File',
        originalName: firstDoc.originalname || firstDoc.name,
        size: firstDoc.file_size || firstDoc.size || 0,
        type: firstDoc.mimetype || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        status: 'batch_processing',
        processingProgress: 0,
        source: 'google_drive',
      });

      // Start polling for processing status
      const fileIds = successfulDocs.map(doc => doc.id).filter(Boolean);
      if (fileIds.length > 0) {
        startBatchProcessingPolling(fileIds);
        startProcessingStatusPolling(firstDoc.id);
      }
    }

    setSuccess(`${successfulDocs.length} file(s) uploaded from Google Drive! Processing...`);
    setIsUploading(false);
  };

  const handleDropdownSelect = (secretName, secretId, llmName) => {
    if (isLoading || isGeneratingInsights) return;
    flushSync(() => {
      setActiveDropdown(secretName);
      setSelectedSecretId(secretId);
      setSelectedLlmName(llmName);
      setIsSecretPromptSelected(true);
      setChatInput('');
      setShowDropdown(false);
    });
    void handleSend(
      { preventDefault: () => {} },
      { secretId, llmName, secretName }
    );
  };

  const handleStyleSelect = (style) => {
    setLearningModeActive(style === 'learning');
    setShowStyleDropdown(false);
  };

  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown('Custom Query');
    }
  };

  const handleSend = async (e, secretOverride = null, customPrompt = null) => {
    if (e?.preventDefault) e.preventDefault();

    const secretPromptMode = Boolean(secretOverride?.secretId) || isSecretPromptSelected;
    const effectiveSecretId = secretOverride?.secretId ?? selectedSecretId;
    const effectiveLlmName = secretOverride?.llmName ?? selectedLlmName;

    const hasFile = Boolean(fileId);
    const currentStatus = processingStatus?.status;
    const currentProgress = progressPercentage || 0;
    const isActivelyProcessing =
      currentStatus &&
      (currentStatus === 'processing' ||
        currentStatus === 'batch_processing' ||
        currentStatus === 'queued' ||
        currentStatus === 'pending');
    const isProcessingComplete =
      !currentStatus || currentStatus === 'processed' || currentProgress >= 100;

    if (secretPromptMode) {
      if (!hasFile && !activeFolderName) {
        setError('Please upload a document or select a case folder before running an analysis prompt.');
        return;
      }
      if (hasFile) {
        if (currentStatus === 'error') {
          setError('Document processing failed. Please upload a new document.');
          return;
        }
        if (isActivelyProcessing && !isProcessingComplete) {
          setError('Document is still being processed. Please wait until processing is complete.');
          return;
        }
      }
      if (!effectiveSecretId) {
        setError('Please select an analysis type.');
        return;
      }
      const selectedSecret = secrets.find((s) => s.id === effectiveSecretId);
      const promptLabel = secretOverride?.secretName || selectedSecret?.name || 'Secret Prompt';
      
      const currentSecretId = effectiveSecretId;
      const currentPromptLabel = promptLabel;
      const currentLlmName = effectiveLlmName;
      
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      currentRequestIdRef.current = requestId;
      
      try {
        setIsGeneratingInsights(true);
        setError(null);
        console.log('[handleSend] Triggering secret analysis with streaming:', {
          requestId,
          secretId: currentSecretId,
          fileId,
          additionalInput: chatInput.trim(),
          promptLabel: currentPromptLabel,
          llmName: currentLlmName,
        });
        
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          clearTimeout(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        // Create message BEFORE streaming starts with a unique ID
        const messageId = Date.now();
        
        // Create placeholder message immediately
        const placeholderChat = {
          id: messageId,
          file_id: fileId,
          session_id: sessionId,
          question: currentPromptLabel,
          answer: '', // Will be updated when streaming completes
          display_text_left_panel: `Analysis: ${currentPromptLabel}`,
          timestamp: new Date().toISOString(),
          used_chunk_ids: [],
          confidence: 0.8,
          type: 'chat',
          used_secret_prompt: true,
          prompt_label: currentPromptLabel,
          secret_id: currentSecretId,
          isStreaming: true,
        };
        
        // Add placeholder message immediately
        setMessages((prev) => [...prev, placeholderChat]);
        setSelectedMessageId(messageId);
        setCurrentResponse('');
        setAnimatedResponseContent('');
        
        // Use a local buffer for this specific stream instead of shared ref
        let localStreamBuffer = '';
        streamBufferRef.current = '';
        setIsAnimatingResponse(false);
        setIsStopped(false);
        setHasResponse(false);
        await new Promise(resolve => setTimeout(resolve, 50));
        
        if (streamReaderRef.current) {
          try {
            await streamReaderRef.current.cancel();
          } catch (e) {
          }
          streamReaderRef.current = null;
        }
        
        if (streamUpdateTimeoutRef.current) {
          clearTimeout(streamUpdateTimeoutRef.current);
          streamUpdateTimeoutRef.current = null;
        }

        ensureNotificationPermission();
        const useFolderChat = Boolean(activeFolderName);
        const streamUrl = useFolderChat
          ? `${DOCS_BASE_URL}/${encodeURIComponent(activeFolderName)}/intelligent-chat/stream`
          : `${API_BASE_URL}/files/chat/stream`;
        const streamBody = useFolderChat
          ? {
              question: chatInput.trim() || '',
              secret_id: currentSecretId,
              prompt_label: currentPromptLabel,
              session_id: sessionId,
              llm_name: currentLlmName || 'gemini',
              learning_mode: learningModeActive,
            }
          : {
              file_id: fileId,
              secret_id: currentSecretId,
              used_secret_prompt: true,
              prompt_label: currentPromptLabel,
              session_id: sessionId,
              llm_name: currentLlmName,
              additional_input: chatInput.trim() || '',
              learning_mode: learningModeActive,
            };

        const response = await fetch(streamUrl, {
          method: 'POST',
          headers: getIntelligentChatStreamHeaders(),
          body: JSON.stringify(streamBody),
        });

        if (!response.ok) {
          let errorData = {};
          try { errorData = await response.json(); } catch {}
          if (response.status === 429 || response.status === 503) {
            const quotaDisplay = parseLlmPolicyErrorForUi(response.status, errorData);
            const err = new Error(quotaDisplay.body);
            err.quotaDisplay = quotaDisplay;
            throw err;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        streamReaderRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let newSessionId = sessionId;
        let finalMetadata = null;

        while (true) {
          if (currentRequestIdRef.current !== requestId) {
            console.log('[handleSend] Request ID changed during streaming, aborting. Current:', currentRequestIdRef.current, 'Expected:', requestId);
            break;
          }
          
          const { done, value } = await reader.read();
          
          if (done) {
            if (currentRequestIdRef.current !== requestId) {
              console.log('[handleSend] Request ID changed before processing done, ignoring response');
              break;
            }
            
            if (isStopped) {
              setIsGeneratingInsights(false);
              if (localStreamBuffer && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
                const finalResponse = localStreamBuffer;
                const isStructured = isStructuredJsonResponse(finalResponse);
                const responseToStore = isStructured ? finalResponse : convertJsonToPlainText(finalResponse);
                const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
                
                // Update the specific message with this ID
                setMessages((prev) => prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, answer: responseToStore, isStreaming: false }
                    : msg
                ));
                
                if (selectedMessageId === messageId) {
                  setCurrentResponse(responseToDisplay);
                  animateResponse(responseToDisplay, isStructured);
                }
              }
              break;
            }
            
            setIsGeneratingInsights(false);
            const finalResponse = localStreamBuffer;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
            
            // Prefer the backend's normalized done.answer (clean GFM). Local
            // re-conversion of raw JSON emits HTML+markdown that renders flattened.
            const backendAnswer = typeof finalMetadata?.answer === 'string' ? finalMetadata.answer.trim() : '';
            const isStructured = !backendAnswer && isStructuredJsonResponse(finalResponse);
            const responseToStore = backendAnswer || (isStructured ? finalResponse : convertJsonToPlainText(finalResponse));
            const responseToDisplay = backendAnswer || (isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse));
            
            // Update the specific message with this ID instead of creating a new one
            setMessages((prev) => prev.map(msg => 
              msg.id === messageId 
                ? { 
                    ...msg, 
                    answer: responseToStore,
                    session_id: newSessionId,
                    used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                    confidence: finalMetadata?.confidence || 0.8,
                    isStreaming: false,
                  }
                : msg
            ));
            
            if (currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId && selectedMessageId === messageId) {
              setSelectedMessageId(messageId);
              setSessionId(newSessionId);
              setChatInput('');
              setCurrentResponse(responseToDisplay);
              animateResponse(responseToDisplay, true);
              setHasResponse(true);
            } else {
              console.log('[handleSend] Request ID or secret prompt changed during streaming, not displaying response. RequestId:', currentRequestIdRef.current, 'Expected:', requestId, 'Current:', currentSecretId, 'Selected:', selectedSecretId, 'MessageId:', messageId);
            }
            setSuccess('Analysis completed successfully!');
            setIsSecretPromptSelected(false);
            setActiveDropdown('Custom Query');
            break;
          }
          
          if (isStopped) {
            break;
          }
          
          if (currentRequestIdRef.current !== requestId) {
            console.log('[handleSend] Request ID changed during chunk processing, ignoring chunks');
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;
            
            const data = line.replace(/^data: /, '').trim();
            
            if (data === '[PING]') {
              continue;
            }
            
            if (data === '[DONE]') {
              if (currentRequestIdRef.current !== requestId) {
                console.log('[handleSend] Request ID changed before processing [DONE], ignoring');
                return;
              }
              
              if (isStopped) {
                setIsGeneratingInsights(false);
                if (localStreamBuffer && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
                  const finalResponse = localStreamBuffer;
                  const isStructured = isStructuredJsonResponse(finalResponse);
                  const responseToStore = isStructured ? finalResponse : convertJsonToPlainText(finalResponse);
                  const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
                  
                  // Update the specific message with this ID
                  setMessages((prev) => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, answer: responseToStore, isStreaming: false }
                      : msg
                  ));
                  
                  if (selectedMessageId === messageId) {
                    setCurrentResponse(responseToDisplay);
                    animateResponse(responseToDisplay, isStructured);
                  }
                }
                return;
              }
              
              setIsGeneratingInsights(false);
              const finalResponse = localStreamBuffer;
              
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || newSessionId;
              }
              
              const backendAnswer = typeof finalMetadata?.answer === 'string' ? finalMetadata.answer.trim() : '';
              const isStructured = !backendAnswer && isStructuredJsonResponse(finalResponse);
              const responseToStore = backendAnswer || (isStructured ? finalResponse : convertJsonToPlainText(finalResponse));
              const responseToDisplay = backendAnswer || (isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse));
              
              // Update the specific message with this ID instead of creating a new one
              setMessages((prev) => prev.map(msg => 
                msg.id === messageId 
                  ? { 
                      ...msg, 
                      answer: responseToStore,
                      session_id: newSessionId,
                      used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                      confidence: finalMetadata?.confidence || 0.8,
                      isStreaming: false,
                    }
                  : msg
              ));
              
              if (currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId && selectedMessageId === messageId) {
                setSelectedMessageId(messageId);
                setSessionId(newSessionId);
                setChatInput('');
                setCurrentResponse(responseToDisplay);
                animateResponse(responseToDisplay, true);
                setHasResponse(true);
              } else {
                console.log('[handleSend] Request ID or secret prompt changed during streaming, not displaying response. RequestId:', currentRequestIdRef.current, 'Expected:', requestId, 'Current:', currentSecretId, 'Selected:', selectedSecretId, 'MessageId:', messageId);
              }
              setSuccess('Analysis completed successfully!');
              setIsSecretPromptSelected(false);
              setActiveDropdown('Custom Query');
              return;
            }
            
            if (isStopped) {
              return;
            }
            
            if (currentRequestIdRef.current !== requestId) {
              console.log('[handleSend] Request ID changed during chunk processing, ignoring chunks');
              return;
            }

            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'metadata') {
                console.log('Stream metadata:', parsed);
                newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              if (!isStopped && currentRequestIdRef.current === requestId) {
                localStreamBuffer += parsed.text || '';
                streamBufferRef.current = localStreamBuffer; // Keep ref updated for compatibility
                paintStreamingResponse();
              }

              if (isStopped) {
                break;
              }
              
              if (currentRequestIdRef.current !== requestId) {
                console.log('[handleSend] Request ID changed after processing chunk, aborting');
                break;
              }
              } else if (parsed.type === 'done') {
                if (isStopped) {
                  setIsGeneratingInsights(false);
                  return;
                }
                
                finalMetadata = parsed;
                const backendAnswer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
                const finalResponse = backendAnswer || streamBufferRef.current;
                const isStructured = !backendAnswer && isStructuredJsonResponse(finalResponse);
                const responseToDisplay = backendAnswer || (isStructured
                  ? renderSecretPromptResponse(finalResponse)
                  : convertJsonToPlainText(finalResponse));
                setCurrentResponse(responseToDisplay);
                animateResponse(responseToDisplay, true);
                setIsGeneratingInsights(false);
                notifyResponseComplete({ title: 'Analysis ready', body: 'JuriNex has finished your document analysis.' });
              } else if (parsed.type === 'error') {
                const errMsg = parsed.error;
                const quota =
                  errMsg && typeof errMsg === 'object'
                    ? getChatModelQuotaUserMessage({
                        code: errMsg.code,
                        details: errMsg.details,
                        response: { data: errMsg },
                      })
                    : null;
                setError(
                  quota ||
                    (typeof errMsg === 'string'
                      ? errMsg
                      : errMsg?.message || errMsg?.detail || JSON.stringify(errMsg) || 'An error occurred')
                );
                cancelStreamPaint();
                setIsAnimatingResponse(false);
                setIsGeneratingInsights(false);
              }
            } catch (e) {
            }
          }
        }
      } catch (error) {
        console.error('[handleSend] Analysis error:', error);
        if (error.message && error.message.includes('No content found')) {
          setError('Document is still processing. Please wait a few moments and try again.');
          if (fileId) {
            const status = await getProcessingStatus(fileId);
            if (status) {
              setProcessingStatus(status);
              setProgressPercentage(status.processing_progress || 0);
            }
          }
        } else if (error?.isQuotaError || error?.quotaDisplay) {
          if (!showQuotaError(error)) setError(error.quotaDisplay || error);
        } else {
          setError(`Analysis failed: ${error.message}`);
        }
      } finally {
        cancelStreamPaint();
        setIsGeneratingInsights(false);
        streamReaderRef.current = null;
      }
    } else {
      // A custom prompt sends its full body to the model but is shown by name.
      const questionText = (customPrompt?.prompt_text || chatInput).trim();
      if (!questionText) {
        setError('Please enter a question.');
        return;
      }

      if (!hasFile && !activeFolderName) {
        setError('Select a case folder or a file in the list, or upload a document.');
        return;
      }

      if (hasFile) {
        if (currentStatus === 'error') {
          setError('Document processing failed. Please upload a new document.');
          return;
        }
        if (isActivelyProcessing && !isProcessingComplete) {
          setError('Document is still being processed. Please wait until processing is complete.');
          return;
        }
      }

      try {
        console.log('[handleSend] Using custom query. LLM:', selectedLlmName || 'default (backend)');
        await chatWithDocument(
          fileId || null, questionText, sessionId, selectedLlmName, customPrompt?.name || null,
        );
      } catch (error) {
        console.error('[handleSend] Chat error:', error);
      }
    }
  };

  // Regenerate a past response: re-run the same question (or analysis prompt)
  // through the normal streaming flow.
  const handleRetryMessage = (msg) => {
    if (isLoading || isGeneratingInsights || !msg) return;
    if (msg.used_secret_prompt && msg.secret_id) {
      const secret = secrets.find((s) => s.id === msg.secret_id);
      void handleSend(
        { preventDefault: () => {} },
        { secretId: msg.secret_id, secretName: secret?.name || msg.prompt_label, llmName: secret?.llm_name }
      );
      return;
    }
    if (!msg.question) return;
    chatWithDocument(
      msg.file_id || null, msg.question, msg.session_id || sessionId, selectedLlmName, msg.prompt_label || null,
    ).catch(() => {});
  };

  const handleMessageClick = async (message) => {
    setSelectedMessageId(message.id);
    
    // Stop any ongoing animation and clear animation state
    setIsAnimatingResponse(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (message.used_secret_prompt && message.secret_id) {
      setSelectedSecretId(message.secret_id);
      setIsSecretPromptSelected(true);
      const secret = secrets.find((s) => s.id === message.secret_id);
      if (secret) {
        setActiveDropdown(secret.name);
        setSelectedLlmName(secret.llm_name);
      }
    } else {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    
    // Get the raw answer from the message
    const rawAnswer = message.answer || message.response || '';
    
    // Format the response based on whether it's structured JSON
    const isStructured = message.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
    const responseToDisplay = isStructured
      ? renderSecretPromptResponse(rawAnswer)
      : convertJsonToPlainText(rawAnswer);
    
    // Update both currentResponse and animatedResponseContent to ensure display consistency
    setCurrentResponse(responseToDisplay);
    setAnimatedResponseContent(responseToDisplay);
   
    if (message.file_id) {
      const currentFileId = fileId || message.file_id;
      if (currentFileId) {
        try {
          const status = await getProcessingStatus(currentFileId);
          if (status) {
            const finalStatus = status.status === 'processed' ? status : { ...status, status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(finalStatus.processing_progress || 100);
          } else {
            setProcessingStatus({ status: 'processed', processing_progress: 100 });
            setProgressPercentage(100);
          }
        } catch (error) {
          console.error('[handleMessageClick] Error checking status:', error);
          setProcessingStatus({ status: 'processed', processing_progress: 100 });
          setProgressPercentage(100);
        }
      }
    }
  };

  const clearAllChatData = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
      clearInterval(batchPollingIntervalsRef.current[fileId]);
    });
    batchPollingIntervalsRef.current = {};
    setActivePollingFiles(new Set());
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
      uploadIntervalRef.current = null;
    }
    setMessages([]);
    setDocumentData(null);
    setFileId(null);
    setCurrentResponse('');
    setHasResponse(false);
    setChatInput('');
    setProcessingStatus(null);
    setProgressPercentage(0);
    setError(null);
    setAnimatedResponseContent('');
    setIsAnimatingResponse(false);
    setShowSplitView(false);
    setBatchUploads([]);
    setUploadedDocuments([]);
    setIsSecretPromptSelected(false);
    setSelectedMessageId(null);
    setActiveDropdown('Custom Query');
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);
    setSuccess('New chat session started!');
  };

  const startNewChat = () => {
    clearAllChatData();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getStatusDisplayText = (status, progress = 0) => {
    switch (status) {
      case 'queued':
        return 'Queued...';
      case 'processing':
        if (progress >= 100) return 'Done';
        return progress < 50
          ? `Processing... (${Math.round(progress)}%)`
          : progress < 90
          ? `Analyzing... (${Math.round(progress)}%)`
          : `Finalizing... (${Math.round(progress)}%)`;
      case 'batch_processing':
        if (progress >= 100) return 'Done';
        return progress < 30
          ? `Batch Processing... (${Math.round(progress)}%)`
          : progress < 70
          ? `Processing Documents... (${Math.round(progress)}%)`
          : progress < 95
          ? `Analyzing Batch... (${Math.round(progress)}%)`
          : `Completing... (${Math.round(progress)}%)`;
      case 'processed':
        return progress >= 100 ? 'Done' : 'Processing...';
      case 'error':
      case 'failed':
        return 'Failed';
      default:
        return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    }
  };

  const handleCopyResponse = async () => {
    try {
      const textToCopy = animatedResponseContent || currentResponse;
      if (textToCopy) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = textToCopy;
        await navigator.clipboard.writeText(tempDiv.innerText);
        setSuccess('AI response copied to clipboard!');
      } else {
        setError('No response to copy.');
      }
    } catch (err) {
      console.error('Failed to copy AI response:', err);
      setError('Failed to copy response.');
    }
  };

  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="bg-yellow-200 font-semibold text-black">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
      }
      Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
        clearInterval(batchPollingIntervalsRef.current[fileId]);
      });
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    loadSecrets();
    loadCustomPromptGroups();
  }, []);


  useEffect(() => {
    if (messages.length > 0 && fileId) {
      const currentStatus = processingStatus?.status;
      const currentProgress = progressPercentage || 0;
     
      if (currentStatus !== 'processed' || currentProgress < 100) {
        setProcessingStatus(prev => ({
          ...prev,
          status: 'processed',
          processing_progress: 100
        }));
        setProgressPercentage(100);
      }
    }
  }, [messages, fileId, processingStatus, progressPercentage]);

  useEffect(() => {
    const fetchChatHistory = async (currentFileId, currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for fileId:', currentFileId);
        const response = await apiRequest(`/files/chat-history/${currentFileId}`, {
          method: 'GET',
        });
        const sessions = response || [];
        let allMessages = [];
        sessions.forEach((session) => {
          session.messages.forEach((message) => {
            allMessages.push({
              ...message,
              session_id: session.session_id,
              timestamp: message.created_at || message.timestamp,
              display_text_left_panel:
                message.used_secret_prompt
                  ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                  : message.question,
            });
          });
        });
        if (currentSessionId) {
          allMessages = allMessages.filter((msg) => msg.session_id === currentSessionId);
        }
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
        if (allMessages.length > 0) {
          const fileStatus = await getProcessingStatus(currentFileId);
          const actualStatus = 'processed';
          const actualProgress = 100;
         
          const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
         
          setDocumentData({
            id: currentFileId,
            title: `Document for Session ${currentSessionId}`,
            originalName: `Document for Session ${currentSessionId}`,
            size: 0,
            type: 'unknown',
            uploadedAt: new Date().toISOString(),
            status: actualStatus,
            processingProgress: actualProgress,
          });
          setFileId(currentFileId);
          setSessionId(currentSessionId);
          setProcessingStatus(finalStatus);
          setProgressPercentage(actualProgress);
          setHasResponse(true);
          setShowSplitView(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const isSecretPrompt = chatToDisplay.used_secret_prompt || false;
            const isStructured = isSecretPrompt && isStructuredJsonResponse(rawAnswer);
            const responseToDisplay = isStructured
              ? renderSecretPromptResponse(rawAnswer)
              : convertJsonToPlainText(rawAnswer);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistory:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    const fetchChatHistoryBySessionId = async (currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for sessionId:', currentSessionId);
        const response = await apiRequest(`/files/session/${currentSessionId}`, {
          method: 'GET',
        });
       
        let allMessages = [];
        if (Array.isArray(response)) {
          allMessages = response.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.messages && Array.isArray(response.messages)) {
          allMessages = response.messages.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.sessions && Array.isArray(response.sessions)) {
          response.sessions.forEach((session) => {
            if (session.messages && Array.isArray(session.messages)) {
              session.messages.forEach((message) => {
                allMessages.push({
                  ...message,
                  session_id: session.session_id || currentSessionId,
                  timestamp: message.created_at || message.timestamp,
                  display_text_left_panel:
                    message.used_secret_prompt
                      ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                      : message.question,
                });
              });
            }
          });
        }
       
        const extractedFileId = allMessages.length > 0
          ? (allMessages[0].file_id || response.file_id || null)
          : null;
       
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
       
        if (allMessages.length > 0) {
          if (extractedFileId) {
            setFileId(extractedFileId);
            const fileStatus = await getProcessingStatus(extractedFileId);
            const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(100);
           
            setDocumentData({
              id: extractedFileId,
              title: `Document for Session ${currentSessionId}`,
              originalName: `Document for Session ${currentSessionId}`,
              size: 0,
              type: 'unknown',
              uploadedAt: new Date().toISOString(),
              status: 'processed',
              processingProgress: 100,
            });
          }
         
          setSessionId(currentSessionId);
          setHasResponse(true);
          setShowSplitView(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const responseText = chatToDisplay.answer || chatToDisplay.response || '';
            const isSecretPrompt = chatToDisplay.used_secret_prompt || false;
            const isStructured = isStructuredJsonResponse(responseText);
            const responseToDisplay = (isSecretPrompt && isStructured)
              ? renderSecretPromptResponse(responseText)
              : convertJsonToPlainText(responseText);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistoryBySessionId:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    try {
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const status = JSON.parse(savedProcessingStatus);
        const processingStatuses = ['processing', 'batch_processing', 'batch_queued', 'queued', 'pending'];
        if (processingStatuses.includes(status.status?.toLowerCase())) {
          console.log('🧹 Clearing stale processing state from localStorage');
          localStorage.removeItem('processingStatus');
          localStorage.removeItem('progressPercentage');
          localStorage.removeItem('isUploading');
        }
      }
    } catch (err) {
      console.error('Error cleaning up processing state:', err);
    }

    try {
      const savedMessages = localStorage.getItem('messages');
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
      const savedSessionId = localStorage.getItem('sessionId');
      if (savedSessionId) {
        setSessionId(savedSessionId);
      } else {
        const newSessionId = `session-${Date.now()}`;
        setSessionId(newSessionId);
      }
      const savedCurrentResponse = localStorage.getItem('currentResponse');
      const savedAnimatedResponseContent = localStorage.getItem('animatedResponseContent');
      if (savedCurrentResponse) {
        const isStructured = isStructuredJsonResponse(savedCurrentResponse);
        const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
        const isSecretPrompt = selectedMessage?.used_secret_prompt || false;
        
        const responseToDisplay = (isSecretPrompt && isStructured)
          ? renderSecretPromptResponse(savedCurrentResponse)
          : convertJsonToPlainText(savedCurrentResponse);
        
        setCurrentResponse(responseToDisplay);
        if (savedAnimatedResponseContent) {
          const isAnimatedStructured = isStructuredJsonResponse(savedAnimatedResponseContent);
          const animatedToDisplay = (isSecretPrompt && isAnimatedStructured)
            ? renderSecretPromptResponse(savedAnimatedResponseContent)
            : convertJsonToPlainText(savedAnimatedResponseContent);
          setAnimatedResponseContent(animatedToDisplay);
          setShowSplitView(true);
        } else {
          setAnimatedResponseContent(responseToDisplay);
        }
        setIsAnimatingResponse(false);
      }
      const savedHasResponse = localStorage.getItem('hasResponse');
      if (savedHasResponse) {
        const parsedHasResponse = JSON.parse(savedHasResponse);
        setHasResponse(parsedHasResponse);
        if (parsedHasResponse) {
          setShowSplitView(true);
        }
      }
      const savedDocumentData = localStorage.getItem('documentData');
      if (savedDocumentData) {
        const parsed = JSON.parse(savedDocumentData);
        setDocumentData(parsed);
      }
      const savedFileId = localStorage.getItem('fileId');
      if (savedFileId) setFileId(savedFileId);
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const parsed = JSON.parse(savedProcessingStatus);
        setProcessingStatus(parsed);
        setProgressPercentage(parsed.processing_progress || 0);
      }
    } catch (error) {
      console.error('[AnalysisPage] Error restoring from localStorage:', error);
      if (!sessionId) {
        const newSessionId = `session-${Date.now()}`;
        setSessionId(newSessionId);
      }
    }

    if (location.state?.newChat) {
      clearAllChatData();
      window.history.replaceState({}, document.title);
    } else if (paramFileId && paramSessionId) {
      console.log('[AnalysisPage] Loading chat from URL params:', { paramFileId, paramSessionId });
      setFileId(paramFileId);
      setSessionId(paramSessionId);
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatHistory(paramFileId, paramSessionId, null);
    } else if (paramSessionId && !paramFileId) {
      console.log('[AnalysisPage] Loading chat from session-only URL param:', { paramSessionId });
      setSessionId(paramSessionId);
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatHistoryBySessionId(paramSessionId, null);
    } else if (location.state?.chat) {
      const chatData = location.state.chat;
      console.log('[AnalysisPage] Loading chat from location state:', chatData);
      if (chatData.file_id && chatData.session_id) {
        setFileId(chatData.file_id);
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
      } else if (chatData.session_id) {
        console.log('[AnalysisPage] Loading chat with session_id only:', chatData.session_id);
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistoryBySessionId(chatData.session_id, chatData.id);
      } else {
        setError('Unable to load chat: Missing required information (session_id or file_id)');
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state, paramFileId, paramSessionId]);

  useEffect(() => {
    if (showSplitView) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(true);
    } else if (hasResponse) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    } else {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    }
  }, [hasResponse, showSplitView, setIsSidebarHidden, setIsSidebarCollapsed]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
    }
    const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
    if (uploadingFiles.length > 0) {
      uploadIntervalRef.current = setInterval(() => {
        setBatchUploads((prev) =>
          prev.map((upload) => {
            if (upload.status === 'uploading' && upload.progress < 100) {
              const newProgress = Math.min(upload.progress + 2, 100);
              return { ...upload, progress: newProgress };
            }
            return upload;
          })
        );
      }, 200);
    }
    return () => {
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
    };
  }, [batchUploads.filter((u) => u.status === 'uploading').length]);

  useEffect(() => {
    if (batchUploads.length > 0) {
      const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
      if (uploadingFiles.length > 0) {
        const totalUploadProgress = uploadingFiles.reduce(
          (sum, upload) => sum + (upload.progress || 0),
          0
        );
        setOverallUploadProgress(totalUploadProgress / uploadingFiles.length);
      } else {
        setOverallUploadProgress(100);
      }
    } else {
      setOverallUploadProgress(0);
    }
  }, [batchUploads]);

  useEffect(() => {
    if (batchUploads.length > 0) {
      const processingFiles = batchUploads.filter(
        (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
      );
      if (processingFiles.length > 0) {
        const totalProcessingProgress = processingFiles.reduce(
          (sum, upload) => sum + (upload.processingProgress || 0),
          0
        );
        const avgProgress = totalProcessingProgress / processingFiles.length;
        setOverallBatchProcessingProgress(avgProgress);
        console.log(
          `[Overall Progress] ${processingFiles.length} files processing, avg: ${avgProgress.toFixed(1)}%`
        );
      } else {
        const nonProcessedFiles = batchUploads.filter(
          (upload) => upload.status !== 'processed' && upload.status !== 'failed'
        );
        if (nonProcessedFiles.length > 0) {
          setOverallBatchProcessingProgress(0);
        } else {
          setOverallBatchProcessingProgress(100);
        }
      }
    } else {
      setOverallBatchProcessingProgress(0);
    }
  }, [batchUploads]);

  const currentProgressBarPercentage = useMemo(() => {
    if (isUploading && overallUploadProgress < 100) {
      return overallUploadProgress;
    }
    const hasProcessingFiles = batchUploads.some(
      (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
    );
    if (hasProcessingFiles) {
      return overallBatchProcessingProgress;
    }
    if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
      return progressPercentage;
    }
    if (documentData && processingStatus?.status === 'processed') {
      return 100;
    }
    return 0;
  }, [isUploading, overallUploadProgress, batchUploads, overallBatchProcessingProgress, documentData, processingStatus, progressPercentage]);

  const currentProgressBarText = useMemo(() => {
    if (isUploading && overallUploadProgress < 100) {
      return `Uploading Documents... (${Math.round(overallUploadProgress)}%)`;
    }
    const processingCount = batchUploads.filter(
      (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
    ).length;
    if (processingCount > 0) {
      return `Processing ${processingCount} document${
        processingCount > 1 ? 's' : ''
      }... (${Math.round(overallBatchProcessingProgress)}%)`;
    }
    if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
      return `${
        processingStatus?.current_operation ||
        (processingStatus?.status === 'batch_processing' ? 'Batch Processing...' : 'Processing document...')
      } (${Math.round(progressPercentage)}%)`;
    }
    if (documentData && processingStatus?.status === 'processed' && progressPercentage >= 100) {
      return 'Done';
    }
    return '';
  }, [
    isUploading,
    overallUploadProgress,
    batchUploads,
    overallBatchProcessingProgress,
    documentData,
    processingStatus,
    progressPercentage,
  ]);

  const showMainProgressBar = useMemo(() => {
    return (
      (isUploading && overallUploadProgress < 100) ||
      batchUploads.some((upload) => upload.status === 'processing' || upload.status === 'batch_processing') ||
      (documentData &&
        (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) ||
      (documentData && processingStatus?.status === 'processed' && progressPercentage < 100)
    );
  }, [isUploading, overallUploadProgress, batchUploads, processingStatus, documentData, progressPercentage]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const markdownComponents = {
    h1: ({ node, ...props }) => (
      <h1
        className="text-xl sm:text-2xl lg:text-3xl font-bold mb-4 sm:mb-6 mt-6 sm:mt-8 text-gray-900 border-b-2 border-gray-300 pb-2 sm:pb-3 analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-4 sm:mb-5 mt-5 sm:mt-7 text-gray-900 border-b border-gray-200 pb-2 analysis-page-ai-response break-words" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4 mt-4 sm:mt-6 text-gray-800 analysis-page-ai-response break-words" {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 className="text-sm sm:text-base lg:text-lg font-semibold mb-2 sm:mb-3 mt-3 sm:mt-5 text-gray-800 analysis-page-ai-response break-words" {...props} />
    ),
    h5: ({ node, ...props }) => (
      <h5 className="text-sm sm:text-base font-semibold mb-2 mt-3 sm:mt-4 text-gray-700 analysis-page-ai-response break-words" {...props} />
    ),
    h6: ({ node, ...props }) => (
      <h6 className="text-xs sm:text-sm font-semibold mb-2 mt-2 sm:mt-3 text-gray-700 analysis-page-ai-response break-words" {...props} />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-3 sm:mb-4 leading-relaxed text-gray-800 text-sm sm:text-[15px] analysis-page-ai-response break-words" {...props} />
    ),
    strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
    em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
    li: ({ node, ...props }) => <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />,
    a: ({ node, ...props }) => (
      <a
        className="text-[#21C1B6] hover:text-[#1AA49B] underline font-medium transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="border-l-4 border-[#21C1B6] pl-3 sm:pl-4 py-2 my-3 sm:my-4 bg-[#E0F7F6] text-gray-700 italic rounded-r analysis-page-ai-response text-sm sm:text-base break-words"
        {...props}
      />
    ),
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      if (inline) {
        return (
          <code
            className="bg-gray-100 text-red-600 px-1 sm:px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono border border-gray-200 break-all"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <div className="relative my-3 sm:my-4">
          {language && (
            <div className="bg-gray-800 text-gray-300 text-xs px-2 sm:px-3 py-1 rounded-t font-mono">
              {language}
            </div>
          )}
          <pre className={`bg-gray-900 text-gray-100 p-2 sm:p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
            <code className="font-mono text-xs sm:text-sm" {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
    pre: ({ node, ...props }) => (
      <pre className="bg-gray-900 text-gray-100 p-2 sm:p-4 rounded my-3 sm:my-4 overflow-x-auto text-xs sm:text-sm" {...props} />
    ),
    table: ({ node, ...props }) => (
      <div className="my-4 sm:my-6 rounded-lg border border-gray-300 block max-w-full">
        <table className="border-collapse text-xs sm:text-sm w-full" {...props} />
      </div>
    ),
    thead: ({ node, ...props }) => <thead className="bg-gray-100" {...props} />,
    th: ({ node, ...props }) => (
      <th
        className="px-2 sm:px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-r border-gray-300 whitespace-normal last:border-r-0 break-words"
        {...props}
      />
    ),
    tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
    tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
    td: ({ node, ...props }) => (
      <td className="px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-800 border-b border-r border-gray-200 align-top last:border-r-0 break-words" {...props} />
    ),
    hr: ({ node, ...props }) => <hr className="my-6 border-t-2 border-gray-300" {...props} />,
    img: ({ node, ...props }) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
  };

  const getInputPlaceholder = () => {
    if (isSecretPromptSelected) {
      return `Analysis : ${activeDropdown}...`;
    }
    if (!fileId) {
      return 'Upload a document to get started';
    }
    if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
      return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
    }
    return showSplitView ? 'Ask a question...' : 'Message Legal Assistant...';
  };

  return (
    <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
      <ChatQuotaErrorModal
        error={error}
        onDismiss={() => setError(null)}
        onTopupSuccess={() => setError(null)}
      />
      {success && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 max-w-[90vw] sm:max-w-sm">
          <div className="bg-green-50 border border-green-200 text-green-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg flex items-center space-x-2">
            <CheckCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{success}</span>
            <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {showInsufficientFundsAlert && (
        <div className="fixed top-4 right-4 z-50 max-w-md">
          <div className="bg-red-50 border-2 border-red-300 rounded-lg shadow-2xl p-4 animate-fadeIn">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg font-bold text-gray-900 mb-1">Insufficient Funds</h4>
                <p className="text-sm text-gray-700 mb-3">
                  You don't have enough credits to upload documents. Please upgrade your subscription plan to continue.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowInsufficientFundsAlert(false);
                      navigate('/subscription-plans');
                    }}
                    className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA89E] transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
                  >
                    <CreditCard className="w-4 h-4 mr-1.5" />
                    Upgrade Now
                  </button>
                  <button
                    onClick={() => setShowInsufficientFundsAlert(false)}
                    className="px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowInsufficientFundsAlert(false)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {!showSplitView ? (
        <div className="flex flex-col h-full w-full">
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 overflow-y-auto">
            <div className="text-center max-w-2xl mb-8 sm:mb-12">
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
              <p className="text-gray-600 text-base sm:text-lg lg:text-xl leading-relaxed">
                Upload a legal document or ask a question to begin your AI-powered analysis.
              </p>
            </div>
            <div className="w-full max-w-4xl">
            {showMainProgressBar && (
              <div className="mt-3">
                <div className="text-center">
                  <div className="inline-flex items-center px-3 py-1.5 bg-[#E0F7F6] text-[#21C1B6] rounded-full text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {currentProgressBarText}
                  </div>
                  <div 
                    className="w-full bg-gray-200 rounded-full h-2 mt-2 relative overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setShowProgressPopup(!showProgressPopup)}
                    title="Click to view detailed progress"
                  >
                    <div
                      className={`h-2 rounded-full transition-all duration-300 relative overflow-hidden bg-gradient-to-r ${getStageColor(
                        currentProgressBarPercentage
                      )}`}
                      style={{ width: `${currentProgressBarPercentage}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                    </div>
                  </div>
                </div>
                <ProgressStagesPopup
                  isOpen={showProgressPopup}
                  onClose={() => setShowProgressPopup(false)}
                  processingStatus={processingStatus}
                  progressPercentage={progressPercentage}
                  documentName={documentData?.originalName || 'Document'}
                />
              </div>
            )}
            {documentData && !hasResponse && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileCheck className="h-5 w-5 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{documentData.originalName}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(documentData.size)} • {formatDate(documentData.uploadedAt)}
                    </p>
                  </div>
                  {processingStatus && (
                    <div
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        processingStatus.status === 'processed'
                          ? 'bg-green-100 text-green-800'
                          : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
                          ? 'bg-[#E0F7F6] text-[#21C1B6]'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {getStatusDisplayText(processingStatus.status, progressPercentage)}
                    </div>
                  )}
                </div>
              </div>
            )}
            <UpgradePlanBanner className="mx-auto mt-4 mb-2 max-w-3xl w-full" />
            <form onSubmit={handleSend} className="mx-auto mt-2">
              <PromptChipsBar
                secrets={secrets}
                isLoading={isLoadingSecrets}
                selectedSecretId={selectedSecretId}
                activeLabel={isSecretPromptSelected ? activeDropdown : null}
                onSelect={(s) => handleDropdownSelect(s.name, s.id, s.llm_name)}
                disabled={isLoading || isGeneratingInsights}
                className="mb-1"
                onAddClick={() => setShowPromptBuilder(true)}
                customGroups={customPromptGroups}
                onSelectCustomPrompt={handleCustomPromptSelect}
                onDeleteCustomPrompt={handleDeleteCustomPrompt}
                onDeleteGroup={handleDeleteCustomGroup}
              />

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-5 py-4 sm:py-6 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                <UploadOptionsMenu
                  fileInputRef={fileInputRef}
                  isUploading={isUploading}
                  onLocalFileClick={() => fileInputRef.current?.click()}
                  onGoogleDriveUpload={handleGoogleDriveUpload}
                  isSplitView={false}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.flac,.ogg,.webm,.mp4,.m4a,.aac"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  multiple
                />
<div className="relative flex-shrink-0" ref={styleDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowStyleDropdown((prev) => !prev)}
                    className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                    title="Choose response style"
                  >
                    <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span>{learningModeActive ? 'Learning' : 'Normal'}</span>
                    <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
                  </button>
                  {showStyleDropdown && (
                    <div className="absolute bottom-full left-0 mb-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleStyleSelect('normal')}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStyleSelect('learning')}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Learning
                      </button>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  value={chatInput}
                  onChange={handleChatInputChange}
                  placeholder={getInputPlaceholder()}
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm sm:text-[15px] font-medium py-2 min-w-0 w-full sm:w-auto analysis-page-user-input"
                  disabled={isLoading || isGeneratingInsights}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                    isListening 
                      ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                      : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
                  }`}
                  disabled={isLoading || isGeneratingInsights || !fileId || isSecretPromptSelected}
                  title={isListening ? "Stop listening" : "Start voice input"}
                >
                  {isListening ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
                <button
                  type={sendButtonType}
                  disabled={isSendButtonDisabled}
                  onClick={handleSendButtonClick}
                  className={getSendButtonClassName()}
                  title={sendButtonTitle}
                >
                  {renderSendButtonIcon()}
                </button>
              </div>
              {isSecretPromptSelected && (
                <div className="mt-3 p-2 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
                  <div className="flex items-center space-x-2 text-sm text-[#21C1B6]">
                    <Bot className="h-4 w-4" />
                    <span>
                      Using analysis prompt: <strong>{activeDropdown}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSecretPromptSelected(false);
                        setActiveDropdown('Custom Query');
                        setSelectedSecretId(null);
                      }}
                      className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              {learningModeActive && (
                <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-full border border-[#21C1B6] bg-[#E0F7F6] text-[#11766f] text-xs font-medium">
                  <Sparkles className="h-3 w-3" />
                  <span>Learning mode active</span>
                  <button
                    type="button"
                    onClick={() => setLearningModeActive(false)}
                    className="text-[#11766f] hover:text-[#0e5f59]"
                    title="Disable learning mode"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </form>
            
            {fileSizeLimitError && (
              <div className="mt-2 animate-fadeIn">
                <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-1">Upload limit exceeded</p>
                      <p className="text-xs sm:text-sm text-gray-700 mb-2 leading-relaxed">
                        {fileSizeLimitError.message}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setFileSizeLimitError(null)}
                          className="px-3 py-1.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors text-xs font-medium"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => setFileSizeLimitError(null)}
                      className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
                      aria-label="Close"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
         
          {messages.length > 0 && (
            <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ height: '30vh', minHeight: '250px' }}>
              <div className="h-full flex flex-col">
                <div className="p-2 sm:p-3 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Recent Questions
                    </h2>
                    <span className="text-xs text-gray-500">{messages.length} question{messages.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
               
                <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {messages.slice(0, 9).map((msg, i) => (
                      <div
                        key={msg.id || i}
                        onClick={() => {
                          handleMessageClick(msg);
                          setShowSplitView(true);
                        }}
                        className="p-2 sm:p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-[#E0F7F6] hover:border-[#21C1B6] cursor-pointer transition-all duration-200 hover:shadow-md"
                      >
                        <p className="text-xs sm:text-sm font-medium text-gray-900 line-clamp-2 mb-1">
                          {msg.display_text_left_panel || msg.question}
                        </p>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="truncate">{formatDate(msg.timestamp || msg.created_at)}</span>
                          <ChevronRight className="h-3 w-3 flex-shrink-0 ml-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                 
                  {messages.length > 9 && (
                    <div className="mt-2 text-center">
                      <button
                        onClick={() => setShowSplitView(true)}
                        className="text-xs text-[#21C1B6] hover:text-[#1AA49B] font-medium"
                      >
                        View all {messages.length} questions →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (


        <>
          <div className="w-full lg:w-2/5 border-r-0 lg:border-r border-b lg:border-b-0 border-gray-200 flex flex-col bg-white h-1/3 lg:h-full">
            <div className="p-2 sm:p-3 border-b border-black border-opacity-20">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <h2 className="text-sm sm:text-base font-semibold text-gray-900">Questions</h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowMergeModal(true)}
                    disabled={!messages.some((m) => String(m.answer || '').trim())}
                    className="px-3 py-1 text-xs font-medium text-[#21C1B6] hover:text-[#1AA49B] hover:bg-[#E0F7F6] rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Select answers and merge them into a single document"
                  >
                    Merge & Export
                  </button>
                  <button
                    onClick={startNewChat}
                    className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    New Chat
                  </button>
                </div>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
                />
              </div>
            </div>
            <DocumentList
              uploadedDocuments={uploadedDocuments}
              fileId={fileId}
              setFileId={setFileId}
              setDocumentData={setDocumentData}
              setProcessingStatus={setProcessingStatus}
              setProgressPercentage={setProgressPercentage}
              startProcessingStatusPolling={startProcessingStatusPolling}
              formatFileSize={formatFileSize}
              getStatusDisplayText={getStatusDisplayText}
              getStageColor={getStageColor}
              onProgressBarClick={() => setShowProgressPopup(true)}
            />
            {showProgressPopup && (
              <div className="px-3 pb-2">
                <ProgressStagesPopup
                  isOpen={showProgressPopup}
                  onClose={() => setShowProgressPopup(false)}
                  processingStatus={processingStatus}
                  progressPercentage={progressPercentage}
                  documentName={documentData?.originalName || 'Document'}
                />
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto px-3 py-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
              <div className="space-y-1.5">
                <MessagesList
              messages={messages}
              selectedMessageId={selectedMessageId}
              handleMessageClick={handleMessageClick}
              displayLimit={displayLimit}
              showAllChats={showAllChats}
              setShowAllChats={setShowAllChats}
              highlightText={highlightText}
              formatDate={formatDate}
              searchQuery={searchQuery}
            />
              </div>
            </div>
            <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0">
              {documentData && (
                <div className="mb-2 p-1.5 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-1.5">
                    <FileCheck className="h-3 w-3 text-green-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{documentData.originalName}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(documentData.size)}</p>
                    </div>
                    {processingStatus && (
                      <div
                        className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          processingStatus.status === 'processed' && progressPercentage >= 100
                            ? 'bg-green-100 text-green-800'
                            : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
                            ? 'bg-[#E0F7F6] text-[#21C1B6]'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {getStatusDisplayText(processingStatus.status, progressPercentage)}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <UpgradePlanBanner className="mb-2" />
              <form onSubmit={handleSend}>
                  <PromptChipsBar
                    secrets={secrets}
                    isLoading={isLoadingSecrets}
                    selectedSecretId={selectedSecretId}
                    activeLabel={isSecretPromptSelected ? activeDropdown : null}
                    onSelect={(s) => handleDropdownSelect(s.name, s.id, s.llm_name)}
                    disabled={isLoading || isGeneratingInsights}
                    size="compact"
                    className="mb-1"
                    onAddClick={() => setShowPromptBuilder(true)}
                    customGroups={customPromptGroups}
                    onSelectCustomPrompt={handleCustomPromptSelect}
                    onDeleteCustomPrompt={handleDeleteCustomPrompt}
                    onDeleteGroup={handleDeleteCustomGroup}
                  />
                <div className="flex items-center space-x-1.5 bg-gray-50 rounded-xl px-2.5 py-2 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                  <UploadOptionsMenu
                    fileInputRef={fileInputRef}
                    isUploading={isUploading}
                    onLocalFileClick={() => fileInputRef.current?.click()}
                    onGoogleDriveUpload={handleGoogleDriveUpload}
                    isSplitView={true}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.flac,.ogg,.webm,.mp4,.m4a,.aac"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    multiple
                  />
<div className="relative flex-shrink-0" ref={styleDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowStyleDropdown((prev) => !prev)}
                      className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                      title="Choose response style"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>{learningModeActive ? 'Learning' : 'Normal'}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showStyleDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleStyleSelect('normal')}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStyleSelect('learning')}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Learning
                        </button>
                      </div>
                    )}
                  </div>
                <input
                  type="text"
                  value={chatInput}
                  onChange={handleChatInputChange}
                  placeholder={getInputPlaceholder()}
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-xs font-medium py-1 min-w-0 analysis-page-user-input"
                  disabled={isLoading || isGeneratingInsights}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-1.5 rounded-full transition-all duration-300 flex-shrink-0 ${
                    isListening 
                      ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                      : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
                  }`}
                  disabled={isLoading || isGeneratingInsights || !fileId || isSecretPromptSelected}
                  title={isListening ? "Stop listening" : "Start voice input"}
                >
                  {isListening ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </button>
                  <button
                    type={sendButtonType}
                    disabled={isSendButtonDisabled}
                    onClick={handleSendButtonClick}
                    className={getSendButtonClassName('small')}
                    title={sendButtonTitle}
                  >
                    {renderSendButtonIcon('small')}
                  </button>
                </div>
                {isSecretPromptSelected && (
                  <div className="mt-1.5 p-1.5 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
                    <div className="flex items-center space-x-1.5 text-xs text-[#21C1B6]">
                      <Bot className="h-3 w-3" />
                      <span>
                        Using: <strong>{activeDropdown}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSecretPromptSelected(false);
                          setActiveDropdown('Custom Query');
                          setSelectedSecretId(null);
                        }}
                        className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
                {learningModeActive && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-[#21C1B6] bg-[#E0F7F6] text-[#11766f] text-xs font-medium">
                    <Sparkles className="h-3 w-3" />
                    <span>Learning active</span>
                    <button
                      type="button"
                      onClick={() => setLearningModeActive(false)}
                      className="text-[#11766f] hover:text-[#0e5f59]"
                      title="Disable learning mode"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>

          <div className="w-full lg:w-3/5 flex flex-col h-2/3 lg:h-full bg-gray-50">
            <div className="flex-1 p-2 sm:p-4 min-h-0">
              <div className="h-full">
                <DocumentViewer
                  selectedMessageId={selectedMessageId}
                  currentResponse={currentResponse}
                  animatedResponseContent={animatedResponseContent}
                  messages={messages}
                  handleCopyResponse={handleCopyResponse}
                  markdownOutputRef={markdownOutputRef}
                  isAnimatingResponse={isAnimatingResponse}
                  showResponseImmediately={showResponseImmediately}
                  formatDate={formatDate}
                  markdownComponents={markdownComponents}
                  responseContainerRef={responseRef}
                  onRetryMessage={handleRetryMessage}
                  retryDisabled={isLoading || isGeneratingInsights}
                />
              </div>
            </div>
          </div>
        </>
      )}

      <CustomPromptBuilderModal
        isOpen={showPromptBuilder}
        onClose={() => setShowPromptBuilder(false)}
        groups={customPromptGroups}
        onSaved={() => loadCustomPromptGroups()}
      />

      <MergeAnswersModal
        isOpen={showMergeModal}
        onClose={() => setShowMergeModal(false)}
        messages={messages}
        defaultTitle={
          documentData?.originalName
            ? `${documentData.originalName.replace(/\.[^.]+$/, '')} — Merged Analysis`
            : activeFolderName
              ? `${activeFolderName.replace(/_/g, ' ')} — Merged Analysis`
              : 'Merged Legal Analysis'
        }
        sourceName={documentData?.originalName || (activeFolderName ? activeFolderName.replace(/_/g, ' ') : null)}
      />
    </div>
  );
};

export default AnalysisPage;

