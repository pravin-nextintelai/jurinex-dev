/**
 * Template Drafting Component - Draft Store
 * Main Zustand store for draft state management
 */

import { create } from 'zustand';
import { draftApi, aiApi, evidenceApi } from '../services';
import { Logger, trackPerformance } from '../utils/logger';
import { groupBlocksByPage, getPageCount, type PageGroup } from '../utils/pageGrouping';
import type {
    Draft,
    DraftBlock,
    LayoutPage,
    DraftStatus,
    TemplateSchema,
    AiSuggestion,
    EvidenceFile,
    ChatMessage,
    AppError,
    ErrorCategory
} from '../types';

interface UndoEntry {
    versionId: string;
    actionType: string;
}

interface DraftState {
    // Draft data
    draftId: string | null;
    draftTitle: string;
    draftStatus: DraftStatus;
    templateName: string;
    templateVersionId: string | null;
    currentVersionId: string | null;

    // Layout State (Immutable)
    layoutPages: LayoutPage[];
    hasLayout: boolean;
    previewHtml?: string | null; // Deprecated but kept for LeftPanel compatibility

    // Field State (Mutable)
    fieldMap: Map<string, string | number | null>; // Key -> Value
    formData: Record<string, string | number | null>; // Deprecated: keeping for compatibility during migration, sync with fieldMap
    blocks: DraftBlock[]; // Add blocks
    schema: TemplateSchema | null; // Add schema

    // Legacy / Fallback
    fallbackHtmlPages?: Array<{ pageNo: number; html: string }>;

    // Form state
    pendingChanges: Record<string, string | number | null>;
    formDirty: boolean;
    isSaving: boolean;
    lastSavedAt: string | null;

    // Undo/redo
    undoStack: UndoEntry[];
    redoStack: UndoEntry[];
    canUndo: boolean;
    canRedo: boolean;

    // AI state
    chatHistory: ChatMessage[];
    pendingSuggestions: AiSuggestion[];
    isAiLoading: boolean;

    // Evidence
    evidenceFiles: EvidenceFile[];
    selectedEvidenceIds: string[];
    isUploadingEvidence: boolean;

    // UI state
    isLoading: boolean;
    error: AppError | null;

    // Actions
    loadDraft: (draftId: string) => Promise<void>;
    updateField: (key: string, value: string | number | null) => void;
    saveFields: () => Promise<boolean>;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    requestAiSuggestion: (targetBlock: string, instruction?: string) => Promise<void>;
    insertAiSuggestion: (suggestionId: string) => Promise<void>;
    rejectAiSuggestion: (suggestionId: string) => Promise<void>;
    uploadEvidence: (file: File) => Promise<void>;
    toggleEvidenceSelection: (evidenceId: string) => void;
    loadEvidence: (draftId: string) => Promise<void>;
    clearDraft: () => void;
    clearError: () => void;
    refreshPreview: () => Promise<void>; // NEW: Action to refresh preview
    addChatMessage: (role: 'user' | 'assistant', content: string, suggestion?: AiSuggestion) => void;
}

const initialState = {
    draftId: null,
    draftTitle: '',
    draftStatus: 'draft' as DraftStatus,
    templateName: '',
    templateVersionId: null,
    currentVersionId: null,

    layoutPages: [],
    hasLayout: false,

    fieldMap: new Map(),
    formData: {},
    blocks: [], // Init blocks
    schema: null, // Init schema

    fallbackHtmlPages: undefined,

    pendingChanges: {},
    formDirty: false,
    isSaving: false,
    lastSavedAt: null,

    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
    chatHistory: [],
    pendingSuggestions: [],
    isAiLoading: false,
    evidenceFiles: [],
    selectedEvidenceIds: [],
    isUploadingEvidence: false,
    isLoading: false,
    error: null
};

export const useDraftStore = create<DraftState>((set, get) => ({
    ...initialState,

    loadDraft: async (draftId: string) => {
        set({ isLoading: true, error: null });

        try {
            Logger.info('LOAD_DRAFT_START', { draftId });

            // Load draft with blocks
            const response = await trackPerformance(
                'LOAD_DRAFT_API',
                () => draftApi.getById(draftId)
            );

            const draft = response.draft;
            const layoutPages = draft.layout?.pages || [];

            // Initialize field map from backend fields
            const fieldMap = new Map<string, string | number | null>();
            const formData: Record<string, string | number | null> = {};

            if (draft.fields) {
                Object.entries(draft.fields).forEach(([key, value]) => {
                    fieldMap.set(key, value);
                    formData[key] = value;
                });
            } else if (draft.blocks) {
                // Fallback for legacy drafts: extract from blocks
                draft.blocks.forEach(block => {
                    if (block.content?.value !== undefined) {
                        fieldMap.set(block.key, block.content.value);
                        formData[block.key] = block.content.value;
                    }
                });
            }

            Logger.info('LOAD_DRAFT_SUCCESS', {
                draftId,
                layoutPageCount: layoutPages.length,
                fieldCount: fieldMap.size,
                hasFallbackHtml: !!draft.fallback_html
            });

            set({
                draftId: draft.id,
                draftTitle: draft.title,
                draftStatus: draft.status,
                templateName: draft.templateName,
                templateVersionId: draft.templateVersionId,
                currentVersionId: draft.currentVersionId,
                schema: draft.schema, // Set schema
                blocks: draft.blocks || [], // Set blocks

                layoutPages,
                hasLayout: layoutPages.length > 0,

                fieldMap,
                formData,

                fallbackHtmlPages: draft.fallback_html?.pages,

                pendingChanges: {},
                formDirty: false,
                isLoading: false,
                lastSavedAt: draft.lastSavedAt || draft.updatedAt,
                canUndo: false,
                canRedo: false
            });

            // Load evidence in background
            get().loadEvidence(draftId);

        } catch (error) {
            const appError: AppError = {
                category: 'API_FAILURE' as ErrorCategory,
                message: 'Failed to load draft. Please try again.',
                recoverable: true
            };

            Logger.error('LOAD_DRAFT_FAILED', { draftId, error: (error as Error).message });

            set({
                isLoading: false,
                error: appError
            });
        }
    },

    updateField: (key: string, value: string | number | null) => {
        const { fieldMap, formData, pendingChanges } = get();

        // Update Map
        const newFieldMap = new Map(fieldMap);
        newFieldMap.set(key, value);

        set({
            fieldMap: newFieldMap,
            formData: { ...formData, [key]: value }, // Keep for compatibility
            pendingChanges: { ...pendingChanges, [key]: value },
            formDirty: true
        });

        Logger.audit('FIELD_UPDATE', { key, hasValue: value !== null && value !== '' });
    },

    saveFields: async () => {
        const { draftId, pendingChanges, formDirty, isSaving } = get();

        if (!draftId || !formDirty || isSaving || Object.keys(pendingChanges).length === 0) {
            return false;
        }

        set({ isSaving: true });

        try {
            Logger.info('SAVE_FIELDS_START', {
                draftId,
                fieldCount: Object.keys(pendingChanges).length
            });

            const response = await draftApi.updateFields(draftId, pendingChanges);

            // Push to undo stack
            const undoStack = [...get().undoStack, {
                versionId: get().currentVersionId!,
                actionType: 'form_update'
            }];

            // Keep max 50 entries
            if (undoStack.length > 50) {
                undoStack.shift();
            }

            Logger.info('SAVE_FIELDS_SUCCESS', {
                draftId,
                newVersionId: response.versionId,
                versionNo: response.versionNo
            });

            set({
                currentVersionId: response.versionId,
                pendingChanges: {},
                formDirty: false,
                isSaving: false,
                lastSavedAt: new Date().toISOString(),
                undoStack,
                redoStack: [], // Clear redo on new action
                canUndo: undoStack.length > 0,
                canRedo: false
            });

            return true;
        } catch (error) {
            Logger.error('SAVE_FIELDS_FAILED', { draftId, error: (error as Error).message });

            set({
                isSaving: false,
                error: {
                    category: 'API_FAILURE' as ErrorCategory,
                    message: 'Failed to save changes. Please try again.',
                    recoverable: true
                }
            });

            return false;
        }
    },

    undo: async () => {
        const { draftId, canUndo, undoStack, currentVersionId } = get();

        if (!draftId || !canUndo || undoStack.length === 0) {
            return;
        }

        try {
            Logger.info('UNDO_START', { draftId });

            const response = await draftApi.undo(draftId);

            // Move current to redo stack
            const redoStack = [...get().redoStack, {
                versionId: currentVersionId!,
                actionType: 'undo'
            }];

            Logger.info('UNDO_SUCCESS', {
                draftId,
                previousVersionId: response.previousVersionId,
                newVersionId: response.currentVersionId
            });

            // Pop from undo stack
            const newUndoStack = undoStack.slice(0, -1);

            set({
                currentVersionId: response.currentVersionId,
                undoStack: newUndoStack,
                redoStack,
                canUndo: newUndoStack.length > 0,
                canRedo: true
            });

            // Reload draft to reconcile backend state
            await get().loadDraft(draftId);

        } catch (error) {
            Logger.error('UNDO_FAILED', { draftId, error: (error as Error).message });

            set({
                error: {
                    category: 'API_FAILURE' as ErrorCategory,
                    message: 'Failed to undo. Please try again.',
                    recoverable: true
                }
            });
        }
    },

    redo: async () => {
        const { draftId, canRedo, redoStack, currentVersionId } = get();

        if (!draftId || !canRedo || redoStack.length === 0) {
            return;
        }

        try {
            Logger.info('REDO_START', { draftId });

            const response = await draftApi.redo(draftId);

            // Move current to undo stack
            const undoStack = [...get().undoStack, {
                versionId: currentVersionId!,
                actionType: 'redo'
            }];

            Logger.info('REDO_SUCCESS', {
                draftId,
                previousVersionId: response.previousVersionId,
                newVersionId: response.currentVersionId
            });

            // Pop from redo stack
            const newRedoStack = redoStack.slice(0, -1);

            set({
                currentVersionId: response.currentVersionId,
                undoStack,
                redoStack: newRedoStack,
                canUndo: true,
                canRedo: newRedoStack.length > 0
            });

            // Reload draft + preview
            await get().loadDraft(draftId);

        } catch (error) {
            Logger.error('REDO_FAILED', { draftId, error: (error as Error).message });

            set({
                error: {
                    category: 'API_FAILURE' as ErrorCategory,
                    message: 'Failed to redo. Please try again.',
                    recoverable: true
                }
            });
        }
    },

    requestAiSuggestion: async (targetBlock: string, instruction?: string) => {
        const { draftId, selectedEvidenceIds } = get();

        if (!draftId) return;

        set({ isAiLoading: true });

        // Add user message to chat
        const userMessage = instruction || `Generate suggestion for ${targetBlock}`;
        get().addChatMessage('user', userMessage);

        try {
            Logger.info('AI_SUGGEST_START', { draftId, targetBlock });

            const response = await aiApi.suggest(draftId, {
                targetBlock,
                instruction,
                stateAware: true,
                fileIds: selectedEvidenceIds.length > 0 ? selectedEvidenceIds : undefined,
                responseSize: 'medium'
            });

            Logger.info('AI_SUGGEST_SUCCESS', {
                draftId,
                suggestionId: response.suggestion.suggestionId,
                targetBlock
            });

            // Add to pending suggestions
            const pendingSuggestions = [...get().pendingSuggestions, response.suggestion];

            // Add assistant message with suggestion
            get().addChatMessage('assistant', response.suggestion.content, response.suggestion);

            set({
                pendingSuggestions,
                isAiLoading: false
            });

        } catch (error) {
            Logger.error('AI_SUGGEST_FAILED', { draftId, targetBlock, error: (error as Error).message });

            get().addChatMessage('assistant', 'Sorry, I was unable to generate a suggestion. Please try again.');

            set({
                isAiLoading: false,
                error: {
                    category: 'API_FAILURE' as ErrorCategory,
                    message: 'AI suggestion failed. Please try again.',
                    recoverable: true
                }
            });
        }
    },

    insertAiSuggestion: async (suggestionId: string) => {
        const { draftId, pendingSuggestions, currentVersionId, fieldMap, formData } = get();

        if (!draftId) return;

        // Find suggestion to get details for optimistic update
        const suggestion = pendingSuggestions.find(s => s.suggestionId === suggestionId);

        try {
            Logger.info('AI_INSERT_START', { draftId, suggestionId });

            // OPTIMISTIC UPDATE
            if (suggestion?.content && suggestion?.targetBlock) {
                const newFieldMap = new Map(fieldMap);
                newFieldMap.set(suggestion.targetBlock, suggestion.content);

                set({
                    fieldMap: newFieldMap,
                    formData: { ...formData, [suggestion.targetBlock]: suggestion.content },
                    formDirty: true
                });
            }

            const response = await aiApi.insert(draftId, suggestionId);

            // Push to undo stack
            const undoStack = [...get().undoStack, {
                versionId: currentVersionId!,
                actionType: 'ai_insert'
            }];

            // Remove from pending
            const newPendingSuggestions = pendingSuggestions.filter(
                (s: AiSuggestion) => s.suggestionId !== suggestionId
            );

            Logger.info('AI_INSERT_SUCCESS', {
                draftId,
                suggestionId,
                targetBlock: response.targetBlock,
                newVersionId: response.versionId
            });

            set({
                currentVersionId: response.versionId,
                pendingSuggestions: newPendingSuggestions,
                undoStack,
                redoStack: [],
                canUndo: true,
                canRedo: false,
                lastSavedAt: new Date().toISOString()
            });

            // Reload draft to reconcile
            await get().loadDraft(draftId);

        } catch (error) {
            Logger.error('AI_INSERT_FAILED', { draftId, suggestionId, error: (error as Error).message });

            // IDEMPOTENT HANDLING
            if ((error as AppError)?.message?.includes('already processed') || (error as any)?.message?.includes('processed')) {
                Logger.warn('AI_INSERT_IDEMPOTENT', { draftId, suggestionId });
                // Remove from pending and refresh
                const newPendingSuggestions = pendingSuggestions.filter(
                    (s: AiSuggestion) => s.suggestionId !== suggestionId
                );
                set({ pendingSuggestions: newPendingSuggestions });
                await get().loadDraft(draftId);
            } else {
                set({
                    error: {
                        category: 'API_FAILURE' as ErrorCategory,
                        message: 'Failed to insert suggestion. Please try again.',
                        recoverable: true
                    }
                });
            }
        }
    },

    rejectAiSuggestion: async (suggestionId: string) => {
        const { draftId, pendingSuggestions } = get();

        if (!draftId) return;

        try {
            Logger.info('AI_REJECT_START', { draftId, suggestionId });

            await aiApi.reject(draftId, suggestionId);

            // Remove from pending
            const newPendingSuggestions = pendingSuggestions.filter(
                (s: AiSuggestion) => s.suggestionId !== suggestionId
            );

            Logger.info('AI_REJECT_SUCCESS', { draftId, suggestionId });

            set({ pendingSuggestions: newPendingSuggestions });

        } catch (error) {
            Logger.error('AI_REJECT_FAILED', { draftId, suggestionId, error: (error as Error).message });
        }
    },

    loadEvidence: async (draftId: string) => {
        try {
            const response = await evidenceApi.list(draftId);
            set({ evidenceFiles: response.evidence });
        } catch (error) {
            Logger.warn('LOAD_EVIDENCE_FAILED', { draftId, error: (error as Error).message });
        }
    },

    uploadEvidence: async (file: File) => {
        const { draftId } = get();

        if (!draftId) return;

        set({ isUploadingEvidence: true });

        try {
            Logger.info('EVIDENCE_UPLOAD_START', { draftId, fileName: file.name });

            const response = await evidenceApi.upload(draftId, file);

            Logger.info('EVIDENCE_UPLOAD_SUCCESS', {
                draftId,
                evidenceId: response.evidence.id
            });

            // Add to evidence files
            const evidenceFiles = [...get().evidenceFiles, response.evidence];

            set({
                evidenceFiles,
                isUploadingEvidence: false
            });

        } catch (error) {
            Logger.error('EVIDENCE_UPLOAD_FAILED', {
                draftId,
                fileName: file.name,
                error: (error as Error).message
            });

            set({
                isUploadingEvidence: false,
                error: {
                    category: 'API_FAILURE' as ErrorCategory,
                    message: 'Failed to upload file. Please try again.',
                    recoverable: true
                }
            });
        }
    },

    toggleEvidenceSelection: (evidenceId: string) => {
        const { selectedEvidenceIds } = get();

        if (selectedEvidenceIds.includes(evidenceId)) {
            set({
                selectedEvidenceIds: selectedEvidenceIds.filter((id: string) => id !== evidenceId)
            });
        } else {
            set({
                selectedEvidenceIds: [...selectedEvidenceIds, evidenceId]
            });
        }
    },

    addChatMessage: (role: 'user' | 'assistant', content: string, suggestion?: AiSuggestion) => {
        const newMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role,
            content,
            timestamp: new Date(),
            suggestion
        };

        set({ chatHistory: [...get().chatHistory, newMessage] });
    },

    clearDraft: () => {
        set(initialState);
    },

    clearError: () => {
        set({ error: null });
    },

    refreshPreview: async () => {
        const { draftId } = get();
        if (!draftId) return;

        try {
            // Logger.info('PREVIEW_REFRESH_START', { draftId });
            const response = await draftApi.getPreview(draftId);
            set({ previewHtml: response.html });
            // Logger.info('PREVIEW_REFRESH_SUCCESS', { draftId });
        } catch (error) {
            Logger.error('PREVIEW_REFRESH_FAILED', { draftId, error: (error as Error).message });
        }
    }
}));
