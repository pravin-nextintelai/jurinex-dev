/**
 * useDraftingOi Hook
 * 
 * State management for Office Integrator embedded editor.
 * Handles file upload, session management, and save operations.
 */
import { useState, useCallback, useEffect } from 'react';
import {
    uploadFile,
    createSession,
    saveDraft,
    listDrafts,
    downloadFile,
    createBlankDocument,
    renameDocument, // ✅ NEW
    deleteDocument  // ✅ NEW
} from '../services/draftingOiApi';

const useDraftingOi = () => {
    // List of drafts
    const [drafts, setDrafts] = useState([]);
    const [isLoadingList, setIsLoadingList] = useState(false);

    // Upload state
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Editor state
    const [activeSession, setActiveSession] = useState(null);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [isCreatingBlank, setIsCreatingBlank] = useState(false);

    // Save state
    const [isSaving, setIsSaving] = useState(false);

    // Messages
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    /**
     * Load drafts list
     */
    const loadDrafts = useCallback(async () => {
        setIsLoadingList(true);
        setError(null);

        try {
            const result = await listDrafts();
            setDrafts(result.documents || []);
        } catch (err) {
            console.error('[useDraftingOi] Load drafts failed:', err);
            setError(err.message);
        } finally {
            setIsLoadingList(false);
        }
    }, []);

    /**
     * Handle file upload (single File or File[])
     */
    const handleUpload = useCallback(async (fileOrFiles) => {
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        if (files.length === 0) return;

        setIsUploading(true);
        setUploadProgress(0);
        setError(null);

        try {
            let lastResult;
            for (let i = 0; i < files.length; i++) {
                setUploadProgress(Math.round(((i + 0.5) / files.length) * 100));
                lastResult = await uploadFile(files[i]);
            }
            setUploadProgress(100);
            setSuccessMessage(
                files.length === 1
                    ? `"${lastResult?.title}" uploaded successfully`
                    : `${files.length} files uploaded successfully`
            );
            await loadDrafts();
            return lastResult;
        } catch (err) {
            console.error('[useDraftingOi] Upload failed:', err);
            setError(err.message);
            throw err;
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    }, [loadDrafts]);

    /**
     * Open editor for a draft
     * Handles both PDF (read-only) and DOCX (Zoho editor)
     */
    const openEditor = useCallback(async (draftId) => {
        setIsCreatingSession(true);
        setError(null);

        try {
            const result = await createSession(draftId);

            // Log file type decision
            console.log(`[useDraftingOi] File type detected: ${result.type} → ${result.type === 'pdf' ? 'PDF viewer' : 'Zoho editor'}`);

            setActiveSession({
                draftId,
                type: result.type || 'zoho',  // 'pdf' or 'zoho'
                sessionId: result.sessionId,
                iframeUrl: result.iframeUrl,
                viewerUrl: result.viewerUrl,   // For PDF
                title: result.title,
                readOnly: result.readOnly || false
            });

            return result;
        } catch (err) {
            console.error('[useDraftingOi] Create session failed:', err);
            setError(err.message);
            throw err;
        } finally {
            setIsCreatingSession(false);
        }
    }, []);

    /**
     * Close editor
     */
    const closeEditor = useCallback(() => {
        setActiveSession(null);
        // Refresh list in case changes were saved via callback
        loadDrafts();
    }, [loadDrafts]);

    /**
     * Save current document
     */
    const handleSave = useCallback(async () => {
        if (!activeSession) {
            setError('No active editor session');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const result = await saveDraft(
                activeSession.draftId,
                activeSession.sessionId
            );

            setSuccessMessage('Document saved successfully');

            // Refresh list
            await loadDrafts();

            return result;
        } catch (err) {
            console.error('[useDraftingOi] Save failed:', err);
            setError(err.message);
            throw err;
        } finally {
            setIsSaving(false);
        }
    }, [activeSession, loadDrafts]);

    /**
     * Download a document
     */
    const handleDownload = useCallback(async (draftId) => {
        setError(null);

        try {
            await downloadFile(draftId);
        } catch (err) {
            console.error('[useDraftingOi] Download failed:', err);
            setError(err.message);
        }
    }, []);

    /**
     * Clear error message
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    /**
     * Create a new blank document (Word, Excel, or PowerPoint) and open in editor
     * @param {string} type - 'doc' | 'sheet' | 'show'
     */
    const handleCreateBlank = useCallback(async (type = 'doc') => {
        setIsCreatingBlank(true);
        setError(null);

        const typeNames = { doc: 'Word document', sheet: 'Excel sheet', show: 'PowerPoint presentation' };

        try {
            console.log(`[useDraftingOi] Creating blank ${type} document...`);
            const result = await createBlankDocument(type);

            setSuccessMessage(`${typeNames[type] || 'Document'} created`);

            // Refresh list
            await loadDrafts();

            // Auto-open the new document in editor
            if (result.docId) {
                console.log(`[useDraftingOi] Auto-opening new document: ${result.docId}`);
                await openEditor(result.docId);
            }

            return result;
        } catch (err) {
            console.error('[useDraftingOi] Create blank failed:', err);
            setError(err.message || 'Failed to create document');
            throw err;
        } finally {
            setIsCreatingBlank(false);
        }
    }, [loadDrafts, openEditor]);

    /**
     * Clear success message
     */
    const clearSuccess = useCallback(() => {
        setSuccessMessage(null);
    }, []);

    /**
     * Rename document
     */
    const handleRename = useCallback(async (id, newTitle) => {
        if (!newTitle || !newTitle.trim()) return;

        setError(null);
        try {
            await renameDocument(id, newTitle);
            setSuccessMessage('Document renamed successfully');
            await loadDrafts();
        } catch (err) {
            console.error('[useDraftingOi] Rename failed:', err);
            setError(err.message);
            throw err;
        }
    }, [loadDrafts]);

    /**
     * Delete document
     */
    const handleDelete = useCallback(async (id) => {
        setError(null);
        try {
            await deleteDocument(id);
            setSuccessMessage('Document deleted successfully');
            await loadDrafts();
        } catch (err) {
            console.error('[useDraftingOi] Delete failed:', err);
            setError(err.message);
            throw err;
        }
    }, [loadDrafts]);

    // Auto-clear success message after 5 seconds
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => {
                setSuccessMessage(null);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    return {
        // List
        drafts,
        isLoadingList,
        loadDrafts,

        // Upload
        isUploading,
        uploadProgress,
        handleUpload,

        // Editor
        activeSession,
        isCreatingSession,
        openEditor,
        closeEditor,

        // Save
        isSaving,
        handleSave,

        // Download
        handleDownload,

        // Messages
        error,
        successMessage,
        clearError,
        clearSuccess,

        // Create blank
        isCreatingBlank,
        handleCreateBlank,

        // Actions
        handleRename, // ✅ NEW
        handleDelete  // ✅ NEW
    };
};

export default useDraftingOi;
export { useDraftingOi };
