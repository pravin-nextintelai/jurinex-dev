import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Reorder } from "framer-motion";
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  PencilIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
  DocumentCheckIcon,
  PlusIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import {
  getDraft,
  getTemplateUserFieldValues,
  updateDraftFields,
  saveTemplateUserFieldValues,
  attachCaseToDraft,
  uploadDocumentForDraft,
  uploadDocumentsForDraft,
  getDraftJobStatus,
  setUploadedFileNameInDraft,
  linkFileToDraft,
  renameDraft,
  getTemplate,
  getTemplateSections,
  getTemplateFields,
  getUniversalSections,
  saveDraftUiState
} from '../api/draftFormApi';
import documentApi from '@/shared/api/documentApi';
import { toast } from 'react-toastify';
import { draftApi } from '@/features/template-drafting/services';
import { TEMPLATE_DRAFTING_ROUTES } from '@/features/template-drafting/routePaths'
import { SectionDraftingPage } from '@/features/template-drafting/pages/SectionDraftingPage';
import { AssembledPreviewPage } from '@/features/template-drafting/pages/AssembledPreviewPage';
import { TemplateWizardGallery } from '../components/TemplateWizard';
import DraftingLayout from '../components/DraftingRedesign/DraftingLayout';
import { createChatDraftSession, exportChatDraftDocx } from '../api/chatDraftApi';
import googleDriveApi from '@/shared/api/googleDriveApi';
import { AGENT_DRAFT_TEMPLATE_API, CHAT_DRAFT_BACKEND_URL, getUserIdForDrafting } from '@/config/apiConfig';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';
import html2pdf from 'html2pdf.js';

/* ─── Chat-draft streaming helper ───────────────────────────────────── */
async function streamChatDraftMessage(sessionId, message, onChunk, signal) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const userId = getUserIdForDrafting();
  if (userId) headers['X-User-Id'] = userId;

  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/session/${sessionId}/message-stream`, {
    method: 'POST', headers, body: JSON.stringify({ message }), signal,
  });
  if (!res.ok) await throwIfQuotaResponse(res, `HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          if (json.html_chunk) onChunk(json.html_chunk, false);
          if (json.html) onChunk(json.html, true);
        } catch (_) {}
      }
    }
  }
}

/* ─── Extract HTML from template API response ────────────────────────── */
function extractTemplateHtmlFromResponse(template) {
  const c = template?.content;
  if (!c) return '';
  if (c.fallback_html?.pages?.length) return c.fallback_html.pages.map(p => p.html || '').join('\n\n');
  if (c.structured?.pages?.length) return c.structured.pages.flatMap(p => (p.blocks || []).map(b => b.content?.value || b.content?.label || '')).join('\n');
  if (c.blocks?.length) return c.blocks.map(b => b.content?.value || b.content?.label || '').join('\n');
  return '';
}

/* ─── Inline CSS for embedded chat UI ───────────────────────────────── */
const CHAT_CSS = `
  @keyframes _spin { to { transform:rotate(360deg) } }
  @keyframes _dot { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
  @keyframes _blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .cd-cursor::after { content:'▋'; display:inline-block; animation:_blink .7s infinite; color:#21C1B6; margin-left:2px; font-size:.85em; }
  .cd-paper { font-family:'Georgia','Times New Roman',serif; color:#111; }
  .cd-paper h1 { font-size:1.25em;font-weight:700;text-align:center;margin:0 0 .9em;text-transform:uppercase;letter-spacing:.05em;line-height:1.4 }
  .cd-paper h2 { font-size:1.05em;font-weight:700;margin:1.3em 0 .45em;text-transform:uppercase;letter-spacing:.03em }
  .cd-paper h3 { font-size:.98em;font-weight:700;margin:1em 0 .35em }
  .cd-paper p  { margin:.55em 0;line-height:1.88;text-align:justify }
  .cd-paper ul,ol { padding-left:1.6em;margin:.45em 0 }
  .cd-paper li { margin:.25em 0;line-height:1.78 }
  .cd-paper table { width:100%;border-collapse:collapse;margin:1em 0;font-size:.92em }
  .cd-paper th { background:#f9fafb;font-weight:700;padding:.5em .7em;border:1px solid #e5e7eb }
  .cd-paper td { padding:.45em .7em;border:1px solid #e5e7eb;vertical-align:top }
  .cd-paper strong { font-weight:700 }
  .cd-paper em { font-style:italic }
  .cd-paper hr { border:none;border-top:1.5px solid #e5e7eb;margin:1.4em 0 }
  .cd-scroll::-webkit-scrollbar { width:4px }
  .cd-scroll::-webkit-scrollbar-thumb { background:#e5e7eb;border-radius:2px }
`;

const DRAFT_STEPS = [
  { id: 'initialization', label: 'Initialization' },
  { id: 'form_inputs', label: 'Form Inputs' },
  { id: 'section_config', label: 'Section Config' },
  { id: 'validation', label: 'Validation' },
  { id: 'review', label: 'Review' },
  { id: 'assembly', label: 'Assembly' },
];

const AUTO_SAVE_DELAY_MS = 1500;

// Indian Languages for draft generation
const INDIAN_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi (हिंदी)' },
  { code: 'bn', name: 'Bengali (বাংলা)' },
  { code: 'te', name: 'Telugu (తెలుగు)' },
  { code: 'mr', name: 'Marathi (मराठी)' },
  { code: 'ta', name: 'Tamil (தமிழ்)' },
  { code: 'gu', name: 'Gujarati (ગુજરાતી)' },
  { code: 'kn', name: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', name: 'Malayalam (മലയാളം)' },
  { code: 'pa', name: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'or', name: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'as', name: 'Assamese (অসমীয়া)' },
  { code: 'ur', name: 'Urdu (اردو)' },
  { code: 'sa', name: 'Sanskrit (संस्कृत)' }
];

// Detail levels for each section
const DETAIL_LEVELS = [
  { value: 'detailed', label: 'Detailed', description: 'Comprehensive and thorough' },
  { value: 'concise', label: 'Concise', description: 'Balanced and clear' },
  { value: 'short', label: 'Short', description: 'Brief and to the point' }
];

const normalizeTemplateField = (field, index = 0) => {
  if (!field || typeof field !== 'object') return null;

  const fieldName = String(
    field.field_name ||
    field.key ||
    field.field_id ||
    field.id ||
    ''
  ).trim();

  if (!fieldName) return null;

  const fieldLabel = String(
    field.field_label ||
    field.label ||
    field.field_name ||
    field.field_id ||
    field.key ||
    `Field ${index + 1}`
  ).trim();

  const fieldType = String(
    field.field_type ||
    field.type ||
    'text'
  ).trim().toLowerCase();

  const fieldGroup = String(
    field.field_group ||
    field.section_name ||
    field.section_id ||
    field.group ||
    'Details'
  ).trim();

  return {
    ...field,
    field_id: String(field.field_id || field.id || fieldName),
    field_name: fieldName,
    field_label: fieldLabel,
    field_type: fieldType === 'string' ? 'text' : fieldType,
    field_group: fieldGroup || 'Details',
    required: Boolean(
      field.required ??
      field.is_required ??
      false
    ),
    placeholder: field.placeholder || field.description || '',
  };
};

const normalizeTemplateFields = (fields) => {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => normalizeTemplateField(field, index))
    .filter(Boolean);
};

const normalizeTemplateSectionsForConfig = (sections) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section, index) => {
      if (!section || typeof section !== 'object') return null;
      const id = String(
        section.section_id ||
        section.id ||
        section.section_key ||
        `section_${index}`
      );
      const title = String(
        section.section_name ||
        section.title ||
        section.name ||
        section.section_key ||
        `Section ${index + 1}`
      );
      return {
        id,
        title,
        description: section.section_purpose || section.description || '',
        defaultPrompt: section.default_prompt || section.section_intro || '',
        subItems: [],
        isFromTemplate: true,
      };
    })
    .filter(Boolean);
};

const buildAssembledResumePayload = (draftMetadata) => {
  const assembledCache = draftMetadata?.assembled_cache;
  if (!assembledCache?.final_document) return null;

  return {
    success: true,
    final_document: assembledCache.final_document,
    template_css: assembledCache.template_css || '',
    google_docs: assembledCache.metadata?.google_docs,
    metadata: assembledCache.metadata || {},
  };
};

const DraftFormPage = () => {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { showQuotaError } = useTokenQuota();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initial step from URL so refresh keeps you on the same page (e.g. ?step=3 = Configure Sections)
  const stepFromUrl = parseInt(searchParams.get('step'), 10);
  const initialStep = (!Number.isNaN(stepFromUrl) && stepFromUrl >= 1 && stepFromUrl <= 6) ? stepFromUrl : 1;

  // -- STATE --
  const [draft, setDraft] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastSaved, setLastSaved] = useState(null);

  // Autosave refs
  const skipNextAutoSaveRef = useRef(true);
  const hasUserEditedRef = useRef(false);
  const fieldValuesRef = useRef(fieldValues);
  const fileInputRef = useRef(null);
  fieldValuesRef.current = fieldValues;
  const autopopulatePollRef = useRef(null);

  // Case / File State
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [attachCaseLoading, setAttachCaseLoading] = useState(false);
  const [uploadFileLoading, setUploadFileLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState(null); // legacy single-name display
  const [uploadedDocuments, setUploadedDocuments] = useState([]); // { name, status: 'uploading'|'success'|'failed', fileId? }[]
  const [attachedCaseTitle, setAttachedCaseTitle] = useState(null);
  const [isAutopopulatingFields, setIsAutopopulatingFields] = useState(false);
  const [autopopulationFilledCount, setAutopopulationFilledCount] = useState(0);

  // Steps (initial from URL so refresh preserves current step)
  const [currentStep, setCurrentStepState] = useState(initialStep);

  // When step changes, update URL so refresh keeps you on same step
  const setCurrentStep = (nextStep) => {
    setCurrentStepState(nextStep);
    setSearchParams({ step: String(nextStep) }, { replace: true });
  };
  const [subStepId, setSubStepId] = useState('inputs'); // 'inputs' or 'sections' for Step 3 prodigy flow
  const [deletedSections, setDeletedSections] = useState(new Set());
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Language and Detail Level
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [sectionDetailLevels, setSectionDetailLevels] = useState({});

  // Method selection modal (shown once on first load of step 1)
  const [showMethodModal, setShowMethodModal] = useState(() => {
    // Don't show modal if method was already chosen (restored from localStorage)
    if (!draftId) return true;
    try { const saved = JSON.parse(localStorage.getItem(`chat_draft_${draftId}`) || 'null'); return !saved?.draftMethod; } catch { return true; }
  });
  const [draftMethod, setDraftMethod] = useState(() => {
    if (!draftId) return null;
    try { return JSON.parse(localStorage.getItem(`chat_draft_${draftId}`) || 'null')?.draftMethod ?? null; } catch { return null; }
  }); // null | 'automatic' | 'custom'

  // Automatic mode — local file collection (not uploaded to server)
  const [autoLocalFiles, setAutoLocalFiles] = useState([]);
  const autoFileInputRef = useRef(null);

  // Automatic mode — embedded chat state (restored from localStorage per draftId)
  const _chatStorageKey = draftId ? `chat_draft_${draftId}` : null;
  const _chatSaved = useMemo(() => {
    if (!_chatStorageKey) return null;
    try { return JSON.parse(localStorage.getItem(_chatStorageKey) || 'null'); } catch { return null; }
  }, [_chatStorageKey]);

  const [chatPhase, setChatPhase] = useState(() => _chatSaved?.chatPhase ?? false);
  const [chatTemplateText, setChatTemplateText] = useState(() => _chatSaved?.chatTemplateText ?? '');
  const [chatTemplateLoading, setChatTemplateLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(() => _chatSaved?.chatSessionId ?? '');
  const [chatMessages, setChatMessages] = useState(() => _chatSaved?.chatMessages ?? []);
  const [chatInput, setChatInput] = useState('');
  const [chatStreamingHtml, setChatStreamingHtml] = useState('');
  const [chatLatestHtml, setChatLatestHtml] = useState(() => _chatSaved?.chatLatestHtml ?? '');
  const [chatIsSending, setChatIsSending] = useState(false);
  const [chatIsCreating, setChatIsCreating] = useState(false);
  const [chatDocPanelOpen, setChatDocPanelOpen] = useState(() => !!(_chatSaved?.chatLatestHtml));
  const [chatError, setChatError] = useState('');
  const [chatWarnings, setChatWarnings] = useState([]);
  const [chatCopied, setChatCopied] = useState(false);
  const [chatGoogleDocsOpen, setChatGoogleDocsOpen] = useState(false);
  const [chatRealGoogleDocsUrl, setChatRealGoogleDocsUrl] = useState(() => _chatSaved?.chatRealGoogleDocsUrl ?? '');
  const [chatGoogleDocsFileId, setChatGoogleDocsFileId] = useState(() => _chatSaved?.chatGoogleDocsFileId ?? '');
  const [chatGoogleDocsUploading, setChatGoogleDocsUploading] = useState(false);
  const [chatDocSidebarOffset, setChatDocSidebarOffset] = useState(0);
  const chatAbortRef = useRef(null);
  const chatTaRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatIframeRef = useRef(null);

  // Persist chat state to localStorage whenever key values change
  useEffect(() => {
    if (!_chatStorageKey) return;
    const snapshot = { chatPhase, chatTemplateText, chatSessionId, chatMessages, chatLatestHtml, draftMethod, chatGoogleDocsFileId, chatRealGoogleDocsUrl };
    try { localStorage.setItem(_chatStorageKey, JSON.stringify(snapshot)); } catch (_) {}
  }, [_chatStorageKey, chatPhase, chatTemplateText, chatSessionId, chatMessages, chatLatestHtml, draftMethod, chatGoogleDocsFileId, chatRealGoogleDocsUrl]);

  // Persist resume state in backend so "Recent documents" opens at the same workflow state.
  useEffect(() => {
    if (!draftId) return;
    const timer = setTimeout(() => {
      saveDraftUiState(draftId, {
        current_step: currentStep,
        sub_step_id: subStepId,
        draft_method: draftMethod || null,
        chat_phase: Boolean(chatPhase),
        chat_session_id: chatSessionId || null,
        chat_has_output: Boolean(chatLatestHtml || chatStreamingHtml),
      }).catch((err) => {
        console.warn('[DraftFormPage] Failed to persist UI state:', err?.message || err);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [draftId, currentStep, subStepId, draftMethod, chatPhase, chatSessionId, chatLatestHtml, chatStreamingHtml]);

  // Rename modal
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [renamingDraft, setRenamingDraft] = useState(false);
  const [orderedSections, setOrderedSections] = useState([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [templateSections, setTemplateSections] = useState([]);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause' });
  const [isGoogleDocsActive, setIsGoogleDocsActive] = useState(false);
  const [lastAssembleResult, setLastAssembleResult] = useState(null);
  const [sectionsFinalizedAt, setSectionsFinalizedAt] = useState(0);

  // Clear lastAssembleResult when draft changes so new draft's preview loads correctly
  useEffect(() => {
    setLastAssembleResult(null);
  }, [draftId]);

  // Agent activity feed mock/state
  const [activities, setActivities] = useState([
    {
      id: 1,
      agentName: 'System',
      type: 'System',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action: 'Initializing draft and awaiting case context.',
      status: 'completed'
    }
  ]);

  // -- EFFECTS --

  // Auto-reset isGoogleDocsActive when navigating steps
  useEffect(() => {
    if (currentStep !== 6) {
      setIsGoogleDocsActive(false);
    }
  }, [currentStep]);

  useEffect(() => {
    let cancelled = false;
    hasUserEditedRef.current = false;
    const load = async () => {
      if (!draftId) return;
      try {
        setLoading(true);
        skipNextAutoSaveRef.current = true;

        // Load draft and section prompts in parallel
        const [res, sectionsData] = await Promise.all([
          getDraft(draftId),
          draftApi.getSectionPrompts(draftId).catch(err => {
            console.warn('Failed to fetch section prompts', err);
            return [];
          }),
        ]);

        if (!cancelled && res?.success && res?.draft) {
          const d = res.draft;
          // Fetch full template (fields, sections, preview) so we have all form fields from DB
          let dbSections = [];
          let templateFields = normalizeTemplateFields(d.fields);
          if (d.template_id) {
            try {
              const templateRes = await getTemplate(d.template_id);
              if (templateRes?.success && templateRes?.template) {
                const t = templateRes.template;
                dbSections = Array.isArray(t.sections) ? t.sections : [];
                const normalizedTemplateFields = normalizeTemplateFields(t.fields);
                // Prefer the richer field schema when template API returns more fields than the draft payload.
                if (
                  normalizedTemplateFields.length > 0 &&
                  (
                    !Array.isArray(d.fields) ||
                    d.fields.length === 0 ||
                    normalizedTemplateFields.length > templateFields.length
                  )
                ) {
                  templateFields = normalizedTemplateFields;
                }
              }
            } catch (err) {
              console.warn('Failed to fetch template (sections/fields)', err);
            }

            if (templateFields.length === 0) {
              try {
                const fieldsRes = await getTemplateFields(d.template_id);
                const fallbackFields = normalizeTemplateFields(fieldsRes?.fields);
                if (fallbackFields.length > 0) {
                  templateFields = fallbackFields;
                }
              } catch (err) {
                console.warn('Failed to fetch fallback template fields', err);
              }
            }
          }
          setDraft({ ...d, fields: templateFields ?? d.fields });
          setTemplateSections(dbSections);

          // Convert DB sections to the format expected by the UI.
          // Use section_prompts (default_prompt) for AI instructions, NOT section_intro (short description).
          let baseSections = normalizeTemplateSectionsForConfig(dbSections);

          // Fallback 1: fetch dedicated template sections endpoint (more consistent shape)
          if (baseSections.length === 0 && d.template_id) {
            try {
              const templateSectionsRes = await getTemplateSections(d.template_id);
              const fetchedSections = Array.isArray(templateSectionsRes?.sections)
                ? templateSectionsRes.sections
                : [];
              if (fetchedSections.length > 0) {
                baseSections = normalizeTemplateSectionsForConfig(fetchedSections);
                setTemplateSections(fetchedSections);
              }
            } catch (err) {
              console.warn('Failed to fetch template sections fallback', err);
            }
          }

          // Fallback 2: use universal sections if template-level sections are unavailable
          if (baseSections.length === 0) {
            try {
              const universalRes = await getUniversalSections();
              const universalSections = Array.isArray(universalRes?.sections)
                ? universalRes.sections
                : [];
              baseSections = normalizeTemplateSectionsForConfig(universalSections);
            } catch (err) {
              console.warn('Failed to fetch universal sections fallback', err);
            }
          }

          // Populate sections
          const deletedSet = new Set();
          const detailMap = {};
          const orderMap = {};
          let lang = d.metadata?.draft_language || 'en';

          const promptsRows = Array.isArray(sectionsData)
            ? sectionsData
            : (Array.isArray(sectionsData?.prompts) ? sectionsData.prompts : []);

          if (Array.isArray(promptsRows)) {
            promptsRows.forEach(p => {
              if (p.is_deleted) deletedSet.add(p.section_id);
              if (p.detail_level) detailMap[p.section_id] = p.detail_level;
              if (p.language) lang = p.language;
              if (p.sort_order !== undefined) orderMap[p.section_id] = p.sort_order;
            });
          }

          // Section prompts stay backend-only - not fetched or displayed on frontend
          setDeletedSections(deletedSet);
          setSectionDetailLevels(detailMap);
          setSelectedLanguage(lang);

          const assembledResumePayload = buildAssembledResumePayload(d.metadata);
          const hasExplicitStep = searchParams.has('step');
          const uiState = (d.metadata?.ui_state && typeof d.metadata.ui_state === 'object')
            ? d.metadata.ui_state
            : {};

          if (uiState.sub_step_id === 'inputs' || uiState.sub_step_id === 'sections') {
            setSubStepId(uiState.sub_step_id);
          }

          if (!draftMethod && (uiState.draft_method === 'automatic' || uiState.draft_method === 'custom')) {
            setDraftMethod(uiState.draft_method);
            setShowMethodModal(false);
          }

          if (!_chatSaved?.chatPhase && uiState.chat_phase === true) {
            setChatPhase(true);
            setShowMethodModal(false);
            if (!chatSessionId && uiState.chat_session_id) {
              setChatSessionId(String(uiState.chat_session_id));
            }
            if (uiState.chat_has_output) {
              setChatDocPanelOpen(true);
            }
          }

          if (assembledResumePayload) {
            setLastAssembleResult(assembledResumePayload);
            if (!hasExplicitStep) {
              setCurrentStep(6);
              console.log('[DraftFormPage] Resuming completed draft in assembled editor view');
            }
          } else if (!hasExplicitStep) {
            const resumedStep = Number(uiState.current_step);
            if (Number.isFinite(resumedStep) && resumedStep >= 1 && resumedStep <= 6) {
              setCurrentStep(resumedStep);
              console.log(`[DraftFormPage] Resuming draft at step ${resumedStep} from metadata.ui_state`);
            }
          }

          // Identify custom sections added by user (not in template)
          const templateSectionIds = new Set(baseSections.map(s => s.id));
          const customSections = [];

          if (Array.isArray(promptsRows)) {
            promptsRows.forEach(p => {
              if (!templateSectionIds.has(p.section_id) && !p.is_deleted) {
                customSections.push({
                  id: p.section_id,
                  title: p.section_name || 'Custom Section',
                  description: p.section_type || 'Custom',
                  defaultPrompt: '',
                  isCustom: true
                });
              }
            });
          }

          // Combine template sections with custom sections
          const allSectionsCombined = [...baseSections, ...customSections];

          // Sort sections by order_index or sort_order
          const sorted = allSectionsCombined.sort((a, b) => {
            const oa = orderMap[a.id];
            const ob = orderMap[b.id];
            if (oa !== undefined && ob !== undefined) return oa - ob;

            // If one has order and other doesn't, prioritize one with order
            const ia = baseSections.findIndex(s => s.id === a.id);
            const ib = baseSections.findIndex(s => s.id === b.id);

            // If both are from template, use original order
            if (ia !== -1 && ib !== -1) return ia - ib;

            // If custom sections don't have order, put them at end
            if (oa !== undefined) return -1;
            if (ob !== undefined) return 1;

            return 0;
          });
          setOrderedSections(sorted);

          const isFresh = d.metadata?.is_fresh === true;

          // Hydrate fields - merge from getDraft (backend) + getTemplateUserFieldValues (InjectionAgent) for reliable autopopulation
          const raw = d.field_values;
          let saved = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};

          // Also fetch template_user_field_values (InjectionAgent) and merge - backend merge can miss when agent writes async
          // Agent values go underneath — user-saved values take precedence
          if (d.template_id) {
            try {
              const tvRes = await getTemplateUserFieldValues(String(d.template_id), draftId);
              if (tvRes?.field_values && typeof tvRes.field_values === 'object') {
                // Only apply filled agent values, never overwrite user-saved values with null
                const agentFilled = Object.fromEntries(
                  Object.entries(tvRes.field_values).filter(([, v]) => v != null && String(v).trim() !== '')
                );
                if (Object.keys(agentFilled).length > 0) {
                  saved = { ...agentFilled, ...saved }; // user-saved values win
                }
              }
            } catch (_) {}
          }

          if (isFresh) {
            console.log('[DraftFormPage] Fresh template - loaded agent-extracted values if available');
            console.log(`[DraftFormPage] Found ${Object.keys(saved).length} field values`);
          } else {
            console.log(`[DraftFormPage] Loaded ${Object.keys(saved).length} saved field values`);
          }

          setFieldValues(saved);

          // Load case/file metadata
          const caseId = d.metadata?.case_id;
          if (caseId) {
            setSelectedCaseId(caseId);
            setAttachedCaseTitle(d.metadata?.case_title || `Case ${caseId}`);
          }
          setUploadedFileName(d.metadata?.uploaded_file_name ?? null);
          // Restore uploaded documents list so user sees them after refresh
          const names = d.metadata?.uploaded_file_names;
          const ids = d.metadata?.uploaded_file_ids;
          if (Array.isArray(names) && names.length > 0) {
            setUploadedDocuments(
              names.map((name, i) => ({
                name: name || `Document ${i + 1}`,
                status: 'success',
                fileId: Array.isArray(ids) ? ids[i] : undefined,
              }))
            );
          } else if (d.metadata?.uploaded_file_name) {
            setUploadedDocuments([
              { name: d.metadata.uploaded_file_name, status: 'success' },
            ]);
          } else {
            setUploadedDocuments([]);
          }

          if (d.updated_at) setLastSaved(new Date(d.updated_at));
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err.message || 'Failed to load draft');
          navigate('/draft-selection');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [draftId, navigate, searchParams, draftMethod, chatSessionId, _chatSaved?.chatPhase]);


  // Initialize Section Prompts map when fields change (if needed)
  const fields = useMemo(() => normalizeTemplateFields(draft?.fields), [draft?.fields]);
  const sections = useMemo(() => {
    const order = [];
    const map = {};
    fields.forEach((f) => {
      const key = (
        f.field_group ||
        f.section_name ||
        f.section_id ||
        'Details'
      );
      const normalizedKey = String(key).trim() || 'Details';
      if (!map[normalizedKey]) {
        map[normalizedKey] = [];
        order.push(normalizedKey);
      }
      map[normalizedKey].push(f);
    });
    return order.map((sectionName) => ({ sectionName, fields: map[sectionName] }));
  }, [fields]);

  // Auto-Save
  useEffect(() => {
    if (!draftId || !draft) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    if (!hasUserEditedRef.current) return;

    const timer = setTimeout(async () => {
      try {
        setSaving(true);
        await updateDraftFields(draftId, fieldValues, Object.keys(fieldValues));
        setLastSaved(new Date());
      } catch (err) {
        toast.error('Auto-save failed');
      } finally {
        setSaving(false);
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftId, draft, fieldValues]);


  // -- HANDLERS --

  const addActivity = (agent, action, status = 'in-progress') => {
    const typeMap = {
      Librarian: 'Search',
      Gemini: 'LLM',
      Drafter: 'GenAI',
      Citation: 'GenAI',
      Critic: 'LLM',
      Assembler: 'Assembly',
      Orchestrator: 'Orchestrator',
      System: 'System'
    };
    setActivities(prev => {
      const updatedPrev = prev.map(act =>
        act.status === 'in-progress' ? { ...act, status: 'completed' } : act
      );
      return [{
        id: Date.now() + Math.random(),
        agentName: agent,
        type: typeMap[agent] || 'Agent',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        action,
        status
      }, ...updatedPrev];
    });
  };

  const handleTemplateClick = async (template) => {
    // For now, just show a toast if they try to change template
    toast.info(`Template "${template.title}" selected. Context updated.`);
    addActivity('Orchestrator', `Updated template to ${template.title}`, 'completed');
    setCurrentStep(2);
  };

  const fetchCases = async () => {
    if (cases.length > 0) return;
    setCasesLoading(true);
    try {
      const res = await documentApi.getCases();
      const list = res?.cases ?? res?.data ?? (Array.isArray(res) ? res : []);
      setCases(list);
    } catch (err) {
      toast.error('Failed to load cases');
    } finally {
      setCasesLoading(false);
    }
  };

  // Poll for autopopulated form fields (InjectionAgent) and update form as soon as data is available
  const pollForAutopopulatedFields = (draftIdParam, templateIdParam, onApplied) => {
    if (autopopulatePollRef.current) clearInterval(autopopulatePollRef.current);
    setIsAutopopulatingFields(true);
    setAutopopulationFilledCount(0);
    const POLL_INTERVAL_MS = 2000;
    const MAX_ATTEMPTS = 30; // 60 seconds total — agent can take time on large docs
    let attempts = 0;
    const intervalId = setInterval(async () => {
      attempts++;
      try {
        let fromTemplate = {};
        let extractionStatus = null;
        if (templateIdParam) {
          try {
            const tvRes = await getTemplateUserFieldValues(templateIdParam, draftIdParam);
            if (tvRes?.field_values && typeof tvRes.field_values === 'object') {
              fromTemplate = tvRes.field_values;
            }
            extractionStatus = tvRes?.extraction_status || null;
          } catch (_) {}
        }

        // Only count values that are actually filled (not null / empty string)
        const filledFromTemplate = Object.entries(fromTemplate).filter(
          ([, v]) => v != null && String(v).trim() !== ''
        );

        // Update live counter on every tick so the UI reflects progress
        setAutopopulationFilledCount(filledFromTemplate.length);

        // Stop polling once the backend reaches a terminal state.
        const terminalStatuses = ['completed', 'partial', 'failed', 'terminated'];
        const agentDone = terminalStatuses.includes(String(extractionStatus || '').toLowerCase());
        const hasFilled = filledFromTemplate.length > 0;

        if (agentDone) {
          clearInterval(intervalId);
          autopopulatePollRef.current = null;
          setIsAutopopulatingFields(false);

          if (hasFilled) {
            // Merge: keep user-edited values on top, overlay agent values beneath
            const merged = { ...fromTemplate, ...fieldValuesRef.current };
            setFieldValues(merged);
            await updateDraftFields(draftIdParam, merged, Object.keys(merged));
            if (templateIdParam) {
              try {
                await saveTemplateUserFieldValues(templateIdParam, merged, Object.keys(merged), draftIdParam);
              } catch (e) { /* non-blocking */ }
            }
            toast.success(`Form auto-filled: ${filledFromTemplate.length} field(s) populated.`);
          } else if (String(extractionStatus || '').toLowerCase() === 'failed') {
            toast.error('Field extraction failed. You can still continue and fill fields manually.');
          } else {
            toast.info('Field extraction finished. You can continue and complete any remaining fields manually.');
          }
          if (onApplied) onApplied();
        }
      } catch (_) {}
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(intervalId);
        autopopulatePollRef.current = null;
        setIsAutopopulatingFields(false);
        toast.info('Field fetching timed out. You can continue manually.');
      }
    }, POLL_INTERVAL_MS);
    autopopulatePollRef.current = intervalId;
  };

  useEffect(() => {
    return () => {
      if (autopopulatePollRef.current) clearInterval(autopopulatePollRef.current);
    };
  }, []);

  // When draft has case/file but fields are empty, poll for agent-extracted values (InjectionAgent runs async)
  useEffect(() => {
    if (!draftId || !draft || loading) return;
    const hasCase = draft.metadata?.case_id || selectedCaseId;
    const hasFile = uploadedDocuments.length > 0
      ? uploadedDocuments.some((d) => d.status === 'success')
      : !!uploadedFileName;
    const fieldsEmpty = Object.keys(fieldValues).length === 0 || Object.values(fieldValues).every(v => v == null || String(v).trim() === '');
    if ((hasCase || hasFile) && fieldsEmpty && draft.template_id) {
      pollForAutopopulatedFields(draftId, String(draft.template_id));
    }
  }, [draftId, draft?.template_id, draft?.metadata?.case_id, selectedCaseId, uploadedFileName, uploadedDocuments, loading, fieldValues]);

  const handleSelectCase = async (e) => {
    const caseId = e.target.value;
    if (!caseId) return;
    const c = cases.find((x) => String(x.id) === String(caseId) || String(x.case_id) === String(caseId));
    const caseTitle = c?.case_title ?? c?.title ?? null;

    setAttachCaseLoading(true);
    try {
      await attachCaseToDraft(draftId, caseId, caseTitle);
      setSelectedCaseId(caseId);
      setAttachedCaseTitle(caseTitle ?? `Case ${caseId}`);
      addActivity('Orchestrator', `Analyzing and attaching case context: ${caseTitle ?? caseId}`, 'completed');
      toast.success('Case attached. Form fields will update as soon as they are ready.');
      pollForAutopopulatedFields(draftId, draft?.template_id ? String(draft.template_id) : null);
    } catch (err) {
      toast.error('Failed to attach case');
    } finally {
      setAttachCaseLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const fileInput = e.target;
    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    if (files.length === 0) return;
    fileInput.value = ''; // reset so same file can be selected again
    setUploadFileLoading(true);
    setUploadedDocuments(files.map((f) => ({ name: f.name, status: 'uploading' })));
    const options = {
      draftId: draftId || undefined,
      caseId: selectedCaseId ? String(selectedCaseId) : undefined,
      templateId: draft?.template_id ? String(draft.template_id) : undefined,
    };
    try {
      if (files.length === 1) {
        const file = files[0];
        const res = await uploadDocumentForDraft(file, options);
        const fileId = res?.file_id ?? res?.state?.file_id;
        setUploadedFileName(file.name);
        setUploadedDocuments([{ name: file.name, status: 'success', fileId }]);
        if (draftId) {
          try { await setUploadedFileNameInDraft(draftId, file.name); } catch (e) { }
          if (fileId) {
            try { await linkFileToDraft(draftId, fileId, file.name); } catch (e) { }
          }
        }
        addActivity('System', `Extracting facts and evidence from ${file.name}...`, 'completed');
        toast.success('Document uploaded. Form fields will update as soon as they are ready.');
      } else {
        const res = await uploadDocumentsForDraft(files, options);
        const draftJobId = res?.draft_job_id;
        if (draftJobId) {
          const waitForComplete = () =>
            new Promise((resolve, reject) => {
              const poll = async () => {
                try {
                  const status = await getDraftJobStatus(draftJobId);
                  if (status.status === 'complete' || status.all_done) {
                    resolve(status);
                    return;
                  }
                  setTimeout(poll, 2000);
                } catch (err) {
                  reject(err);
                }
              };
              poll();
            });
          const status = await waitForComplete();
          const jobs = status.jobs || [];
          const list = files.map((f, i) => ({
            name: f.name,
            status: jobs[i]?.status === 'finished' ? 'success' : 'failed',
            fileId: jobs[i]?.file_id,
          }));
          setUploadedDocuments(list);
          setUploadedFileName(`${list.filter((d) => d.status === 'success').length} of ${files.length} documents`);
          const fileIds = status.file_ids || [];
          if (draftId && fileIds.length) {
            try { await setUploadedFileNameInDraft(draftId, `${fileIds.length} documents`); } catch (e) { }
            for (let i = 0; i < fileIds.length; i++) {
              try { await linkFileToDraft(draftId, fileIds[i], files[i]?.name || `Document ${i + 1}`); } catch (e) { }
            }
          }
          addActivity('System', `Extracting facts from ${files.length} documents...`, 'completed');
          const successCount = list.filter((d) => d.status === 'success').length;
          const failCount = list.filter((d) => d.status === 'failed').length;
          if (failCount === 0) {
            toast.success(`${successCount} documents uploaded. Form fields will update as soon as they are ready.`);
          } else {
            toast.warning(`${successCount} uploaded, ${failCount} failed. Check document types (PDF, DOC, DOCX, TXT only).`);
          }
          if (draftId && draft?.template_id && successCount > 0) {
            pollForAutopopulatedFields(draftId, String(draft.template_id));
          }
        } else {
          setUploadedDocuments(files.map((f) => ({ name: f.name, status: 'failed' })));
          toast.success(`${files.length} documents queued for upload.`);
        }
      }
    } catch (err) {
      if (!showQuotaError(err)) {
        setUploadedDocuments((prev) => prev.map((d) => ({ ...d, status: 'failed' })));
        toast.error(err?.message || 'Upload failed');
      }
    } finally {
      setUploadFileLoading(false);
    }
  };

  /* ── Chat-phase helpers ───────────────────────────────────────────── */
  const chatSend = async (text) => {
    const msg = (text ?? chatInput).trim();
    if (!msg || chatIsSending || chatIsCreating) return;
    setChatInput('');
    setChatError('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatDocPanelOpen(true);
    setChatStreamingHtml('');
    setChatIsSending(true);
    chatAbortRef.current = new AbortController();

    let sid = chatSessionId;
    if (!sid) {
      if (!autoLocalFiles.length) {
        setChatError('Please go back and upload at least one reference document.');
        setChatIsSending(false);
        return;
      }
      setChatIsCreating(true);
      try {
        const res = await createChatDraftSession({
          templateText: chatTemplateText,
          documents: autoLocalFiles,
          templateId: draft?.template_id || undefined,
        });
        sid = res.sessionId;
        setChatSessionId(sid);
        const warns = (res.documents || []).filter(d => d.warning).map(d => `"${d.name}": ${d.warning}`);
        if (warns.length) setChatWarnings(warns);
      } catch (err) {
        if (showQuotaError(err)) { setChatIsSending(false); setChatIsCreating(false); return; }
        setChatError(err.message || 'Failed to start session.');
        setChatIsSending(false);
        setChatIsCreating(false);
        setChatMessages(prev => prev.slice(0, -1));
        return;
      } finally { setChatIsCreating(false); }
    }

    let accumulated = '';
    let gotFinal = false;
    try {
      await streamChatDraftMessage(sid, msg, (chunk, isFinal) => {
        if (isFinal) {
          accumulated = chunk; gotFinal = true;
          setChatStreamingHtml('');
          setChatLatestHtml(chunk);
          setChatMessages(prev => [...prev, { role: 'assistant', content: chunk }]);
        } else {
          accumulated += chunk;
          setChatStreamingHtml(accumulated);
        }
      }, chatAbortRef.current.signal);
      if (!gotFinal && accumulated) {
        setChatStreamingHtml('');
        setChatLatestHtml(accumulated);
        setChatMessages(prev => [...prev, { role: 'assistant', content: accumulated }]);
      }
    } catch (err) {
      if (err.name === 'AbortError') { setChatIsSending(false); return; }
      if (showQuotaError(err)) {
        setChatMessages(prev => prev.slice(0, -1));
        setChatIsSending(false);
        return;
      }
      // fallback to regular POST
      try {
        const { sendChatDraftMessage } = await import('../api/chatDraftApi');
        const res = await sendChatDraftMessage(sid, msg);
        setChatLatestHtml(res.html);
        setChatStreamingHtml('');
        setChatMessages(prev => [...prev, { role: 'assistant', content: res.html }]);
      } catch (fb) {
        if (!showQuotaError(fb)) {
          setChatError(fb.message || 'Something went wrong.');
          setChatMessages(prev => prev.slice(0, -1));
        }
      }
    } finally {
      setChatIsSending(false);
      setChatStreamingHtml('');
    }
  };

  const chatOnKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } };

  const handleAutoFileAdd = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    setAutoLocalFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...files.filter(f => !names.has(f.name))];
    });
  };

  const handleContinueAutomatic = async () => {
    if (!draft?.template_id) { toast.error('Template ID missing.'); return; }
    setChatTemplateLoading(true);
    const headers = {};
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') ||
      localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const userId = getUserIdForDrafting();
    if (userId) headers['X-User-Id'] = userId;
    try {
      // Fetch template HTML directly from the /content endpoint (reads template_html table + GCS assets)
      const r = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/templates/${draft.template_id}/content`, { headers });
      if (r.ok) {
        const data = await r.json();
        if (data.html) {
          setChatTemplateText(data.html);
        } else {
          // No HTML in DB — try the regular template endpoint for content fallback
          const r2 = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/templates/${draft.template_id}?include_sections=true`, { headers });
          if (r2.ok) {
            const data2 = await r2.json();
            const html2 = extractTemplateHtmlFromResponse(data2.template || data2);
            setChatTemplateText(html2 || `Template: ${draft.template_name || draft.draft_title || ''}`);
          }
        }
      }
    } catch (_) {
      // Fallback: use template name as minimal context so the session can still proceed
      setChatTemplateText(`Template: ${draft.template_name || draft.draft_title || 'Legal Document'}`);
    } finally {
      setChatTemplateLoading(false);
    }
    setChatPhase(true);
    addActivity('AI Chat Draft', 'Chat drafting session started.', 'in-progress');
  };

  // Auto-scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, chatIsSending, chatStreamingHtml]);

  useEffect(() => {
    if (typeof window === 'undefined') return () => undefined;

    const updateSidebarOffset = () => {
      const sidebarEl = document.querySelector('[data-sidebar-root]');
      if (!sidebarEl) {
        setChatDocSidebarOffset(0);
        return;
      }

      const rect = sidebarEl.getBoundingClientRect();
      const style = window.getComputedStyle(sidebarEl);
      const hidden = style.display === 'none' || style.visibility === 'hidden' || rect.width === 0;
      setChatDocSidebarOffset(hidden ? 0 : rect.width);
    };

    updateSidebarOffset();
    window.addEventListener('resize', updateSidebarOffset);

    let resizeObserver;
    const sidebarEl = document.querySelector('[data-sidebar-root]');
    if (sidebarEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateSidebarOffset);
      resizeObserver.observe(sidebarEl);
    }

    return () => {
      window.removeEventListener('resize', updateSidebarOffset);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  const openFilePicker = () => {
    if (uploadFileLoading) return;
    fileInputRef.current?.click();
  };

  const handleFieldChange = (fieldName, value) => {
    hasUserEditedRef.current = true;
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const saveToBackend = async (skipValidation = false) => {
    setErrors({});
    try {
      setSaving(true);
      await updateDraftFields(draftId, fieldValues, Object.keys(fieldValues));
      // Sync to template_user_field_values so autopopulate agent does not overwrite user-edited fields
      if (draft?.template_id) {
        try {
          await saveTemplateUserFieldValues(
            draft.template_id,
            fieldValues,
            Object.keys(fieldValues),
            draftId
          );
        } catch (e) {
          console.warn('Save template-user-field-values failed (non-blocking):', e);
        }
      }
      setLastSaved(new Date());
      if (!skipValidation) toast.success('Draft saved');
      return true;
    } catch (err) {
      toast.error('Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCopySection = async (sectionName, sectionFields) => {
    const lines = [sectionName, ''];
    sectionFields.forEach((f) => {
      const label = f.field_label || f.field_name;
      const value = fieldValues[f.field_name];
      const display = (value != null && String(value).trim() !== '') ? String(value) : '(empty)';
      lines.push(`${label}: ${display}`);
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  // Section Management
  const toggleSectionDeletion = (sectionId) => {
    setDeletedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleReorderSections = (newOrder) => {
    setOrderedSections(newOrder);
    if (draftId) {
      const orderIds = newOrder.map(s => s.id);
      // Fire and forget - silent save to ensure persistence (uses agent-draft-service)
      draftApi.saveSectionOrder(draftId, orderIds).catch(err => console.warn('Order auto-save failed', err));
    }
  };

  const handleFinalizeDraft = async () => {
    if (!draftId) return;

    // Save order (uses agent-draft-service)
    try {
      const orderIds = orderedSections.map(s => s.id);
      await draftApi.saveSectionOrder(draftId, orderIds);
    } catch (err) { console.warn("Saving order failed", err); }

    setIsFinalizing(true);
    try {
      // Iterate orderedSections to include Custom Sections in the save process
      const savePromises = orderedSections.map(async (section, index) => {
        const isDeleted = deletedSections.has(section.id);
        const detailLevel = sectionDetailLevels[section.id] || 'concise';

        return draftApi.saveSectionPrompt(draftId, section.id, {
          customPrompt: undefined,
          isDeleted: isDeleted,
          detailLevel: detailLevel,
          language: selectedLanguage,
          // Save name/type for all sections so Draft Sections page shows user-selected labels
          sectionName: section.title,
          sectionType: section.description,
          sortOrder: index // Explicitly save current index as sortOrder
        });
      });
      // Wait for all section config saves to complete before navigating so the next
      // step shows the correct finalized sections without requiring a refresh
      await Promise.all(savePromises);
      setSectionsFinalizedAt(Date.now());
      addActivity('Orchestrator', 'Configuring document structure and language preferences.', 'completed');
      setCurrentStep(5);
    } catch (err) {
      toast.error("Failed to finalize sections");
    } finally {
      setIsFinalizing(false);
    }
  };

  // Rename
  const handleOpenRenameModal = () => {
    setNewDraftTitle(draft?.draft_title || draft?.template_name || '');
    setShowRenameModal(true);
  };

  const handleRenameDraft = async () => {
    if (!newDraftTitle.trim()) return toast.error('Title cannot be empty');
    try {
      setRenamingDraft(true);
      await renameDraft(draftId, newDraftTitle.trim());
      setDraft(prev => prev ? { ...prev, draft_title: newDraftTitle.trim() } : prev);
      addActivity('System', `Draft renamed to "${newDraftTitle.trim()}"`, 'completed');
      setShowRenameModal(false);
      toast.success('Renamed successfully');
    } catch (err) {
      toast.error('Rename failed');
    } finally {
      setRenamingDraft(false);
    }
  };

  const handleAddCustomSection = async () => {
    if (!newSectionData.name.trim() || !draftId) return;

    const sectionId = `custom_${Date.now()}`;
    const newSection = {
      sectionId,
      sectionName: newSectionData.name,
      sectionType: newSectionData.type,
      customPrompt: undefined,
      isDeleted: false
    };

    try {
      await draftApi.saveSectionPrompt(draftId, sectionId, newSection);

      const newItem = {
        id: sectionId,
        title: newSectionData.name,
        description: newSectionData.type,
        defaultPrompt: '',
        isCustom: true
      };

      setOrderedSections(prev => {
        const nextOrder = [...prev, newItem];
        // Auto-save the new order immediately (uses agent-draft-service)
        if (draftId) {
          const orderIds = nextOrder.map(s => s.id);
          draftApi.saveSectionOrder(draftId, orderIds).catch(err => console.warn('Order update failed after add', err));
        }
        return nextOrder;
      });
      setShowAddSectionModal(false);
      setNewSectionData({ name: '', type: 'clause' });
      addActivity('Orchestrator', `Added custom section: ${newSectionData.name}`, 'completed');
      toast.success('Section added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add section');
    }
  };


  // -- RENDERERS --

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-[#21C1B6]/5 to-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl px-10 py-12 flex flex-col items-center gap-6 border border-slate-200">
          <div className="relative">
            <div className="animate-spin rounded-full h-12 w-12 border-3 border-slate-200 border-t-[#21C1B6]" />
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#21C1B6]/20 to-transparent animate-pulse" />
          </div>
          <p className="text-slate-600 font-semibold text-base">Loading draft...</p>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  // Map current Step ID to Step Name for WorkflowSidebar
  const currentStepId = DRAFT_STEPS[currentStep - 1]?.id || 'initialization';
  const completedSteps = DRAFT_STEPS.slice(0, currentStep - 1).map(s => s.id);

  return (
    <>
      {/* ── Drafting Method Selection Modal (shown once on first load) ── */}
      {showMethodModal && !loading && draft && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px', fontFamily: 'inherit',
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: '40px 36px',
            maxWidth: 580, width: '100%',
            boxShadow: '0 24px 64px rgba(0,0,0,.22)',
            position: 'relative',
          }}>
            <button
              onClick={() => setShowMethodModal(false)}
              style={{ position:'absolute', top:16, right:16, width:32, height:32, borderRadius:8, border:'1px solid #e2e8f0', background:'#f8fafc', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:16, lineHeight:1, fontFamily:'inherit' }}
              aria-label="Close"
            >✕</button>
            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0f172a' }}>
              Choose your drafting method
            </h2>
            <p style={{ margin: '0 0 28px', fontSize: 13.5, color: '#64748b' }}>
              How would you like to generate your draft for{' '}
              <strong style={{ color: '#0f172a' }}>
                {draft.draft_title || draft.template_name || 'this document'}
              </strong>?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Option A: Automatic Chat Draft */}
              <button
                onClick={() => { setDraftMethod('automatic'); setShowMethodModal(false); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16,
                  padding: '20px 22px', borderRadius: 14,
                  border: '2px solid #0d9488', background: '#f0fdfa',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#ccfbf1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f0fdfa'; }}
              >
                <span style={{ fontSize: 30, flexShrink: 0, lineHeight: 1 }}>⚡</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0d9488', marginBottom: 4 }}>
                    Automatic — AI Chat Draft
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.65 }}>
                    Template is loaded automatically. Upload your case documents and chat with AI to generate a complete, formatted draft in real-time. No fields to fill in.
                  </div>
                </div>
              </button>

              {/* Option B: Custom Section by Section */}
              <button
                onClick={() => { setDraftMethod('custom'); setShowMethodModal(false); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16,
                  padding: '20px 22px', borderRadius: 14,
                  border: '2px solid #e2e8f0', background: '#f8fafc',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.background = '#f1f5f9'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
              >
                <span style={{ fontSize: 30, flexShrink: 0, lineHeight: 1 }}>🔧</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                    Custom — Section by Section
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.65 }}>
                    Fill in structured fields and attach case context. The AI generates each section individually with full control over the content and structure.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      <DraftingLayout
        currentStepId={currentStepId}
        completedSteps={completedSteps}
        activities={activities}
        hideChrome={chatPhase}
        headerContent={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-800 tracking-tight">
                    {draft.draft_title || draft.template_name}
                  </h1>
                  <button
                    onClick={handleOpenRenameModal}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-[#21C1B6] transition-all"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase">
                    ID: {draftId?.slice(0, 8)}
                  </span>
                  {saving ? (
                    <span className="text-[10px] text-[#21C1B6] font-bold animate-pulse">Saving...</span>
                  ) : lastSaved ? (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate('/draft-selection')}
              className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-all"
            >
              Exit
            </button>
          </div>
        }
      >
        <div className="h-full">
          <style>{CHAT_CSS}</style>

          {/* ── CHAT PHASE (Automatic method) ── */}
          {chatPhase && (
            <div style={{ display:'flex', height:'100%', minHeight:0, fontFamily:'inherit' }}>
              {/* Left: chat */}
              <div style={{ width: chatDocPanelOpen ? '40%' : '100%', minWidth: chatDocPanelOpen ? 260 : 'unset', display:'flex', flexDirection:'column', borderRight: chatDocPanelOpen ? '1px solid #e5e7eb' : 'none', transition:'width .25s', background:'#fff' }}>
                <div style={{ padding:'12px 16px 10px', borderBottom:'1px solid #f1f5f9', background:'linear-gradient(90deg,#f0fdfa,#fff)', flexShrink:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:18 }}>⚡</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>AI Chat Draft</div>
                      <div style={{ fontSize:11, color:'#64748b' }}>
                      {draft?.template_name || draft?.draft_title}
                      {chatSessionId
                        ? <span style={{ color:'#21C1B6', fontWeight:600 }}> · {autoLocalFiles.length} doc{autoLocalFiles.length!==1?'s':''} processed ✓</span>
                        : <span> · {autoLocalFiles.length} doc{autoLocalFiles.length!==1?'s':''} ready to upload</span>
                      }
                    </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                      {(chatLatestHtml || chatStreamingHtml) && (
                        <button onClick={()=>setChatGoogleDocsOpen(true)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 11px', borderRadius:6, border:'1.5px solid #4285f4', background:'#f0f4ff', fontSize:11.5, color:'#4285f4', cursor:'pointer', fontFamily:'inherit', fontWeight:700 }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="#4285f4"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 11H7v-2h4v2zm6-4H7V9h10v2z"/></svg>
                          {chatRealGoogleDocsUrl ? 'Google Docs Editor' : 'Open in Docs'}
                        </button>
                      )}
                      {(chatLatestHtml || chatStreamingHtml) && !chatDocPanelOpen && (
                        <button onClick={()=>setChatDocPanelOpen(true)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 11px', borderRadius:6, border:'1px solid #21C1B6', background:'#f0fdfa', fontSize:11.5, color:'#0d9488', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
                          📄 View Draft
                        </button>
                      )}
                      <button onClick={() => { chatAbortRef.current?.abort(); setChatPhase(false); }} style={{ fontSize:12, color:'#94a3b8', border:'1px solid #e2e8f0', background:'transparent', borderRadius:6, padding:'3px 9px', cursor:'pointer', fontFamily:'inherit' }}>← Back</button>
                    </div>
                  </div>
                </div>

                {/* messages */}
                <div className="cd-scroll" style={{ flex:1, overflowY:'auto', padding:'16px 14px 8px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:14, maxWidth:700, margin:'0 auto' }}>
                    {chatTemplateLoading && <div style={{ fontSize:12.5, color:'#21C1B6', textAlign:'center', padding:12 }}>Loading template…</div>}
                    {chatWarnings.length > 0 && <div style={{ fontSize:12, color:'#0d9488', background:'#f0fdfa', border:'1px solid #99f6e4', borderRadius:8, padding:'8px 12px' }}><strong>Note:</strong> {chatWarnings.join('; ')}</div>}

                    {chatMessages.length === 0 && !chatIsSending && (
                      <div style={{ textAlign:'center', padding:'32px 16px', color:'#94a3b8' }}>
                        <div style={{ fontSize:32, marginBottom:8 }}>⚡</div>
                        <div style={{ fontSize:14, fontWeight:600, color:'#475569', marginBottom:4 }}>Ready to draft</div>
                        <div style={{ fontSize:12.5 }}>Type your request below — e.g. "Generate the complete draft" or "Draft using all uploaded documents"</div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:7, marginTop:16, justifyContent:'center' }}>
                          {['Generate the complete draft document', 'Draft a formal legal document following the template exactly', 'Create a well-structured draft with all document content'].map(p => (
                            <button key={p} onClick={() => { setChatInput(p); setTimeout(()=>chatTaRef.current?.focus(),0); }} style={{ padding:'5px 12px', borderRadius:20, border:'1px solid #e2e8f0', background:'#f8fafc', fontSize:12, color:'#334155', cursor:'pointer', fontFamily:'inherit' }}>{p.length > 40 ? p.slice(0,40)+'…' : p}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMessages.map((msg, idx) => msg.role === 'user' ? (
                      <div key={idx} style={{ display:'flex', justifyContent:'flex-end' }}>
                        <div style={{ maxWidth:'80%', background:'#f0fdfa', border:'1px solid #99f6e4', borderRadius:'16px 16px 4px 16px', padding:'9px 14px', fontSize:13.5, color:'#0f172a', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{msg.content}</div>
                      </div>
                    ) : (
                      <div key={idx} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                        <div style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', background:'#f0fdfa', border:'1px solid #99f6e4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>⚡</div>
                        <div style={{ flex:1, background:'#fff', border:'1px solid #e5e7eb', borderRadius:'4px 14px 14px 14px', padding:'9px 13px', fontSize:13, color:'#0f172a', lineHeight:1.65 }}>
                          {chatDocPanelOpen ? <span style={{ color:'#21C1B6', fontSize:12 }}>✓ Draft generated — see panel →</span> : <div className="cd-paper" dangerouslySetInnerHTML={{ __html: msg.content }}/>}
                        </div>
                      </div>
                    ))}

                    {chatIsCreating && (
                      <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                        <div style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', background:'#f0fdfa', border:'1px solid #99f6e4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>⚡</div>
                        <div style={{ background:'#f0fdfa', border:'1px solid #99f6e4', borderRadius:'4px 14px 14px 14px', padding:'10px 14px' }}>
                          <div style={{ fontSize:12.5, color:'#0d9488', fontWeight:600, marginBottom:3 }}>Processing {autoLocalFiles.length} document{autoLocalFiles.length!==1?'s':''}…</div>
                          <div style={{ fontSize:11.5, color:'#5eead4' }}>Extracting text and building session. This may take a moment.</div>
                        </div>
                      </div>
                    )}
                    {chatIsSending && !chatIsCreating && !chatStreamingHtml && (
                      <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                        <div style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', background:'#f0fdfa', border:'1px solid #99f6e4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>⚡</div>
                        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:'4px 14px 14px 14px', padding:'10px 14px' }}>
                          {chatDocPanelOpen ? <span style={{ fontSize:12, color:'#21C1B6' }}>Generating draft…</span> : <span style={{ display:'inline-flex', gap:4 }}>{[0,1,2].map(i=><span key={i} style={{ width:6,height:6,borderRadius:'50%',background:'#99f6e4',display:'inline-block',animation:`_dot 1.1s ease-in-out ${i*.18}s infinite` }}/>)}</span>}
                        </div>
                      </div>
                    )}
                    {chatIsSending && chatStreamingHtml && chatDocPanelOpen && (
                      <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                        <div style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', background:'#f0fdfa', border:'1px solid #99f6e4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>⚡</div>
                        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:'4px 14px 14px 14px', padding:'9px 13px', fontSize:12, color:'#21C1B6' }}>Streaming draft… see panel →</div>
                      </div>
                    )}
                    {chatError && <div style={{ fontSize:12.5, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'9px 14px' }}>{chatError}</div>}
                    <div ref={chatEndRef}/>
                  </div>
                </div>

                {/* input */}
                <div style={{ flexShrink:0, padding:'10px 14px 14px', borderTop:'1px solid #f1f5f9', background:'#fff' }}>
                  <div style={{ border:`1.5px solid ${chatIsSending?'#21C1B6':'#e2e8f0'}`, borderRadius:12, padding:'10px 12px 8px', background:'#fff', boxShadow:'0 2px 8px rgba(0,0,0,.06)', transition:'border-color .2s' }}>
                    <textarea ref={chatTaRef} rows={1} value={chatInput} onChange={e => { setChatInput(e.target.value); const ta=chatTaRef.current; if(ta){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,140)+'px';} }} onKeyDown={chatOnKeyDown} disabled={chatIsSending||chatIsCreating||chatTemplateLoading}
                      placeholder={chatTemplateLoading ? 'Loading template…' : 'Describe what to draft, or ask to generate the full document…'}
                      style={{ border:'none', outline:'none', resize:'none', background:'transparent', fontSize:13.5, color:'#0f172a', lineHeight:1.6, fontFamily:'inherit', width:'100%', minHeight:22, caretColor:'#21C1B6' }}
                    />
                    <div style={{ display:'flex', justifyContent:'flex-end', marginTop:6 }}>
                      <button onClick={()=>chatSend()} disabled={!chatInput.trim()||chatIsSending||chatIsCreating||chatTemplateLoading}
                        style={{ width:30, height:30, borderRadius:'50%', background:chatInput.trim()&&!chatIsSending&&!chatIsCreating?'#21C1B6':'#e2e8f0', border:'none', cursor:chatInput.trim()&&!chatIsSending&&!chatIsCreating?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', transition:'background .2s', flexShrink:0 }}>
                        {chatIsSending||chatIsCreating
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{animation:'_spin .7s linear infinite'}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                        }
                      </button>
                    </div>
                  </div>
                  <p style={{ textAlign:'center', fontSize:10, color:'#94a3b8', marginTop:5 }}>Enter ↵ to send · Shift+Enter for new line</p>
                </div>
              </div>

              {/* Right: document panel */}
              {chatDocPanelOpen && (
                <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#fff', minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:16 }}>📄</span>
                      <span style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>Draft Document</span>
                      {chatIsSending && chatStreamingHtml && <span style={{ fontSize:10.5, color:'#fff', background:'#21C1B6', borderRadius:4, padding:'1px 7px', fontWeight:600 }}>● LIVE</span>}
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => { const h=chatLatestHtml||chatStreamingHtml; if(!h)return; const tmp=document.createElement('div');tmp.innerHTML=h; navigator.clipboard.writeText(tmp.innerText||'').then(()=>{setChatCopied(true);setTimeout(()=>setChatCopied(false),2000)}); }} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', fontSize:11.5, color:'#334155', cursor:'pointer', fontFamily:'inherit' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        {chatCopied ? 'Copied!' : 'Copy'}
                      </button>
                      {(chatLatestHtml || chatStreamingHtml) && (
                        <button onClick={()=>setChatGoogleDocsOpen(true)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:6, border:'1px solid #4285f4', background:'#fff', fontSize:11.5, color:'#4285f4', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                          Google Docs View
                        </button>
                      )}
                      <button onClick={()=>setChatDocPanelOpen(false)} style={{ width:26, height:26, borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="cd-scroll" style={{ flex:1, overflowY:'auto', background:'#f5f5f5', padding:'24px 28px' }}>
                    {(chatStreamingHtml || chatLatestHtml) ? (
                      <div style={{ maxWidth:800, margin:'0 auto', background:'#fff', borderRadius:8, boxShadow:'0 4px 24px rgba(0,0,0,.10)', overflow:'hidden' }}>
                        <div className={`cd-paper${chatIsSending&&chatStreamingHtml?' cd-cursor':''}`} style={{ padding:'52px 68px', fontSize:14, lineHeight:1.85 }} dangerouslySetInnerHTML={{ __html: chatStreamingHtml || chatLatestHtml }}/>
                      </div>
                    ) : (
                      <div style={{ maxWidth:800, margin:'0 auto', background:'#fff', borderRadius:8, boxShadow:'0 4px 24px rgba(0,0,0,.10)', padding:'52px 68px' }}>
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, minHeight:280, color:'#94a3b8' }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#21C1B6" strokeWidth="2.5" strokeLinecap="round" style={{animation:'_spin .7s linear infinite'}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                          <p style={{ fontSize:13, margin:0 }}>Generating your draft…</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Google Docs iframe overlay */}
                  {chatGoogleDocsOpen && (() => {
                    const docHtml = chatLatestHtml || chatStreamingHtml || '';
                    const docTitle = draft?.draft_title || draft?.template_name || 'Draft Document';
                    const buildGoogleDocsImportHtml = (title, rawHtml) => {
                      const wrapper = document.createElement('div');
                      wrapper.innerHTML = rawHtml || '';

                      const applyStyles = (selector, styles) => {
                        wrapper.querySelectorAll(selector).forEach((el) => Object.assign(el.style, styles));
                      };

                      applyStyles('h1', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '24px',
                        fontWeight: '700',
                        textAlign: 'center',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        lineHeight: '1.4',
                        margin: '0 0 0.9em',
                      });
                      applyStyles('h2', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '20px',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                        lineHeight: '1.45',
                        margin: '1.3em 0 0.45em',
                      });
                      applyStyles('h3', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '18px',
                        fontWeight: '700',
                        lineHeight: '1.45',
                        margin: '1em 0 0.35em',
                      });
                      applyStyles('p', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '13.5px',
                        lineHeight: '1.88',
                        textAlign: 'justify',
                        color: '#111',
                        margin: '0.55em 0',
                      });
                      applyStyles('ul, ol', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '13.5px',
                        lineHeight: '1.88',
                        margin: '0.45em 0',
                        paddingLeft: '1.6em',
                      });
                      applyStyles('li', {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '13.5px',
                        lineHeight: '1.78',
                        margin: '0.25em 0',
                      });
                      applyStyles('table', {
                        width: '100%',
                        borderCollapse: 'collapse',
                        margin: '1em 0',
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '12.42px',
                      });
                      applyStyles('th', {
                        background: '#f9fafb',
                        fontWeight: '700',
                        padding: '0.5em 0.7em',
                        border: '1px solid #e5e7eb',
                        textAlign: 'left',
                      });
                      applyStyles('td', {
                        padding: '0.45em 0.7em',
                        border: '1px solid #e5e7eb',
                        verticalAlign: 'top',
                      });
                      applyStyles('hr', {
                        border: 'none',
                        borderTop: '1.5px solid #e5e7eb',
                        margin: '1.4em 0',
                      });
                      applyStyles('strong', { fontWeight: '700' });
                      applyStyles('em', { fontStyle: 'italic' });

                      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${GOOGLE_IMPORT_CSS}</style></head><body><div class="gdoc-import">${wrapper.innerHTML}</div></body></html>`;
                    };
                    const DOCUMENT_CONTENT_CSS = `
                      body, .doc-content, .gdoc-import {
                        font-family: 'Georgia', 'Times New Roman', serif;
                        font-size: 13.5px;
                        color: #111;
                        line-height: 1.88;
                      }
                      .doc-content, .gdoc-import {
                        position: relative;
                        z-index: 1;
                      }
                      .doc-content > :first-child, .gdoc-import > :first-child { margin-top: 0 !important; }
                      .doc-content > :last-child, .gdoc-import > :last-child { margin-bottom: 0 !important; }
                      .doc-content h1, .gdoc-import h1 { font-size:1.25em; font-weight:700; text-align:center; margin:0 0 .9em; text-transform:uppercase; letter-spacing:.05em; line-height:1.4; page-break-after:avoid; }
                      .doc-content h2, .gdoc-import h2 { font-size:1.05em; font-weight:700; margin:1.3em 0 .45em; text-transform:uppercase; letter-spacing:.03em; page-break-after:avoid; }
                      .doc-content h3, .gdoc-import h3 { font-size:.98em; font-weight:700; margin:1em 0 .35em; page-break-after:avoid; }
                      .doc-content p, .gdoc-import p { margin:.55em 0; line-height:1.88; text-align:justify; page-break-inside:avoid; }
                      .doc-content ul, .doc-content ol, .gdoc-import ul, .gdoc-import ol { padding-left:1.6em; margin:.45em 0; }
                      .doc-content li, .gdoc-import li { margin:.25em 0; line-height:1.78; }
                      .doc-content table, .gdoc-import table { width:100%; border-collapse:collapse; margin:1em 0; font-size:.92em; page-break-inside:avoid; }
                      .doc-content th, .gdoc-import th { background:#f9fafb; font-weight:700; padding:.5em .7em; border:1px solid #e5e7eb; text-align:left; }
                      .doc-content td, .gdoc-import td { padding:.45em .7em; border:1px solid #e5e7eb; vertical-align:top; }
                      .doc-content tr, .gdoc-import tr { page-break-inside:avoid; }
                      .doc-content strong, .gdoc-import strong { font-weight:700; }
                      .doc-content em, .gdoc-import em { font-style:italic; }
                      .doc-content hr, .gdoc-import hr { border:none; border-top:1.5px solid #e5e7eb; margin:1.4em 0; }
                    `;
                    const GOOGLE_IMPORT_CSS = `
                      body { margin:0; padding:0; background:#fff; }
                      .gdoc-import {
                        max-width: 794px;
                        margin: 0 auto;
                      }
                    `;

                    /* ── Shared typography that exactly matches the cd-paper panel ── */
                    const SHARED_FONT_CSS = `
                      *, *::before, *::after { box-sizing: border-box; }
                      body {
                        font-family: 'Georgia', 'Times New Roman', serif;
                        font-size: 13.5px;
                        color: #111;
                        line-height: 1.88;
                        margin: 0;
                        padding: 0;
                        background: #f1f3f4;
                      }
                      /* ── Page wrapper ── */
                      .doc-page {
                        width: 794px;
                        min-height: 1123px;
                        margin: 28px auto;
                        padding: 96px 96px 80px;
                        background: #fff;
                        box-shadow: 0 1px 4px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.08);
                        position: relative;
                      }
                      /* ── Page header (visible on screen) ── */
                      .doc-hdr {
                        position: absolute;
                        top: 32px; left: 96px; right: 96px;
                        font-size: 9px;
                        color: #888;
                        border-bottom: 1px solid #e5e7eb;
                        padding-bottom: 5px;
                        letter-spacing: .04em;
                        text-transform: uppercase;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                      }
                      /* ── Page footer ── */
                      .doc-ftr {
                        position: absolute;
                        bottom: 28px; left: 96px; right: 96px;
                        font-size: 9px;
                        color: #888;
                        border-top: 1px solid #e5e7eb;
                        padding-top: 5px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                      }
                      .doc-content {
                        position: relative;
                        z-index: 1;
                      }
                      ${DOCUMENT_CONTENT_CSS}
                      a { color:#1a73e8; }

                      /* ── Print ── */
                      @media print {
                        body { background: white; }
                        .doc-page {
                          width: 100%;
                          margin: 0;
                          padding: 0;
                          box-shadow: none;
                          min-height: unset;
                        }
                        .doc-hdr, .doc-ftr { position: fixed; }
                        .doc-hdr { top: 0; left: 0; right: 0; padding: 6mm 25mm 4mm; border: none; border-bottom: 0.5pt solid #ccc; }
                        .doc-ftr { bottom: 0; left: 0; right: 0; padding: 4mm 25mm 6mm; border: none; border-top: 0.5pt solid #ccc; }
                        .doc-content { margin-top: 12mm; margin-bottom: 12mm; }
                        @page {
                          size: A4 portrait;
                          margin: 25mm 25mm 25mm 25mm;
                        }
                        h1, h2, h3 { page-break-after: avoid; }
                        p, li { page-break-inside: avoid; }
                        table, tr, td, th { page-break-inside: avoid; }
                        thead { display: table-header-group; }
                        tfoot { display: table-footer-group; }
                      }
                    `;

                    const srcDoc = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>${docTitle}</title>
  <style>${SHARED_FONT_CSS}</style>
</head>
<body>
  <div class="doc-page">
    <div class="doc-hdr">
      <span>${docTitle}</span>
      <span>Confidential Draft</span>
    </div>
    <div class="doc-content">${docHtml}</div>
    <div class="doc-ftr">
      <span>Generated by JuriNex AI</span>
      <span id="pgn"></span>
    </div>
  </div>
  <script>
    // Simple page numbering (approximation for screen)
    var el = document.getElementById('pgn');
    if (el) el.textContent = 'Page 1';
  </script>
</body></html>`;

                    const openPrintableWindow = () => {
                      if (!docHtml || !docHtml.trim()) {
                        toast.error('No generated draft content available to print.');
                        return;
                      }
                      const printWindow = window.open('', '_blank', 'width=1100,height=800');
                      if (!printWindow) {
                        toast.error('Pop-up blocked. Please allow pop-ups to print.');
                        return;
                      }
                      printWindow.document.open();
                      printWindow.document.write(srcDoc);
                      printWindow.document.close();
                      const tryPrint = () => {
                        try {
                          printWindow.focus();
                          printWindow.print();
                        } catch (_) {
                          // no-op
                        }
                      };
                      printWindow.onload = () => setTimeout(tryPrint, 350);
                      setTimeout(tryPrint, 1200);
                    };

                    const handlePrint = () => {
                      if (chatRealGoogleDocsUrl) {
                        const editUrl = chatGoogleDocsFileId
                          ? `https://docs.google.com/document/d/${chatGoogleDocsFileId}/edit`
                          : chatRealGoogleDocsUrl.replace('?embedded=true', '');
                        window.open(editUrl, '_blank', 'noopener,noreferrer');
                        toast.info('Opened Google Docs in a new tab. Use Ctrl+P there for accurate print.');
                        return;
                      }
                      openPrintableWindow();
                    };

                    const handleOpenInRealGoogleDocs = async () => {
                      if (chatGoogleDocsUploading) return;
                      // Already have URL — iframe is already showing
                      if (chatRealGoogleDocsUrl) return;
                      setChatGoogleDocsUploading(true);
                      try {
                        const returnTo = window.location.pathname + window.location.search;
                        const redirectToGoogleDriveAuth = async () => {
                          const authData = await googleDriveApi.initiateAuth(returnTo);
                          const authUrl = authData?.authUrl || authData?.url;
                          if (authUrl) {
                            window.location.href = authUrl;
                            return true;
                          }
                          return false;
                        };

                        // Step 1: Check Google Drive connected and get access token
                        const status = await googleDriveApi.getConnectionStatus();
                        if (!status?.connected) {
                          // Redirect to connect Google Drive, return to this page after
                          if (await redirectToGoogleDriveAuth()) {
                            return;
                          }
                          throw new Error('Google Drive is not connected. Please connect from Settings.');
                        }
                        let tokenData;
                        try {
                          tokenData = await googleDriveApi.getAccessToken();
                        } catch (tokenError) {
                          const statusCode = tokenError?.response?.status;
                          if ((statusCode === 401 || statusCode === 403) && await redirectToGoogleDriveAuth()) {
                            return;
                          }
                          throw tokenError;
                        }
                        const accessToken = tokenData?.access_token || tokenData?.accessToken || tokenData?.token;
                        if (!accessToken) throw new Error('Could not get Google Drive access token.');

                        // Step 2: Build multipart upload to Google Drive (HTML → Google Doc)
                        const fileTitle = docTitle;

                        const metadata = JSON.stringify({
                          name: fileTitle,
                          mimeType: 'application/vnd.google-apps.document',
                        });
                        const boundary = '-------314159265358979323846';
                        let importBlob = null;
                        let importMimeType = 'text/html; charset=UTF-8';

                        if (chatSessionId) {
                          try {
                            const docxBlob = await exportChatDraftDocx(chatSessionId);
                            if (docxBlob instanceof Blob && docxBlob.size > 0) {
                              importBlob = docxBlob;
                              importMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                            }
                          } catch (docxError) {
                            console.warn('[Google Docs upload] DOCX export failed, falling back to HTML import.', docxError);
                          }
                        }

                        if (!importBlob) {
                          importBlob = new Blob(
                            [buildGoogleDocsImportHtml(fileTitle, docHtml)],
                            { type: 'text/html;charset=UTF-8' }
                          );
                        }

                        const metadataPrefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${importMimeType}\r\n\r\n`;
                        const metadataBlob = new Blob([metadataPrefix], { type: 'text/plain' });
                        const closingBlob = new Blob([`\r\n--${boundary}--`], { type: 'text/plain' });
                        const body = new Blob([metadataBlob, importBlob, closingBlob], {
                          type: `multipart/related; boundary="${boundary}"`,
                        });

                        let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
                        // If updating existing file, use PATCH
                        const isUpdate = Boolean(chatGoogleDocsFileId);
                        const uploadResp = await fetch(
                          isUpdate
                            ? `https://www.googleapis.com/upload/drive/v3/files/${chatGoogleDocsFileId}?uploadType=multipart&fields=id,webViewLink`
                            : uploadUrl,
                          {
                            method: isUpdate ? 'PATCH' : 'POST',
                            headers: {
                              Authorization: `Bearer ${accessToken}`,
                              'Content-Type': `multipart/related; boundary="${boundary}"`,
                            },
                            body,
                          }
                        );
                        if (!uploadResp.ok) {
                          const errText = await uploadResp.text().catch(() => '');
                          throw new Error(`Google Drive upload failed (${uploadResp.status}): ${errText.slice(0, 200)}`);
                        }
                        const uploadResult = await uploadResp.json();
                        const googleFileId = uploadResult.id;
                        if (!googleFileId) throw new Error('No file ID returned from Google Drive.');

                        const iframeUrl = `https://docs.google.com/document/d/${googleFileId}/edit?embedded=true`;
                        setChatRealGoogleDocsUrl(iframeUrl);
                        setChatGoogleDocsFileId(googleFileId);
                        toast.success('Opened in Google Docs editor!');
                      } catch (err) {
                        console.error('[Google Docs upload]', err);
                        toast.error('Google Docs: ' + (err.message || 'Unknown error'));
                      } finally {
                        setChatGoogleDocsUploading(false);
                      }
                    };

                    const handleDownloadPdf = async () => {
                      if (!docHtml || !docHtml.trim()) {
                        toast.error('No generated draft content available for PDF export.');
                        return;
                      }

                      // Prefer native Google Docs PDF export when we have a Google file id.
                      if (chatGoogleDocsFileId) {
                        try {
                          const status = await googleDriveApi.getConnectionStatus();
                          if (status?.connected) {
                            const tokenData = await googleDriveApi.getAccessToken();
                            const accessToken = tokenData?.access_token || tokenData?.accessToken || tokenData?.token;
                            if (accessToken) {
                              const pdfResp = await fetch(
                                `https://www.googleapis.com/drive/v3/files/${chatGoogleDocsFileId}/export?mimeType=application/pdf`,
                                {
                                  method: 'GET',
                                  headers: { Authorization: `Bearer ${accessToken}` },
                                }
                              );
                              if (pdfResp.ok) {
                                const pdfBlob = await pdfResp.blob();
                                if (pdfBlob.size > 0) {
                                  const url = URL.createObjectURL(pdfBlob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `${docTitle}.pdf`;
                                  a.click();
                                  setTimeout(() => URL.revokeObjectURL(url), 8000);
                                  return;
                                }
                              }
                            }
                          }
                        } catch (pdfExportError) {
                          console.warn('[PDF Export] Google Docs export failed, falling back to local renderer.', pdfExportError);
                        }
                      }

                      // Build a hidden printable div with all inline styles applied
                      const wrapper = document.createElement('div');
                      wrapper.style.cssText = [
                        'font-family:Georgia,"Times New Roman",serif',
                        'font-size:13.5px', 'color:#111', 'line-height:1.88',
                        'background:#fff', 'padding:0', 'margin:0',
                        'width:794px',
                      ].join(';');

                      // Apply inline styles to every element before handing to html2pdf
                      const tmp = document.createElement('div');
                      tmp.innerHTML = docHtml;
                      tmp.querySelectorAll('h1').forEach(el => Object.assign(el.style, { fontSize:'1.22em', fontWeight:'700', textAlign:'center', textTransform:'uppercase', letterSpacing:'.05em', lineHeight:'1.4', margin:'0 0 .9em', pageBreakAfter:'avoid' }));
                      tmp.querySelectorAll('h2').forEach(el => Object.assign(el.style, { fontSize:'1.04em', fontWeight:'700', textTransform:'uppercase', letterSpacing:'.03em', margin:'1.3em 0 .45em', pageBreakAfter:'avoid' }));
                      tmp.querySelectorAll('h3').forEach(el => Object.assign(el.style, { fontSize:'.97em', fontWeight:'700', margin:'1em 0 .35em', pageBreakAfter:'avoid' }));
                      tmp.querySelectorAll('p').forEach(el => Object.assign(el.style, { margin:'.55em 0', lineHeight:'1.88', textAlign:'justify', pageBreakInside:'avoid' }));
                      tmp.querySelectorAll('ul,ol').forEach(el => Object.assign(el.style, { paddingLeft:'1.6em', margin:'.45em 0' }));
                      tmp.querySelectorAll('li').forEach(el => Object.assign(el.style, { margin:'.22em 0', lineHeight:'1.78' }));
                      tmp.querySelectorAll('table').forEach(el => Object.assign(el.style, { width:'100%', borderCollapse:'collapse', margin:'1em 0', fontSize:'.91em', pageBreakInside:'avoid' }));
                      tmp.querySelectorAll('th').forEach(el => Object.assign(el.style, { background:'#f9fafb', fontWeight:'700', padding:'.48em .7em', border:'1px solid #d1d5db', textAlign:'left' }));
                      tmp.querySelectorAll('td').forEach(el => Object.assign(el.style, { padding:'.42em .7em', border:'1px solid #d1d5db', verticalAlign:'top' }));
                      tmp.querySelectorAll('tr').forEach(el => Object.assign(el.style, { pageBreakInside:'avoid' }));
                      tmp.querySelectorAll('strong').forEach(el => Object.assign(el.style, { fontWeight:'700' }));
                      tmp.querySelectorAll('hr').forEach(el => Object.assign(el.style, { border:'none', borderTop:'1.5px solid #e5e7eb', margin:'1.4em 0' }));
                      wrapper.appendChild(tmp);

                      // Hidden container off-screen
                      wrapper.style.position = 'absolute';
                      wrapper.style.left = '-9999px';
                      wrapper.style.top = '0';
                      document.body.appendChild(wrapper);
                      try {
                        await html2pdf().set({
                          margin:        [20, 22, 22, 22],
                          filename:      `${docTitle}.pdf`,
                          image:         { type: 'jpeg', quality: 0.99 },
                          html2canvas:   { scale: 2.5, useCORS: true, logging: false, letterRendering: true },
                          jsPDF:         { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
                          pagebreak:     { mode: ['avoid-all', 'css', 'legacy'], avoid: ['p', 'h1', 'h2', 'h3', 'tr', 'li', 'table'] },
                        }).from(wrapper).save();
                      } catch (pdfLocalError) {
                        console.warn('[PDF Export] Local html2pdf failed, opening print fallback.', pdfLocalError);
                        toast.info('Direct PDF export failed. Opening print dialog so you can Save as PDF.');
                        openPrintableWindow();
                      } finally {
                        document.body.removeChild(wrapper);
                      }
                    };

                    const handleDownloadDocx = async () => {
                      if (!docHtml || !docHtml.trim()) {
                        toast.error('No generated draft content available for Word export.');
                        return;
                      }
                      // Try backend DOCX export first (proper .docx via python-docx)
                      if (chatSessionId) {
                        try {
                          const blob = await exportChatDraftDocx(chatSessionId);
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = `${docTitle}.docx`; a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 8000);
                          return;
                        } catch (_) { /* fall through to HTML fallback */ }
                      }
                      // Fallback: download as HTML (safe) rather than fake .doc that can break in Word.
                      const htmlDoc = buildGoogleDocsImportHtml(docTitle, docHtml);
                      const blob = new Blob([htmlDoc], { type: 'text/html' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${docTitle}.html`; a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 8000);
                      toast.info('Downloaded as HTML fallback. Use Google Docs import or DOCX export for Word compatibility.');
                    };

                    const btnStyle = { display:'inline-flex', alignItems:'center', gap:5, padding:'5px 14px', borderRadius:5, border:'1px solid #dadce0', background:'#fff', fontSize:12.5, color:'#202124', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', fontWeight:500, lineHeight:1.4 };

                    return (
                      <div style={{ position:'fixed', top:0, right:0, bottom:0, left:chatDocSidebarOffset, zIndex:9999, background:'#f1f3f4', display:'flex', flexDirection:'column' }}>
                        {/* Google Docs-style menu bar */}
                        <div style={{ background:'#fff', borderBottom:'1px solid #e0e0e0', flexShrink:0, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                          {/* Top row: icon + title + close */}
                          <div style={{ height:52, display:'flex', alignItems:'center', padding:'0 16px', gap:10 }}>
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#4285f4"/>
                              <path d="M14 2v6h6" fill="#a8c7fa"/>
                              <line x1="8" y1="13" x2="16" y2="13" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
                              <line x1="8" y1="16.5" x2="13" y2="16.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                            <span style={{ fontSize:17, fontWeight:400, color:'#202124', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{docTitle}</span>
                            <button onClick={() => setChatGoogleDocsOpen(false)} style={{ width:34, height:34, borderRadius:17, border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#5f6368', fontSize:18 }}>✕</button>
                          </div>
                          {/* Toolbar row */}
                          <div style={{ height:40, display:'flex', alignItems:'center', padding:'0 12px', gap:4, borderTop:'1px solid #f1f3f4' }}>
                            <button onClick={handlePrint} style={btnStyle} title="Print document">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                              Print
                            </button>
                            <div style={{ width:1, height:20, background:'#e0e0e0', margin:'0 2px' }}/>
                            <button onClick={handleDownloadPdf} style={btnStyle} title="Download as PDF">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                              <span style={{ color:'#c62828' }}>Download PDF</span>
                            </button>
                            <button onClick={handleDownloadDocx} style={btnStyle} title="Download as Word document">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                              <span style={{ color:'#1565c0' }}>Download Word</span>
                            </button>
                            <div style={{ width:1, height:20, background:'#e0e0e0', margin:'0 2px' }}/>
                            <button
                              onClick={handleOpenInRealGoogleDocs}
                              disabled={chatGoogleDocsUploading}
                              style={{ ...btnStyle, background: chatRealGoogleDocsUrl ? '#e8f0fe' : '#fff', border:'1px solid #4285f4' }}
                              title="Open in Google Docs editor"
                            >
                              {chatGoogleDocsUploading
                                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2.5" strokeLinecap="round" style={{animation:'_spin .7s linear infinite'}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="#4285f4"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 11H7v-2h4v2zm6-4H7V9h10v2z"/></svg>
                              }
                              <span style={{ color:'#4285f4', fontWeight:600 }}>
                                {chatGoogleDocsUploading ? 'Opening…' : chatRealGoogleDocsUrl ? 'Google Docs Editor' : 'Open in Google Docs'}
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Document viewer — real Google Docs editor if available, else local preview */}
                        <div style={{ flex:1, overflow:'hidden', background:'#f1f3f4', position:'relative' }}>
                          {chatRealGoogleDocsUrl ? (
                            /* Real Google Docs iframe — full-size editable */
                            <iframe
                              key={chatRealGoogleDocsUrl}
                              src={chatRealGoogleDocsUrl}
                              title="Google Docs Editor"
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none' }}
                              allow="clipboard-read; clipboard-write"
                            />
                          ) : (
                            /* Local HTML preview (before uploading to Google Docs) */
                            <iframe
                              ref={chatIframeRef}
                              title="Document Preview"
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none', background:'#f1f3f4' }}
                              srcDoc={srcDoc}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* STEP 1: INITIALIZATION */}
          {!chatPhase && currentStep === 1 && (
            <div className="p-2 space-y-8 animate-slideIn h-full">
              <div className="space-y-2 pb-4 border-b border-slate-100">
                <h2 className="text-2xl font-bold text-slate-900">Initialization</h2>
                <p className="text-slate-500 text-sm">Setting the context for your legal document.</p>
              </div>
              {/* Method badge */}
              {draftMethod && (
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', borderRadius:12, border:`1.5px solid ${draftMethod==='automatic'?'#21C1B6':'#e2e8f0'}`, background:draftMethod==='automatic'?'#f0fdfa':'#f8fafc' }}>
                  <span style={{ fontSize:18 }}>{draftMethod==='automatic'?'⚡':'🔧'}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color: draftMethod==='automatic'?'#0d9488':'#334155' }}>{draftMethod==='automatic'?'Automatic — AI Chat Draft':'Custom — Section by Section'}</div>
                    <div style={{ fontSize:11.5, color:'#64748b' }}>{draftMethod==='automatic'?'Upload your case/reference documents below (required). Template loads from database automatically.':'Attach case or upload documents to auto-fill form fields.'}</div>
                  </div>
                  <button onClick={()=>setShowMethodModal(true)} style={{ marginLeft:'auto', fontSize:11.5, color:'#64748b', border:'1px solid #e2e8f0', background:'transparent', borderRadius:6, padding:'3px 9px', cursor:'pointer', fontFamily:'inherit' }}>Change</button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Option A: Attach Case */}
                <div className="space-y-5 p-7 bg-white rounded-3xl border border-slate-200 hover:border-[#21C1B6] transition-all duration-300 shadow-sm hover:shadow-xl group">
                  <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 bg-slate-100 group-hover:bg-[#21C1B6] group-hover:text-white text-[#21C1B6] rounded-2xl flex items-center justify-center transition-all shadow-inner">
                      <Squares2X2Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">Attach Case</h3>
                      <p className="text-xs text-slate-500">Use case facts & history</p>
                    </div>
                  </div>

                  {attachedCaseTitle ? (
                    <div className="p-4 bg-[#21C1B6]/5 border border-[#21C1B6]/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 bg-[#21C1B6] text-white rounded-xl flex items-center justify-center shadow-lg">
                        <CheckCircleIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs text-[#19a096] font-bold uppercase">Attached Context</p>
                        <p className="text-sm text-slate-900 truncate font-semibold">{attachedCaseTitle}</p>
                      </div>
                      <button onClick={() => { setSelectedCaseId(null); setAttachedCaseTitle(null); }} className="text-slate-300 hover:text-red-500 transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <select
                        className="w-full h-12 px-4 text-sm border-2 border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] bg-slate-50 transition-all"
                        onClick={fetchCases}
                        onChange={handleSelectCase}
                        value={selectedCaseId || ""}
                        disabled={casesLoading}
                      >
                        <option value="">Select a case...</option>
                        {cases.map((c, index) => {
                          const caseKey = c.id ?? c.case_id ?? `case-${index}`;
                          const caseValue = c.id ?? c.case_id ?? '';
                          return (
                            <option key={caseKey} value={caseValue}>
                              {c.case_title || c.title || `Case #${caseValue || index + 1}`}
                            </option>
                          );
                        })}
                      </select>
                      {attachCaseLoading && <p className="text-[10px] text-[#21C1B6] font-bold animate-pulse px-2 uppercase tracking-widest">Processing Context...</p>}
                    </div>
                  )}
                </div>

                {/* Option B: Upload Documents */}
                <div className="space-y-5 p-7 bg-white rounded-3xl border border-slate-200 hover:border-[#21C1B6] transition-all duration-300 shadow-sm hover:shadow-xl group">
                  <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 bg-slate-100 group-hover:bg-[#21C1B6] group-hover:text-white text-[#21C1B6] rounded-2xl flex items-center justify-center transition-all shadow-inner">
                      <ArrowUpTrayIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">Upload Data</h3>
                      <p className="text-xs text-slate-500">{draftMethod === 'automatic' ? 'Reference documents for AI draft' : 'Extract facts from files'}</p>
                    </div>
                  </div>

                  {/* Hidden file inputs */}
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc,.txt" aria-label="Select documents"/>
                  <input ref={autoFileInputRef} type="file" multiple className="hidden" onChange={handleAutoFileAdd} accept=".pdf,.docx,.doc,.txt" aria-label="Select documents for AI draft"/>

                  {/* AUTOMATIC MODE: local file list */}
                  {draftMethod === 'automatic' && (
                    autoLocalFiles.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-[#19a096] font-bold uppercase">Documents ready ({autoLocalFiles.length})</p>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => autoFileInputRef.current?.click()} className="text-xs font-medium text-[#21C1B6] hover:text-[#19a096]">Add more</button>
                            <button type="button" onClick={() => setAutoLocalFiles([])} className="text-slate-400 hover:text-red-500 text-xs font-medium">Clear all</button>
                          </div>
                        </div>
                        <ul className="max-h-48 overflow-y-auto space-y-2 pr-1">
                          {autoLocalFiles.map((f, idx) => (
                            <li key={`${f.name}-${idx}`} className="flex items-center gap-3 p-3 rounded-xl border bg-[#21C1B6]/5 border-[#21C1B6]/20">
                              <CheckCircleIcon className="w-5 h-5 text-[#21C1B6] flex-shrink-0"/>
                              <span className="text-sm text-slate-900 truncate flex-1 min-w-0">{f.name}</span>
                              <button type="button" onClick={() => setAutoLocalFiles(prev => prev.filter((_,i)=>i!==idx))} className="text-slate-300 hover:text-red-500 transition-colors"><XMarkIcon className="w-4 h-4"/></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <button type="button" onClick={() => autoFileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl transition-all border-[#21C1B6]/40 bg-[#f0fdfa] hover:bg-[#ccfbf1] hover:border-[#21C1B6] cursor-pointer">
                        <PlusIcon className="w-6 h-6 text-[#21C1B6] mb-1"/>
                        <p className="text-[11px] font-bold text-[#0d9488] uppercase tracking-tighter">Add Reference Documents</p>
                        <p className="text-[10px] text-[#5eead4] mt-0.5">PDF, DOCX, DOC, TXT · Required to continue</p>
                      </button>
                    )
                  )}

                  {/* CUSTOM MODE: existing server-upload flow */}
                  {draftMethod !== 'automatic' && (
                    uploadedDocuments.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-[#19a096] font-bold uppercase">Uploaded documents</p>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={openFilePicker} disabled={uploadFileLoading} className="text-xs font-medium text-[#21C1B6] hover:text-[#19a096] disabled:opacity-50">Add more</button>
                            <button type="button" onClick={() => { setUploadedDocuments([]); setUploadedFileName(null); }} className="text-slate-400 hover:text-red-500 transition-colors text-xs font-medium">Clear all</button>
                          </div>
                        </div>
                        <ul className="max-h-48 overflow-y-auto space-y-2 pr-1">
                          {uploadedDocuments.map((doc, idx) => (
                            <li key={doc.fileId || `${doc.name}-${doc.status}-${idx}`} className={`flex items-center gap-3 p-3 rounded-xl border ${doc.status==='success'?'bg-[#21C1B6]/5 border-[#21C1B6]/20':doc.status==='failed'?'bg-red-50/50 border-red-200/50':'bg-slate-50 border-slate-200'}`}>
                              {doc.status==='uploading'&&<ArrowPathIcon className="w-5 h-5 text-[#21C1B6] animate-spin flex-shrink-0"/>}
                              {doc.status==='success'&&<CheckCircleIcon className="w-5 h-5 text-[#21C1B6] flex-shrink-0"/>}
                              {doc.status==='failed'&&<XMarkIcon className="w-5 h-5 text-red-500 flex-shrink-0"/>}
                              <span className="text-sm text-slate-900 truncate flex-1 min-w-0">{doc.name}</span>
                              <span className={`text-xs font-medium flex-shrink-0 ${doc.status==='success'?'text-[#19a096]':doc.status==='failed'?'text-red-600':'text-slate-500'}`}>{doc.status==='uploading'?'Uploading...':doc.status==='success'?'Uploaded':'Failed'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <button type="button" onClick={openFilePicker} disabled={uploadFileLoading}
                        className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl transition-all ${uploadFileLoading?'bg-slate-50 opacity-50 cursor-wait':'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-[#21C1B6] cursor-pointer'}`}>
                        {uploadFileLoading ? <ArrowPathIcon className="w-8 h-8 text-[#21C1B6] animate-spin"/> : <><PlusIcon className="w-6 h-6 text-slate-400 mb-1"/><p className="text-[11px] font-bold text-slate-500 uppercase tracking-tighter">Add File</p><p className="text-[10px] text-slate-400 mt-0.5">PDF, DOCX, DOC, TXT</p></>}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Autopopulation spinner (custom mode only) */}
              {draftMethod !== 'automatic' && isAutopopulatingFields && (
                <div className="flex items-center gap-3 p-4 bg-[#21C1B6]/10 border border-[#21C1B6]/20 rounded-2xl">
                  <ArrowPathIcon className="w-6 h-6 text-[#21C1B6] animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      AI is reading your documents and filling form fields...
                      {autopopulationFilledCount > 0 && <span className="ml-2 text-[#21C1B6]">{autopopulationFilledCount} field{autopopulationFilledCount !== 1 ? 's' : ''} filled so far</span>}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">"Continue to Drafting" will unlock once all fields are ready.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-8 border-t border-slate-100">
                <button
                  onClick={() => {
                    if (draftMethod === 'automatic') { handleContinueAutomatic(); return; }
                    setCurrentStep(2);
                    addActivity('Drafter Agent', 'Case analysis complete. Ready to generate content.', 'in-progress');
                  }}
                  disabled={draftMethod === 'automatic' ? autoLocalFiles.length === 0 || chatTemplateLoading : isAutopopulatingFields}
                  className={`h-11 flex items-center gap-3 px-8 rounded-2xl font-bold shadow-xl transition-all active:scale-95 ${
                    (draftMethod === 'automatic' ? autoLocalFiles.length === 0 || chatTemplateLoading : isAutopopulatingFields)
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                      : 'bg-[#21C1B6] hover:bg-[#19a096] text-white hover:scale-105 shadow-[#21C1B6]/20'
                  }`}
                >
                  {chatTemplateLoading ? 'Loading template…' : draftMethod === 'automatic' ? 'Start AI Chat Draft' : 'Continue to Drafting'}
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: FORM INPUTS */}
          {!chatPhase && currentStep === 2 && (
            <div className="animate-slideIn h-full flex flex-col space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Form Inputs</h2>
                    <p className="text-slate-500 text-sm">Provide basic document details for AI generation.</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-1">
                <div className="bg-white border-2 border-slate-100 rounded-3xl p-8 shadow-sm">
                  {sections.length === 0 ? (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                      <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-slate-200" />
                      <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">
                        {isAutopopulatingFields ? 'Preparing inputs...' : 'No inputs required'}
                      </p>
                      {isAutopopulatingFields && (
                        <p className="mt-2 text-sm text-slate-400">Template fields are being prepared from the selected library template.</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-10">
                      {sections.map(({ sectionName, fields: secFields }) => (
                        <div key={sectionName} className="space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 bg-[#21C1B6]/10 rounded-lg flex items-center justify-center">
                              <DocumentTextIcon className="w-5 h-5 text-[#21C1B6]" />
                            </div>
                            <h3 className="text-sm font-black text-slate-700 uppercase tracking-[0.15em]">
                              {sectionName}
                            </h3>
                            <div className="h-px flex-1 bg-gradient-to-r from-slate-100 to-transparent" />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                            {secFields.map((field) => (
                              <div key={field.field_id || field.field_name} className="space-y-1.5 group">
                                <label className="block text-[11px] font-bold text-slate-500 tracking-tight ml-1">
                                  {field.field_label || field.field_name}
                                </label>
                                <div className="relative">
                                  <input
                                    type={field.field_type === 'date' ? 'date' : 'text'}
                                    className="h-11 w-full text-sm rounded-xl border-2 border-slate-100 px-4 focus:ring-4 focus:ring-[#21C1B6]/5 focus:border-[#21C1B6] transition-all bg-slate-50/50 hover:bg-white hover:border-slate-200 font-medium text-slate-700 placeholder:text-slate-300 placeholder:font-normal"
                                    value={fieldValues[field.field_name] || ''}
                                    onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                                    placeholder={field.placeholder || 'Enter details...'}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Autopopulation in-progress banner on Step 2 */}
              {isAutopopulatingFields && (
                <div className="flex items-center gap-3 px-4 py-3 bg-[#21C1B6]/10 border border-[#21C1B6]/20 rounded-2xl flex-shrink-0">
                  <ArrowPathIcon className="w-5 h-5 text-[#21C1B6] animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      AI is filling your fields from documents...
                      {autopopulationFilledCount > 0 && (
                        <span className="ml-2 text-[#21C1B6]">{autopopulationFilledCount} field{autopopulationFilledCount !== 1 ? 's' : ''} filled</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">"Configure Sections" will unlock once all field values are fetched.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-6 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => setCurrentStep(1)} className="h-11 flex items-center gap-2 px-6 text-slate-500 hover:text-slate-900 font-bold">
                  <ArrowLeftIcon className="w-5 h-5" /> Back
                </button>
                <button
                  onClick={async () => {
                    const ok = await saveToBackend(true);
                    if (ok) {
                      addActivity('Orchestrator', 'Inputs validated. Preparing section configuration structure.', 'completed');
                      setCurrentStep(3);
                    }
                  }}
                  disabled={isAutopopulatingFields}
                  className={`h-11 flex items-center gap-3 px-8 rounded-2xl font-bold shadow-xl transition-all active:scale-95 ${
                    isAutopopulatingFields
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                      : 'bg-[#21C1B6] hover:bg-[#19a096] text-white hover:scale-105 shadow-[#21C1B6]/20'
                  }`}
                >
                  {isAutopopulatingFields ? (
                    <>
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                      Fetching Fields...
                    </>
                  ) : (
                    <>
                      Configure Sections
                      <ChevronRightIcon className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SECTION CONFIG */}
          {!chatPhase && currentStep === 3 && (
            <div className="animate-slideIn h-full flex flex-col space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Configure Sections</h2>
                    <p className="text-slate-500 text-sm">Select which sections to generate and customize their instructions.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Draft Language</p>
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      className="bg-white border-2 border-slate-100 rounded-xl text-sm font-bold px-4 py-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none min-w-[150px] transition-all"
                    >
                      {INDIAN_LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-1">
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Drag to Reorder</h3>
                    <button
                      onClick={() => setShowAddSectionModal(true)}
                      className="text-xs font-bold text-[#21C1B6] border-2 border-[#21C1B6]/10 px-5 py-2 rounded-xl hover:bg-[#21C1B6] hover:text-white hover:border-[#21C1B6] transition-all shadow-sm flex items-center gap-2"
                    >
                      <PlusIcon className="w-4 h-4" /> Add Custom Section
                    </button>
                  </div>

                  <Reorder.Group axis="y" values={orderedSections} onReorder={handleReorderSections} className="space-y-4 pb-10">
                    {(() => {
                      let activeNumber = 0;
                      return orderedSections.map((section) => {
                        const isDeleted = deletedSections.has(section.id);
                        if (!isDeleted) activeNumber++;

                        return (
                          <Reorder.Item
                            key={section.id}
                            value={section}
                            className={`group bg-white border-2 rounded-2xl transition-all duration-300 ${isDeleted
                              ? 'opacity-60 border-slate-100'
                              : 'border-slate-100 shadow-sm hover:border-[#21C1B6]/50 hover:shadow-xl cursor-grab active:cursor-grabbing'
                              }`}
                          >
                            <div className="p-4">
                              <div className="flex items-start gap-4 mb-3">
                                <input
                                  type="checkbox"
                                  checked={!isDeleted}
                                  onChange={() => toggleSectionDeletion(section.id)}
                                  className="mt-1 w-5 h-5 rounded-md border-2 border-slate-200 text-[#21C1B6] focus:ring-[#21C1B6] transition-all cursor-pointer"
                                />

                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <h4 className={`text-base font-bold transition-all ${isDeleted ? 'text-slate-400' : 'text-slate-900'}`}>
                                      {!isDeleted ? `${activeNumber}. ` : ''}{section.title.replace(/^\d+\.\s*/, '')}
                                    </h4>

                                    <div className="flex items-center gap-3">
                                      {!isDeleted && (
                                        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                                          {DETAIL_LEVELS.map((level) => (
                                            <button
                                              key={level.value}
                                              onClick={() => setSectionDetailLevels(prev => ({ ...prev, [section.id]: level.value }))}
                                              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all ${(sectionDetailLevels[section.id] || 'concise') === level.value
                                                ? 'bg-white text-[#21C1B6] shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600'
                                                }`}
                                            >
                                              {level.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}

                                      <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest ${isDeleted ? 'bg-slate-100 text-slate-400' : 'bg-[#21C1B6]/10 text-[#21C1B6]'
                                        }`}>
                                        {isDeleted ? 'Excluded' : 'Active'}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-slate-500 font-medium">
                                    {section.description || section.type}
                                  </p>
                                </div>
                              </div>

                              {/* Section prompts are backend-only and sent to LLM at generation time - not shown or editable on frontend */}
                            </div>
                          </Reorder.Item>
                        );
                      });
                    })()}
                  </Reorder.Group>
                </div>
              </div>

              <div className="flex justify-between pt-6 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => setCurrentStep(2)} className="h-11 flex items-center gap-3 px-8 text-slate-500 hover:text-slate-900 font-bold transition-all rounded-2xl hover:bg-slate-50">
                  <ArrowLeftIcon className="w-5 h-5" /> Back
                </button>
                <button
                  onClick={handleFinalizeDraft}
                  className="h-11 flex items-center gap-3 bg-[#21C1B6] text-white px-10 rounded-2xl font-bold shadow-xl transition-all hover:scale-105 active:scale-95 hover:bg-[#19a096] shadow-[#21C1B6]/20"
                >
                  {isFinalizing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving Config...
                    </>
                  ) : (
                    <>
                      Generate Draft <Squares2X2Icon className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: VALIDATION */}
          {!chatPhase && currentStep === 4 && (
            <div className="p-10 flex flex-col items-center justify-center h-full text-center space-y-6 animate-pulse">
              <div className="w-24 h-24 bg-[#21C1B6]/10 rounded-full flex items-center justify-center">
                <ShieldCheckIcon className="w-12 h-12 text-[#21C1B6]" />
              </div>
              <div className="max-w-md">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Legal Logic Validation</h2>
                <p className="text-slate-500">Our specialized Legal Auditor agent is currently cross-referencing your inputs with jurisdictional requirements and procedural rules.</p>
              </div>
              <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#21C1B6] w-2/3 rounded-full animate-marquee" />
              </div>
              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-8 py-2.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    addActivity('Legal Auditor', 'Validation complete. No conflicts found.', 'completed');
                    addActivity('Drafter Agent', 'Starting generation of detailed sections.', 'in-progress');
                    setCurrentStep(5);
                  }}
                  className="px-8 py-2.5 bg-[#21C1B6] text-white rounded-xl font-bold shadow-lg shadow-[#21C1B6]/20 transition-all hover:scale-105"
                >
                  Continue to Review
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW - no outer scrollbar; only inner section preview scrolls */}
          {!chatPhase && currentStep === 5 && (
            <div className="animate-slideIn h-full overflow-hidden flex flex-col">
              <SectionDraftingPage
                key={`section-draft-${draftId}-${sectionsFinalizedAt}`}
                draftIdProp={draftId}
                draftLanguage={selectedLanguage}
                addActivity={addActivity}
                onAssembleComplete={(response) => {
                  setLastAssembleResult(response);
                  setCurrentStep(6);
                }}
                onBack={() => setCurrentStep(3)}
              />
            </div>
          )}

          {/* STEP 6: ASSEMBLY - h-full ensures iframe gets proper height when Google Docs shown */}
          {!chatPhase && currentStep === 6 && (
            <div className={`animate-slideIn h-full flex flex-col min-h-0 ${isGoogleDocsActive ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
              <AssembledPreviewPage
                draftIdProp={draftId}
                addActivity={addActivity}
                onBack={() => setCurrentStep(3)}
                onToggleEditor={(active) => setIsGoogleDocsActive(active)}
                initialAssembleResult={lastAssembleResult}
              />
            </div>
          )}
        </div>
      </DraftingLayout>

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all scale-100 animate-scaleIn border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-6">Rename Draft</h3>
            <input
              type="text"
              value={newDraftTitle}
              onChange={(e) => setNewDraftTitle(e.target.value)}
              className="h-11 w-full text-sm rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] mb-8 transition-all duration-200"
              placeholder="Enter new draft title..."
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="h-10 px-5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-sm font-semibold transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameDraft}
                disabled={renamingDraft}
                className="h-10 px-6 bg-gradient-to-r from-[#21C1B6] to-[#19a096] hover:from-[#19a096] hover:to-[#128f86] text-white rounded-xl text-sm font-bold shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {renamingDraft ? 'Renaming...' : 'Save Name'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Section Modal */}
      {showAddSectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">Add Custom Section</h3>
              <button onClick={() => setShowAddSectionModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Section Name</label>
                <input
                  type="text"
                  value={newSectionData.name}
                  onChange={e => setNewSectionData({ ...newSectionData, name: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none transition-all"
                  placeholder="E.g., Special Provisions"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Type</label>
                <select
                  value={newSectionData.type}
                  onChange={e => setNewSectionData({ ...newSectionData, type: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none transition-all"
                >
                  <option value="clause">Clause</option>
                  <option value="list">List</option>
                  <option value="text">Text Block</option>
                  <option value="definitions">Definitions</option>
                </select>
              </div>
              {/* Prompts are backend-only - sent to LLM at generation time */}
            </div>
            <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
              <button
                onClick={() => setShowAddSectionModal(false)}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomSection}
                disabled={!newSectionData.name.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-[#21C1B6] hover:bg-[#19a096] rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Section
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styles for animations */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideIn { animation: slideIn 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.25s ease-out; }
      `}</style>
    </>
  );
};

export default DraftFormPage;
