import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import draftingApi, { getGoogleDocsUrl } from '../api/draftingApi';
import googleDriveApi from '@/shared/api/googleDriveApi';
import TemplatePicker from '../components/TemplatePicker';

const normalizeDraft = (rawDraft) => {
  if (!rawDraft) return null;

  const googleFileId = rawDraft.googleFileId || rawDraft.google_file_id || rawDraft.fileId || null;
  const baseUrl =
    rawDraft.iframeUrl ||
    rawDraft.webViewLink ||
    (googleFileId ? getGoogleDocsUrl(googleFileId, { embedded: true }) : null);

  const iframeUrl = baseUrl
    ? baseUrl.includes('embedded=true')
      ? baseUrl
      : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}embedded=true`
    : null;

  return {
    ...rawDraft,
    id: rawDraft.id || rawDraft.draftId || rawDraft.draft_id,
    googleFileId,
    iframeUrl,
    webViewLink: rawDraft.webViewLink || (googleFileId ? getGoogleDocsUrl(googleFileId) : null),
  };
};

/**
 * DraftEditorPage
 * 
 * A page component for viewing and editing Google Docs drafts.
 * Embeds the Google Docs editor in an iframe with minimal UI.
 * Supports copy-paste operations via clipboard permissions.
 */
const DraftEditorPage = () => {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // State
  const [draft, setDraft] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [variables, setVariables] = useState({});
  const [placeholders, setPlaceholders] = useState([]);
  const [isPopulating, setIsPopulating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [openInNewTab, setOpenInNewTab] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Check for template parameter (for creating new drafts)
  const templateFileId = searchParams.get('templateFileId');

  // Fetch access token
  const fetchAccessToken = useCallback(async () => {
    try {
      const tokenData = await googleDriveApi.getAccessToken();
      setAccessToken(tokenData.accessToken);
      return tokenData.accessToken;
    } catch (error) {
      console.error('[DraftEditor] Failed to get access token:', error);
      if (error.response?.data?.needsAuth) {
        toast.error('Please connect your Google Drive account');
      }
      return null;
    }
  }, []);

  // Fetch draft details
  const fetchDraft = useCallback(async () => {
    if (!draftId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await draftingApi.getDraft(draftId);
      const normalizedDraft = normalizeDraft(response.draft);
      setDraft(normalizedDraft);

      // Store placeholders from metadata if available
      if (normalizedDraft?.metadata?.placeholders) {
        setPlaceholders(normalizedDraft.metadata.placeholders);
      }

      // Initialize variables from metadata
      if (normalizedDraft?.metadata?.variables) {
        setVariables(normalizedDraft.metadata.variables);
      }
    } catch (error) {
      console.error('[DraftEditor] Failed to fetch draft:', error);
      setError(error.response?.data?.error || 'Failed to load draft');
      toast.error('Failed to load draft');
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  // Create draft from template
  const handleCreateDraft = useCallback(async (templateData) => {
    try {
      setIsLoading(true);

      const token = accessToken || await fetchAccessToken();
      if (!token) {
        toast.error('Please connect your Google Drive account first');
        return;
      }

      const response = await draftingApi.initiateDraft({
        templateFileId: templateData.id,
        googleAccessToken: token,
        draftName: templateData.customName || undefined,
        metadata: templateData.metadata || {}
      });

      toast.success('Draft created successfully!');

      // Navigate to the new draft
      const normalizedDraft = normalizeDraft(response.draft);
      navigate(`/draft/${normalizedDraft.id}`, { replace: true });
      setDraft(normalizedDraft);
      setPlaceholders(normalizedDraft.placeholders || []);
      setShowCreateModal(false);
    } catch (error) {
      console.error('[DraftEditor] Failed to create draft:', error);
      toast.error(error.response?.data?.error || 'Failed to create draft');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, fetchAccessToken, navigate]);

  // Fetch placeholders from document
  const fetchPlaceholders = useCallback(async () => {
    if (!draft || !accessToken) return;

    try {
      const response = await draftingApi.getPlaceholders(draft.id, accessToken);
      setPlaceholders(response.placeholders || []);

      // Initialize empty variables for each placeholder
      const initialVars = {};
      response.placeholders.forEach(p => {
        if (!variables[p]) {
          initialVars[p] = '';
        }
      });
      setVariables(prev => ({ ...prev, ...initialVars }));
    } catch (error) {
      console.error('[DraftEditor] Failed to fetch placeholders:', error);
    }
  }, [draft, accessToken, variables]);

  // Populate draft with variables
  const handlePopulate = useCallback(async () => {
    if (!draft || !accessToken) return;

    // Filter out empty variables
    const nonEmptyVars = Object.fromEntries(
      Object.entries(variables).filter(([_, value]) => value.trim() !== '')
    );

    if (Object.keys(nonEmptyVars).length === 0) {
      toast.warning('Please fill in at least one variable');
      return;
    }

    try {
      setIsPopulating(true);

      const response = await draftingApi.populateDraft(draft.id, {
        googleAccessToken: accessToken,
        variables: nonEmptyVars
      });

      toast.success(`Replaced ${response.replacements.occurrencesChanged} occurrences`);

      // Refresh placeholders
      await fetchPlaceholders();
    } catch (error) {
      console.error('[DraftEditor] Failed to populate draft:', error);
      toast.error(error.response?.data?.error || 'Failed to populate draft');
    } finally {
      setIsPopulating(false);
    }
  }, [draft, accessToken, variables, fetchPlaceholders]);

  // Finalize draft
  const handleFinalize = useCallback(async () => {
    if (!draft) return;

    // Check if already finalized
    if (draft.status === 'FINALIZED' || draft.status === 'finalized' || draft.status === 'Finalized') {
      toast.info('This draft is already finalized');
      return;
    }

    if (!window.confirm('Are you sure you want to finalize this draft? This will:\n\n1. Sync the document to Google Cloud Storage (GCS)\n2. Mark the draft as FINALIZED\n3. Prevent further editing\n\nThis action cannot be undone.')) {
      return;
    }

    try {
      setIsFinalizing(true);
      const response = await draftingApi.finalizeDraft(draft.id);

      // Update draft with response data (includes gcs_path and status)
      setDraft(prev => ({
        ...prev,
        status: response.draft?.status || 'FINALIZED',
        gcsPath: response.draft?.gcsPath || prev.gcs_path,
        gcs_path: response.draft?.gcsPath || prev.gcs_path,
        lastSyncedAt: response.draft?.lastSyncedAt || new Date().toISOString()
      }));

      toast.success('Draft finalized successfully! The document has been synced to GCS.');

      // Optionally refresh the draft to get the latest data
      await fetchDraft();
    } catch (error) {
      console.error('[DraftEditor] Failed to finalize draft:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Failed to finalize draft';
      toast.error(errorMessage);
    } finally {
      setIsFinalizing(false);
    }
  }, [draft, fetchDraft]);

  // Initialize
  useEffect(() => {
    fetchAccessToken();
  }, [fetchAccessToken]);

  useEffect(() => {
    if (draftId) {
      fetchDraft();
    } else if (templateFileId) {
      // Auto-create from template if provided in URL
      setShowCreateModal(true);
    }
  }, [draftId, templateFileId, fetchDraft]);

  // Fetch placeholders when draft is loaded
  useEffect(() => {
    if (draft && accessToken && placeholders.length === 0) {
      fetchPlaceholders();
    }
  }, [draft, accessToken, fetchPlaceholders, placeholders.length]);


  // Download document using Google Docs native export
  const googleFileId = draft?.googleFileId || draft?.google_file_id || null;
  const embedUrl = draft?.iframeUrl || draft?.webViewLink || (googleFileId ? getGoogleDocsUrl(googleFileId, { embedded: true }) : null);

  const handleDownload = useCallback((format = 'pdf') => {
    if (!googleFileId) {
      toast.error('Document not available');
      return;
    }

    // Google Docs export URLs
    const exportUrls = {
      pdf: `https://docs.google.com/document/d/${googleFileId}/export?format=pdf`,
      docx: `https://docs.google.com/document/d/${googleFileId}/export?format=docx`,
      txt: `https://docs.google.com/document/d/${googleFileId}/export?format=txt`,
      html: `https://docs.google.com/document/d/${googleFileId}/export?format=html`
    };

    const url = exportUrls[format] || exportUrls.pdf;

    // Open in new tab to trigger download
    window.open(url, '_blank');
    toast.success(`Downloading as ${format.toUpperCase()}...`);
  }, [googleFileId]);

  // Create a new blank document
  const handleNewDocument = useCallback(async () => {
    try {
      setIsCreatingNew(true);

      const token = accessToken || await fetchAccessToken();
      if (!token) {
        toast.error('Please connect your Google Drive account first');
        return;
      }

      // Create a new blank document with a default title
      const timestamp = new Date().toISOString().split('T')[0];
      const title = `Untitled Document - ${timestamp}`;

      const response = await draftingApi.createDocument(title, token);

      if (response.data && response.data.draftId) {
        // Navigate to the new draft in the same iframe
        navigate(`/draft/${response.data.draftId}`, { replace: true });
        toast.success('New document created!');
      } else {
        toast.error('Failed to create document');
      }
    } catch (error) {
      console.error('[DraftEditor] Failed to create new document:', error);
      toast.error(error.response?.data?.error || 'Failed to create new document');
    } finally {
      setIsCreatingNew(false);
    }
  }, [accessToken, fetchAccessToken, navigate]);

  // Open an existing document from Google Drive
  const handleOpenDocument = useCallback(() => {
    setIsOpening(true);
    // The TemplatePicker will handle the selection and callback
  }, []);

  // Add keyboard shortcuts for File menu actions (matching Google Docs)
  // Ctrl+N for New, Ctrl+O for Open
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Ctrl+N or Cmd+N for New Document
      if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
        event.preventDefault();
        handleNewDocument();
      }

      // Ctrl+O or Cmd+O for Open Document
      if ((event.ctrlKey || event.metaKey) && event.key === 'o') {
        event.preventDefault();
        handleOpenDocument();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleNewDocument, handleOpenDocument]);

  // Check iframe load status after a delay
  useEffect(() => {
    if (!embedUrl || openInNewTab) return;

    // Check if iframe loaded successfully after a delay
    const checkIframe = setTimeout(() => {
      const iframe = document.querySelector('iframe[title="Google Docs Editor"]');
      if (iframe) {
        // Try to detect if iframe is blocked by CSP
        // Note: We can't directly access iframe content due to CSP, but we can check if it's visible
        const rect = iframe.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          // Iframe might be blocked
          console.warn('[DraftEditor] Iframe appears to be blocked');
        }
      }
    }, 3000);

    return () => clearTimeout(checkIframe);
  }, [embedUrl, openInNewTab]);

  // Render loading state
  if (isLoading && !draft) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-300 text-lg">Loading draft...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (error && !draft) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Failed to Load Draft</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/drafts')}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Back to Drafts
          </button>
        </div>
      </div>
    );
  }

  // Render create modal
  if (showCreateModal || (!draftId && !draft)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Create New Draft</h1>
            <p className="text-slate-400 mb-8">Select a Google Docs template to create a new draft from.</p>

            <div className="space-y-6">
              <div className="flex justify-center">
                <TemplatePicker
                  onTemplateSelected={(template) => {
                    handleCreateDraft(template);
                  }}
                  buttonClassName="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-medium text-lg shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-3"
                  buttonText="Select Template from Drive"
                />
              </div>

              <div className="text-center">
                <button
                  onClick={() => navigate('/drafts')}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  ← Back to Drafts
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white">
      {/* Minimal Header with Actions */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/drafts')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
            title="Back to Drafts"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <span className="ml-1 text-sm text-gray-600 truncate max-w-xs">
            {draft?.title || 'Draft Editor'}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 relative">
          {/* Finalize Button - Only show if draft is not finalized */}
          {draft && draft.status !== 'FINALIZED' && draft.status !== 'finalized' && draft.status !== 'Finalized' && (
            <button
              onClick={handleFinalize}
              disabled={isFinalizing || !draft}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${isFinalizing || !draft
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              title="Finalize Draft (Sync to GCS and mark as complete)"
            >
              {isFinalizing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Finalizing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Finalize
                </>
              )}
            </button>
          )}

          {/* Status Badge - Show if finalized */}
          {draft && (draft.status === 'FINALIZED' || draft.status === 'finalized' || draft.status === 'Finalized') && (
            <div className="px-3 py-1.5 text-sm rounded-lg bg-green-100 text-green-700 flex items-center gap-2" title="This draft is finalized and cannot be edited">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Finalized
            </div>
          )}

          {/* Download Menu (Save) */}
          <div className="relative">
            <button
              onClick={() => setShowDownloadMenu(!showDownloadMenu)}
              disabled={!draft}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${!draft
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              title="Download Document"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Download Dropdown Menu */}
            {showDownloadMenu && draft && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowDownloadMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
                  <button
                    onClick={() => {
                      handleDownload('pdf');
                      setShowDownloadMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    Download as PDF
                  </button>
                  <button
                    onClick={() => {
                      handleDownload('docx');
                      setShowDownloadMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    Download as DOCX
                  </button>
                  <button
                    onClick={() => {
                      handleDownload('txt');
                      setShowDownloadMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    Download as TXT
                  </button>
                </div>
              </>
            )}
          </div>


          {/* Open in New Tab Button (if iframe has issues) */}
          {embedUrl && (
            <button
              onClick={() => {
                window.open(embedUrl, '_blank', 'noopener,noreferrer');
                setOpenInNewTab(true);
              }}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2"
              title="Open in New Tab (Full Google Docs Experience)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open in Tab
            </button>
          )}

          {/* Open Another Button */}
          <button
            onClick={() => navigate('/drafts')}
            className="px-3 py-1.5 text-sm rounded-lg transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-2"
            title="Open Another Document"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Open Another
          </button>
        </div>
      </header>

      {/* Google Docs Editor - Iframe or New Tab */}
      {embedUrl && (
        <>
          {openInNewTab ? (
            // Open in new tab mode
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50">
              <div className="text-center p-8 max-w-md">
                <svg className="w-16 h-16 mx-auto mb-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Document Opened in New Tab</h3>
                <p className="text-gray-600 mb-6">
                  The document has been opened in a new browser tab to avoid security restrictions.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => window.open(embedUrl, '_blank', 'noopener,noreferrer')}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Open Document Again
                  </button>
                  <button
                    onClick={() => setOpenInNewTab(false)}
                    className="w-full px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    Try Iframe Mode
                  </button>
                </div>
              </div>
            </div>
          ) : iframeError ? (
            // CSP Error - Show fallback option
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50">
              <div className="text-center p-8 max-w-md">
                <svg className="w-16 h-16 mx-auto mb-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Security Restriction Detected</h3>
                <p className="text-gray-600 mb-2">
                  Google Docs cannot be embedded in an iframe due to security policies.
                </p>
                <p className="text-sm text-gray-500 mb-6">
                  Please open the document in a new tab to access the full Google Docs editor.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      window.open(embedUrl, '_blank', 'noopener,noreferrer');
                      setOpenInNewTab(true);
                    }}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Open in New Tab
                  </button>
                  <button
                    onClick={() => setIframeError(false)}
                    className="w-full px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Iframe mode
            <iframe
              src={embedUrl}
              className="flex-1 w-full border-0"
              style={{ height: 'calc(100vh - 48px)' }}
              title="Google Docs Editor"
              allow="clipboard-read; clipboard-write; autoplay; popups; popups-to-escape-sandbox"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation"
              onError={() => {
                console.error('[DraftEditor] Iframe load error - CSP violation likely');
                setIframeError(true);
              }}
              onLoad={(e) => {
                setIframeError(false);
              }}
            />
          )}
        </>
      )}

      {/* Open Document Modal */}
      {isOpening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Open Document</h2>
            <p className="text-sm text-gray-600 mb-4">Select a Google Docs document to open:</p>
            <TemplatePicker
              onTemplateSelected={async (template) => {
                try {
                  setIsOpening(false);
                  // Create a draft from the selected document
                  await handleCreateDraft(template);
                } catch (error) {
                  console.error('[DraftEditor] Failed to open document:', error);
                  toast.error('Failed to open document');
                }
              }}
              onCancel={() => setIsOpening(false)}
              buttonClassName="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
              buttonText="Select Document from Drive"
            />
            <button
              onClick={() => setIsOpening(false)}
              className="mt-3 w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default DraftEditorPage;

