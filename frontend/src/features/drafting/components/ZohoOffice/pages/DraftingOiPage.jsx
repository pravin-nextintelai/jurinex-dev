/**
 * DraftingOiPage
 * 
 * Main page for Office Integrator embedded editor.
 * Editor uses full right panel when active.
 * PDFs open in read-only viewer, DOCX in Zoho editor.
 */
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import UploadCard from '../components/UploadCard';
import DraftListOi from '../components/DraftListOi';
import EditorFrame from '../components/EditorFrame';
import PdfViewer from '../components/PdfViewer';
import useDraftingOi from '../hooks/useDraftingOi';

const DraftingOiPage = () => {
    const location = useLocation();
    const navigate = useNavigate();

    const {
        drafts,
        isLoadingList,
        loadDrafts,
        isUploading,
        uploadProgress,
        handleUpload,
        activeSession,
        isCreatingSession,
        openEditor,
        closeEditor,
        isSaving,
        handleSave,
        handleDownload,
        error,
        successMessage,
        clearError,
        clearSuccess,
        isCreatingBlank,
        handleCreateBlank,
        handleRename, // ✅ NEW
        handleDelete  // ✅ NEW
    } = useDraftingOi();

    const [showNewDocModal, setShowNewDocModal] = React.useState(false);

    // State to hold session passed from Chat Edit flow
    const [chatEditorSession, setChatEditorSession] = React.useState(null);

    // Rename & Delete Modal State
    const [showRenameModal, setShowRenameModal] = React.useState(false);
    const [showDeleteModal, setShowDeleteModal] = React.useState(false);
    const [selectedDoc, setSelectedDoc] = React.useState(null);
    const [newName, setNewName] = React.useState('');

    // ============================================================================
    // CHAT EDIT FLOW: Read editorUrl from navigation state and set session
    // When navigating from ChatInterface.jsx with editorUrl, auto-open editor
    // ============================================================================
    useEffect(() => {
        const state = location.state;

        if (state?.fromChat && state?.editorUrl) {
            console.log('[JURINEX DRAFTING] DraftingOiPage mounted, received editorUrl present=true');
            console.log('[JURINEX DRAFTING] setting iframe src: ' + (state.editorUrl?.substring(0, 40) || '') + '...');

            // Set the chat editor session to display iframe
            setChatEditorSession({
                draftId: state.draftId,
                type: state.editorType || 'zoho',
                iframeUrl: state.editorUrl,
                title: state.title || 'Chat Edit',
                fromChat: true
            });

            // Clear the location state to prevent re-triggering on refresh
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    // Load drafts on mount
    useEffect(() => {
        loadDrafts();
    }, [loadDrafts]);

    // Handle create from modal
    const handleCreateFromModal = async (type) => {
        await handleCreateBlank(type);
        setShowNewDocModal(false);
    };

    // Open Rename Modal
    const openRenameModal = (doc) => {
        setSelectedDoc(doc);
        setNewName(doc.title);
        setShowRenameModal(true);
    };

    // Open Delete Modal
    const openDeleteModal = (doc) => {
        setSelectedDoc(doc);
        setShowDeleteModal(true);
    };

    // Submit Rename
    const submitRename = async () => {
        if (!selectedDoc || !newName.trim()) return;
        try {
            await handleRename(selectedDoc.id, newName.trim());
            setShowRenameModal(false);
        } catch (e) {
            // Error handled in hook
        }
    };

    // Submit Delete
    const submitDelete = async () => {
        if (!selectedDoc) return;
        try {
            await handleDelete(selectedDoc.id);
            setShowDeleteModal(false);
        } catch (e) {
            // Error handled in hook
        }
    };

    // New Document Modal Component
    // New Document Modal Component
    const NewDocumentModal = () => {
        if (!showNewDocModal) return null;

        const options = [
            { id: 'doc', label: 'Word Document', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'text-blue-600', bg: 'bg-blue-50 hover:bg-blue-100' },
            { id: 'sheet', label: 'Excel Sheet', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'text-green-600', bg: 'bg-green-50 hover:bg-green-100' },
            { id: 'show', label: 'PowerPoint', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z', color: 'text-orange-600', bg: 'bg-orange-50 hover:bg-orange-100' }
        ];

        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="text-gray-900 font-medium text-lg">Create New</h3>
                        <button onClick={() => setShowNewDocModal(false)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="p-4 space-y-3">
                        {options.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => handleCreateFromModal(opt.id)}
                                disabled={isCreatingBlank}
                                className={`w-full flex items-center gap-4 p-4 rounded-lg transition-all border border-transparent ${opt.bg} group`}
                            >
                                <div className={`p-2 rounded-lg bg-white shadow-sm border border-gray-100 ${opt.color}`}>
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={opt.icon} />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <div className={`font-medium ${opt.color} group-hover:brightness-110`}>{opt.label}</div>
                                    <div className="text-gray-500 text-xs">Create a new blank {opt.label.toLowerCase()}</div>
                                </div>
                                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                        <button
                            onClick={() => setShowNewDocModal(false)}
                            className="text-gray-500 hover:text-gray-700 text-sm font-medium"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Rename Modal
    const RenameModal = () => {
        if (!showRenameModal) return null;
        const isTitleTooLong = newName.trim().length > 100;
        const remainingChars = 100 - newName.trim().length;
        
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                <div className="bg-[#1e2329] rounded-xl border border-gray-700 shadow-2xl max-w-sm w-full overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-white font-medium text-lg">Rename Document</h3>
                    </div>
                    <div className="p-4">
                        <div className="mb-4">
                            <label className="block text-gray-400 text-sm mb-2">Name</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => {
                                    // Limit to 100 characters
                                    const value = e.target.value;
                                    if (value.length <= 100) {
                                        setNewName(value);
                                    }
                                }}
                                maxLength={100}
                                className={`w-full bg-[#0d1117] border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#21C1B6] ${
                                    isTitleTooLong ? 'border-red-500' : 'border-gray-700'
                                }`}
                                autoFocus
                            />
                            <div className="flex justify-between items-center mt-1">
                                {isTitleTooLong && (
                                    <span className="text-red-400 text-xs">Title must be 100 characters or less</span>
                                )}
                                <span className={`text-xs ml-auto ${remainingChars < 20 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                    {remainingChars} characters remaining
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowRenameModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                            <button 
                                onClick={submitRename} 
                                disabled={!newName.trim() || isTitleTooLong}
                                className={`px-4 py-2 text-sm rounded-lg ${
                                    !newName.trim() || isTitleTooLong
                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-[#21C1B6] hover:bg-[#1aa9a0] text-white cursor-pointer'
                                }`}
                            >
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Delete Modal
    const DeleteModal = () => {
        if (!showDeleteModal) return null;
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                <div className="bg-[#1e2329] rounded-xl border border-gray-700 shadow-2xl max-w-sm w-full overflow-hidden">
                    <div className="p-4 border-b border-gray-700">
                        <h3 className="text-white font-medium text-lg">Delete Document?</h3>
                    </div>
                    <div className="p-6 text-center">
                        <div className="w-12 h-12 rounded-full bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </div>
                        <p className="text-gray-300 mb-2">Are you sure you want to delete <span className="font-semibold text-white">"{selectedDoc?.title}"</span>?</p>
                        <p className="text-gray-500 text-sm">This action cannot be undone.</p>
                    </div>
                    <div className="p-4 border-t border-gray-700 bg-[#161b22] flex gap-3 justify-end">
                        <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                        <button onClick={submitDelete} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg">Delete</button>
                    </div>
                </div>
            </div>
        );
    };

    // ============================================================================
    // CHAT EDIT FLOW: Show editor when navigated from chat with editorUrl
    // ============================================================================
    if (chatEditorSession) {
        const handleCloseChatEditor = () => {
            console.log('[JURINEX DRAFTING] Closing chat editor session');
            setChatEditorSession(null);
            loadDrafts(); // Refresh list in case changes were saved
        };

        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} className="bg-gray-50">
                {/* Error Banner */}
                {error && (
                    <div className="bg-red-50 border-b border-red-200 p-2 flex items-center justify-between">
                        <span className="text-red-700 text-sm">{error}</span>
                        <button onClick={clearError} className="text-red-500 hover:text-red-700">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Zoho Editor for Chat Edit flow */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    <EditorFrame
                        iframeUrl={chatEditorSession.iframeUrl}
                        title={chatEditorSession.title}
                        onSave={handleSave}
                        onClose={handleCloseChatEditor}
                        isSaving={isSaving}
                    />
                </div>
            </div>
        );
    }

    // When editor is active - show full panel editor OR PDF viewer
    if (activeSession) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} className="bg-gray-50">
                {/* Error Banner */}
                {error && (
                    <div className="bg-red-50 border-b border-red-200 p-2 flex items-center justify-between">
                        <span className="text-red-700 text-sm">{error}</span>
                        <button onClick={clearError} className="text-red-500 hover:text-red-700">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Conditionally render PDF Viewer or Zoho Editor */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    {activeSession.type === 'pdf' ? (
                        <PdfViewer
                            viewerUrl={activeSession.viewerUrl}
                            title={activeSession.title}
                            onClose={closeEditor}
                        />
                    ) : (
                        <EditorFrame
                            iframeUrl={activeSession.iframeUrl}
                            title={activeSession.title}
                            onSave={handleSave}
                            onClose={closeEditor}
                            isSaving={isSaving}
                        />
                    )}
                </div>
            </div>
        );
    }

    // Creating session - show loading
    if (isCreatingSession) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <svg className="w-12 h-12 mx-auto text-[#21C1B6] animate-spin mb-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-gray-900 font-medium">Opening Editor...</p>
                </div>
            </div>
        );
    }

    // Default view - document list
    return (
        <div className="min-h-screen bg-gray-50 p-6 relative">
            <NewDocumentModal />
            <RenameModal />
            <DeleteModal />

            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/draft-selection')}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900 cursor-pointer"
                        title="Back to Draft Selection"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                            <svg className="w-7 h-7 mr-3 text-[#21C1B6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Drafting Service
                        </h1>
                        <p className="text-gray-500 mt-1 text-sm">Create and edit legal documents</p>
                    </div>
                </div>

                {/* Create New Button */}
                <button
                    onClick={() => setShowNewDocModal(true)}
                    disabled={isCreatingBlank}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#21C1B6] hover:bg-[#1aa9a0] disabled:bg-gray-400 text-white font-medium text-sm rounded-lg transition-colors shadow-sm"
                >
                    {isCreatingBlank ? (
                        <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <span>Creating...</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>Create New</span>
                        </>
                    )}
                </button>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-red-700 text-sm">{error}</span>
                    <button onClick={clearError} className="text-red-500 hover:text-red-700">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Success Banner */}
            {successMessage && (
                <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-green-700 text-sm">{successMessage}</span>
                    <button onClick={clearSuccess} className="text-green-500 hover:text-green-700">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Main Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Upload */}
                <div className="lg:col-span-1">
                    <UploadCard
                        onUpload={handleUpload}
                        isUploading={isUploading}
                        progress={uploadProgress}
                    />
                </div>

                {/* Right Column - Document List */}
                <div className="lg:col-span-2 h-[calc(100vh-72px)]">
                    <div className="bg-white shadow-md rounded-xl h-full m-[2px] overflow-hidden flex flex-col border border-gray-200">
                        <DraftListOi
                            drafts={drafts}
                            isLoading={isLoadingList}
                            onEdit={openEditor}
                            onDownload={handleDownload}
                            onRefresh={loadDrafts}
                            onRename={openRenameModal}
                            onDelete={openDeleteModal}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DraftingOiPage;
