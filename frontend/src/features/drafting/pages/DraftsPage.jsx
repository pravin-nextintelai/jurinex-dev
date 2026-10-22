import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import draftingApi, { getGoogleDocsUrl } from '../api/draftingApi';
import TemplatePicker from '../components/TemplatePicker';
import ShareModal from '../components/ShareModal';
import googleDriveApi from '@/shared/api/googleDriveApi';
import LocalFileUpload from '@/features/case-storage/components/LocalFileUpload';

/**
 * DraftCard Component
 */
const DraftCard = ({ draft, onOpen, onDelete, isOpening = false }) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Icon */}
          <div className="w-12 h-12 bg-[#21C1B6]/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-[#21C1B6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-gray-900 font-medium truncate">{draft.fileName}</h3>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-gray-500 text-sm">
                {(() => {
                  const dateValue = draft.createdAt || draft.created_at || draft.updatedAt || draft.updated_at || draft.lastModified || draft.last_modified || draft.dateCreated;
                  if (dateValue) {
                    try {
                      const date = new Date(dateValue);
                      if (!isNaN(date.getTime())) {
                        return date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        });
                      }
                    } catch (e) {
                      console.error('Error parsing date:', e);
                    }
                  }
                  return 'No date';
                })()}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpen}
            disabled={isOpening}
            className="px-4 py-2 text-white rounded-lg font-medium transition-all flex items-center gap-2 shadow-md hover:shadow-lg cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#21C1B6' }}
            onMouseEnter={(e) => {
              if (!isOpening) {
                e.currentTarget.style.backgroundColor = '#1AA49B';
              }
            }}
            onMouseLeave={(e) => {
              if (!isOpening) {
                e.currentTarget.style.backgroundColor = '#21C1B6';
              }
            }}
          >
            {isOpening ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Opening...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Open
              </>
            )}
          </button>

          {/* More Options */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 z-20 py-1 overflow-hidden">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onDelete();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Draft
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * DraftsPage
 * 
 * Lists all user's drafts with options to create new ones,
 * view/edit existing drafts, and manage draft status.
 * Opens drafts in an iframe within the same page (like Google Drive).
 */
const DraftsPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Detect platform from URL query params (default to google-docs for backward compatibility)
  const platform = searchParams.get('platform') || 'google-docs';
  const isMicrosoftWord = platform === 'microsoft-word';

  // State
  const [drafts, setDrafts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0 });
  const [accessToken, setAccessToken] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isMicrosoftConnected, setIsMicrosoftConnected] = useState(false);
  const [microsoftAuthUrl, setMicrosoftAuthUrl] = useState('');

  // Editor state - controls whether to show list or editor
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [selectedDraftUrl, setSelectedDraftUrl] = useState(null);
  const [openingDraftId, setOpeningDraftId] = useState(null);
  const [isIframeLoading, setIsIframeLoading] = useState(false);

  // Share modal state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Local file upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Fetch access token
  const fetchAccessToken = useCallback(async () => {
    try {
      const tokenData = await googleDriveApi.getAccessToken();
      setAccessToken(tokenData.accessToken);
      return tokenData.accessToken;
    } catch (error) {
      console.error('[DraftsPage] Failed to get access token:', error);
      return null;
    }
  }, []);

  // Check Microsoft connection
  const checkMicrosoftConnection = useCallback(async () => {
    try {
      const response = await draftingApi.checkMicrosoftConnection();
      if (response.connected) {
        setIsMicrosoftConnected(true);
      } else {
        setIsMicrosoftConnected(false);
        if (response.authUrl) {
          setMicrosoftAuthUrl(response.authUrl);
        } else {
          const authResponse = await draftingApi.getMicrosoftAuthUrl();
          setMicrosoftAuthUrl(authResponse.authUrl);
        }
      }
    } catch (error) {
      console.error('[DraftsPage] Failed to check Microsoft connection:', error);
      setIsMicrosoftConnected(false);
    }
  }, []);

  // Fetch drafts (platform-aware)
  const fetchDrafts = useCallback(async () => {
    try {
      setIsLoading(true);

      const options = {
        limit: pagination.limit,
        offset: pagination.offset
      };

      let response;
      if (isMicrosoftWord) {
        response = await draftingApi.listMicrosoftDocuments(options);
        // Normalize Microsoft documents to match Google Docs format
        const msDrafts = (response.documents || []).map(doc => ({
          id: doc.id,
          draftId: doc.id,
          fileName: doc.title || doc.name,
          googleFileId: doc.id, // For compatibility
          status: doc.status || 'DRAFTING',
          createdAt: doc.createdAt || doc.createdDateTime,
          updatedAt: doc.modifiedAt || doc.lastModifiedDateTime,
          webUrl: doc.webUrl,
          ...doc
        }));

        // Sort by most recent
        msDrafts.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0);
          const dateB = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0);
          return dateB - dateA;
        });

        setDrafts(msDrafts);
        setPagination(prev => ({
          ...prev,
          total: response.pagination?.total || response.documents?.length || 0
        }));
      } else {
        response = await draftingApi.listDrafts(options);

        // Sort by most recent
        const sortedDrafts = (response.drafts || []).sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0);
          const dateB = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0);
          return dateB - dateA;
        });

        setDrafts(sortedDrafts);
        setPagination(prev => ({
          ...prev,
          total: response.pagination.total
        }));
      }
    } catch (error) {
      console.error('[DraftsPage] Failed to fetch drafts:', error);
      toast.error('Failed to load drafts');
    } finally {
      setIsLoading(false);
    }
  }, [pagination.limit, pagination.offset, isMicrosoftWord]);

  // Create new blank document (platform-aware)
  const handleCreateBlankDocument = useCallback(async () => {
    try {
      setIsCreating(true);

      if (isMicrosoftWord) {
        if (!isMicrosoftConnected) {
          toast.error('Please connect your Microsoft account first');
          return;
        }

        const timestamp = new Date().toISOString().split('T')[0];
        const title = `Untitled Document - ${timestamp}`;

        const response = await draftingApi.createMicrosoftDocument(title, 'blank');

        if (response.documentId || response.id) {
          const docId = response.documentId || response.id;
          const webUrl = response.webUrl || response.documentUrl;

          // Open the new document in the iframe
          setSelectedDraftId(docId);
          setSelectedDraftUrl(webUrl);

          // Refresh the drafts list
          await fetchDrafts();

          toast.success('Blank document created!');
        } else {
          toast.error('Failed to create document');
        }
      } else {
        const token = accessToken || await fetchAccessToken();
        if (!token) {
          toast.error('Please connect your Google Drive account first');
          return;
        }

        const timestamp = new Date().toISOString().split('T')[0];
        const title = `Untitled Document - ${timestamp}`;

        const response = await draftingApi.createDocument(title, token);

        if (response.data && response.data.draftId) {
          const editorUrl = getGoogleDocsUrl(response.data.googleFileId);

          // Open the new blank document in the iframe
          setSelectedDraftId(response.data.draftId);
          setSelectedDraftUrl(editorUrl);

          // Refresh the drafts list
          await fetchDrafts();

          toast.success('Blank document created!');
        } else {
          toast.error('Failed to create document');
        }
      }
    } catch (error) {
      console.error('[DraftsPage] Failed to create blank document:', error);
      toast.error(error.response?.data?.error || 'Failed to create blank document');
    } finally {
      setIsCreating(false);
    }
  }, [accessToken, fetchAccessToken, isMicrosoftWord, isMicrosoftConnected, fetchDrafts]);

  // Create new draft from template or open uploaded file
  const handleCreateDraft = useCallback(async (template) => {
    try {
      setIsCreating(true);

      const token = template.accessToken || accessToken || await fetchAccessToken();
      if (!token) {
        toast.error('Please connect your Google Drive account first');
        return;
      }

      // Check if it's already a Google Docs file or an uploaded file (which Google converts to Google Docs)
      // Uploaded files have originalFileExtension, and Google converts them to Google Docs
      const isGoogleDoc = template.mimeType === 'application/vnd.google-apps.document' || template.originalFileExtension;

      if (isGoogleDoc) {
        // It's a Google Doc (either existing or uploaded and converted) - create draft from it
        const response = await draftingApi.initiateDraft({
          templateFileId: template.id,
          googleAccessToken: token,
          metadata: {},
          isUploadedFile: !!template.originalFileExtension // Mark as uploaded file if it has originalFileExtension
        });

        toast.success('Draft created successfully!');

        // Open the new draft in the editor (in-page, not navigation)
        const editorUrl = getGoogleDocsUrl(response.draft.googleFileId);
        setSelectedDraftId(response.draft.id);
        setSelectedDraftUrl(editorUrl);

        // Refresh the drafts list
        const options = {
          limit: pagination.limit,
          offset: pagination.offset
        };
        const listResponse = await draftingApi.listDrafts(options);
        setDrafts(listResponse.drafts);
        setPagination(prev => ({
          ...prev,
          total: listResponse.pagination.total
        }));
      } else {
        // Not a Google Doc and not an uploaded file - show error
        toast.error('Please select a Google Docs document or upload a Word document (.doc, .docx)');
      }
    } catch (error) {
      console.error('[DraftsPage] Failed to create draft:', error);
      toast.error(error.response?.data?.error || 'Failed to open file');
    } finally {
      setIsCreating(false);
    }
  }, [accessToken, fetchAccessToken, pagination.limit, pagination.offset]);

  // Delete draft (platform-aware)
  const handleDeleteDraft = useCallback(async (draftId, draftName) => {
    if (!window.confirm(`Are you sure you want to delete "${draftName}"?`)) {
      return;
    }

    try {
      if (isMicrosoftWord) {
        await draftingApi.deleteMicrosoftDocument(draftId);
      } else {
        await draftingApi.deleteDraft(draftId);
      }
      toast.success('Draft deleted successfully');
      setDrafts(prev => prev.filter(d => d.id !== draftId));
    } catch (error) {
      console.error('[DraftsPage] Failed to delete draft:', error);
      toast.error('Failed to delete draft');
    }
  }, [isMicrosoftWord]);

  // Save draft to GCS (manual sync)
  const handleSaveToGCS = useCallback(async (draftId, draftName) => {
    try {
      toast.info('Saving document to GCS...', { autoClose: 2000 });

      // Call sync API with docx format (default)
      const response = await draftingApi.syncToGCS(draftId, 'docx');

      toast.success(`Document saved to GCS successfully!${response.gcsPath ? `\nPath: ${response.gcsPath}` : ''}`, {
        autoClose: 4000
      });

      // Refresh the drafts list to update last_synced_at
      await fetchDrafts();
    } catch (error) {
      console.error('[DraftsPage] Failed to save draft to GCS:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Failed to save document to GCS';
      toast.error(errorMessage);
    }
  }, [fetchDrafts]);

  // Finalize draft
  const handleFinalizeDraft = useCallback(async (draftId, draftName) => {
    const draft = drafts.find(d => d.id === draftId);
    if (draft && (draft.status === 'FINALIZED' || draft.status === 'finalized')) {
      toast.info('This draft is already finalized');
      return;
    }

    if (!window.confirm(`Are you sure you want to finalize "${draftName}"?\n\nThis will:\n1. Sync the document to Google Cloud Storage (GCS)\n2. Mark the draft as FINALIZED\n3. Prevent further editing\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      const response = await draftingApi.finalizeDraft(draftId);

      // Update the draft in the list
      setDrafts(prev => prev.map(d =>
        d.id === draftId
          ? { ...d, status: response.draft?.status || 'FINALIZED', gcsPath: response.draft?.gcsPath }
          : d
      ));

      toast.success('Draft finalized successfully! The document has been synced to GCS.');

      // Refresh the drafts list
      await fetchDrafts();
    } catch (error) {
      console.error('[DraftsPage] Failed to finalize draft:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Failed to finalize draft';
      toast.error(errorMessage);
    }
  }, [drafts, fetchDrafts]);

  // Initialize
  useEffect(() => {
    if (isMicrosoftWord) {
      checkMicrosoftConnection();
    } else {
      fetchAccessToken();
    }
  }, [isMicrosoftWord, fetchAccessToken, checkMicrosoftConnection]);

  useEffect(() => {
    if (isMicrosoftWord && isMicrosoftConnected) {
      fetchDrafts();
    } else if (!isMicrosoftWord) {
      fetchDrafts();
    }
  }, [fetchDrafts, isMicrosoftWord, isMicrosoftConnected]);

  // Intercept window.open to catch "New Document" from Google Docs menu
  useEffect(() => {
    if (!selectedDraftId || !selectedDraftUrl) return;

    // Store original window.open
    const originalOpen = window.open;

    // Override window.open to intercept new document creation
    window.open = async function (url, target, features) {
      // Check if this is a Google Docs new document URL
      if (url && typeof url === 'string' && url.includes('docs.google.com/document/create')) {
        // Intercept: Create a blank document via our API and open it in the iframe
        try {
          const token = accessToken || await fetchAccessToken();
          if (!token) {
            toast.error('Please connect your Google Drive account first');
            return null;
          }

          const timestamp = new Date().toISOString().split('T')[0];
          const title = `Untitled Document - ${timestamp}`;

          const response = await draftingApi.createDocument(title, token);

          if (response.data && response.data.draftId) {
            // Use embedded mode URL
            const newEditorUrl = getGoogleDocsUrl(response.data.googleFileId);

            // Update the iframe to show the new document (will be converted to embedded by getEmbeddedUrl)
            setSelectedDraftId(response.data.draftId);
            setSelectedDraftUrl(newEditorUrl);

            // Refresh drafts list
            await fetchDrafts();

            toast.success('New document created!');

            // Return null to prevent opening in new tab
            return null;
          }
        } catch (error) {
          console.error('[DraftsPage] Failed to create new document:', error);
          toast.error(error.response?.data?.error || 'Failed to create new document');
        }

        // Prevent opening in new tab
        return null;
      }

      // For other URLs, check if it's a Google Docs document URL
      if (url && typeof url === 'string' && url.includes('docs.google.com/document/d/')) {
        const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          const newDocId = match[1];
          const currentDraft = drafts.find(d => d.id === selectedDraftId);

          // If this is a different document, switch to it in the iframe
          if (currentDraft?.googleFileId !== newDocId) {
            const existingDraft = drafts.find(d => d.googleFileId === newDocId);

            if (existingDraft) {
              // Document exists, switch to it
              const editorUrl = getGoogleDocsUrl(newDocId);
              setSelectedDraftId(existingDraft.id);
              setSelectedDraftUrl(editorUrl);
              return null; // Prevent opening in new tab
            } else {
              // New document, create draft for it
              try {
                const token = accessToken || await fetchAccessToken();
                if (token) {
                  const response = await draftingApi.initiateDraft({
                    templateFileId: newDocId,
                    googleAccessToken: token,
                    metadata: {}
                  });

                  const editorUrl = getGoogleDocsUrl(newDocId);
                  setSelectedDraftId(response.draft.id);
                  setSelectedDraftUrl(editorUrl);
                  await fetchDrafts();
                  return null; // Prevent opening in new tab
                }
              } catch (error) {
                console.error('[DraftsPage] Failed to create draft for document:', error);
              }
            }
          }
        }

        // Prevent opening in new tab
        return null;
      }

      // For all other URLs, use original behavior
      return originalOpen.call(window, url, target, features);
    };

    // Cleanup: restore original window.open when component unmounts or editor closes
    return () => {
      window.open = originalOpen;
    };
  }, [selectedDraftId, selectedDraftUrl, accessToken, fetchAccessToken, drafts, fetchDrafts]);

  // Handle opening a draft (platform-aware)
  const handleOpenDraft = useCallback(async (draft) => {
    try {
      setOpeningDraftId(draft.id);
      setIsIframeLoading(true);

      if (isMicrosoftWord) {
        // Open Microsoft Word document
        const response = await draftingApi.openMicrosoftDocument(draft.id);

        if (response.webUrl || response.documentUrl) {
          const webUrl = response.webUrl || response.documentUrl;
          setSelectedDraftId(draft.id);
          setSelectedDraftUrl(null);
          setTimeout(() => {
            setSelectedDraftUrl(webUrl);
          }, 100);
        } else if (draft.webUrl) {
          // Fallback to stored webUrl
          setSelectedDraftId(draft.id);
          setSelectedDraftUrl(null);
          setTimeout(() => {
            setSelectedDraftUrl(draft.webUrl);
          }, 100);
        } else {
          toast.error('No document URL available');
          setOpeningDraftId(null);
          setIsIframeLoading(false);
        }
      } else {
        // Call the open endpoint which checks if file is deleted and recreates if needed
        const response = await draftingApi.openDraft(draft.id);

        if (response.source === 'gcs') {
          // File is deleted from Google Drive, serve from GCS
          toast.info('File is served from GCS (Google Drive file was deleted)', {
            autoClose: 5000
          });

          // Use Google Docs Viewer to display the .docx file from GCS
          if (response.downloadUrl) {
            // Google Docs Viewer can display .docx files
            // Format: https://docs.google.com/viewer?url=ENCODED_URL&embedded=true
            const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(response.downloadUrl)}&embedded=true`;

            setSelectedDraftId(draft.id);
            // Clear old URL first, then set new one to force iframe reload
            setSelectedDraftUrl(null);
            setTimeout(() => {
              setSelectedDraftUrl(viewerUrl);
            }, 100);

            // Also show a message that this is from GCS
            console.log('[DraftsPage] Opening file from GCS:', response.gcsPath);
            console.log('[DraftsPage] Last synced:', response.lastSyncedAt);
          } else {
            toast.error('GCS download URL not available');
            setOpeningDraftId(null);
            setIsIframeLoading(false);
          }
        } else {
          // File exists in Google Drive (or was just recreated), open in editor
          // Backend returns iframeUrl after recreation (if file was recreated)
          // CRITICAL: Always use iframeUrl from backend (it has the NEW file ID after recreation)
          if (response.iframeUrl) {
            setSelectedDraftId(draft.id);
            // Clear old URL first, then set new one to force iframe reload
            // This ensures the iframe loads with the NEW file ID, not the old trashed one
            setSelectedDraftUrl(null);
            setTimeout(() => {
              setSelectedDraftUrl(response.iframeUrl);
            }, 100);
          } else if (response.editorUrl) {
            // Fallback to editorUrl (legacy)
            setSelectedDraftId(draft.id);
            setSelectedDraftUrl(null);
            setTimeout(() => {
              setSelectedDraftUrl(response.editorUrl);
            }, 100);
          } else if (draft.googleFileId) {
            // Fallback to direct Google Docs URL (should not happen if backend works correctly)
            const editorUrl = getGoogleDocsUrl(draft.googleFileId);
            setSelectedDraftId(draft.id);
            setSelectedDraftUrl(null);
            setTimeout(() => {
              setSelectedDraftUrl(editorUrl);
            }, 100);
            toast.warn('Using cached file ID - file may be deleted');
          } else {
            toast.error('No editor URL available');
            setOpeningDraftId(null);
            setIsIframeLoading(false);
          }
        }
      }
    } catch (error) {
      console.error('[DraftsPage] Error opening draft:', error);
      setOpeningDraftId(null);
      setIsIframeLoading(false);

      // Fallback based on platform
      if (isMicrosoftWord && draft.webUrl) {
        setSelectedDraftId(draft.id);
        setSelectedDraftUrl(null);
        setTimeout(() => {
          setSelectedDraftUrl(draft.webUrl);
        }, 100);
        toast.warn('Opened directly - document may not be accessible');
      } else if (!isMicrosoftWord && draft.googleFileId) {
        const editorUrl = getGoogleDocsUrl(draft.googleFileId);
        setSelectedDraftId(draft.id);
        setSelectedDraftUrl(null);
        setTimeout(() => {
          setSelectedDraftUrl(editorUrl);
        }, 100);
        toast.warn('Opened directly - file may be deleted in Google Drive');
      } else {
        toast.error(error.response?.data?.error || 'Failed to open draft');
      }
    }
  }, [isMicrosoftWord]);

  // Handle closing the editor (return to list)
  const handleCloseEditor = useCallback(() => {
    setSelectedDraftId(null);
    setSelectedDraftUrl(null);
    setOpeningDraftId(null);
    setIsIframeLoading(false);
  }, []);

  // Handle iframe load event
  const handleIframeLoad = useCallback(() => {
    setOpeningDraftId(null);
    setIsIframeLoading(false);
  }, []);

  // Handle local file upload success
  const handleLocalUploadSuccess = useCallback(async (draft, iframeUrl) => {
    try {
      // Close upload modal immediately (before opening iframe)
      setIsUploadModalOpen(false);

      // Open the document directly in iframe using the iframeUrl from backend
      if (iframeUrl) {
        // Set the iframe URL immediately
        setSelectedDraftUrl(iframeUrl);

        // Refresh drafts list to get the newly uploaded draft
        // Fetch drafts
        const options = {
          limit: 100, // Use larger limit to ensure we find the new draft
          offset: 0
        };

        let refreshedDrafts = await draftingApi.listDrafts(options);

        // If we have a draft ID, use it; otherwise find it by google_file_id
        let foundDraftId = null;
        if (draft.id) {
          foundDraftId = draft.id;
        } else if (draft.google_file_id) {
          // Find the draft by google_file_id
          const foundDraft = refreshedDrafts.drafts.find(d => d.googleFileId === draft.google_file_id);
          if (foundDraft) {
            foundDraftId = foundDraft.id;
          } else {
            // If not found with current filter, try fetching all drafts without filter
            const allDrafts = await draftingApi.listDrafts({ limit: 100, offset: 0 });
            const foundDraft = allDrafts.drafts.find(d => d.googleFileId === draft.google_file_id);
            if (foundDraft) {
              foundDraftId = foundDraft.id;
              refreshedDrafts = allDrafts; // Use all drafts if found there
            }
          }
        }

        // Update the drafts list with the refreshed data
        setDrafts(refreshedDrafts.drafts);
        setPagination(prev => ({
          ...prev,
          total: refreshedDrafts.pagination.total
        }));

        // Set the draft ID if we found it
        if (foundDraftId) {
          setSelectedDraftId(foundDraftId);
        }

        toast.success('Document opened in editor!');
      } else {
        throw new Error('No iframe URL received from server');
      }
    } catch (error) {
      console.error('[DraftsPage] Error handling upload success:', error);
      toast.error('Upload successful but failed to open document. Please refresh and try opening manually.');
      // Refresh drafts list anyway
      await fetchDrafts();
    }
  }, [fetchDrafts]);

  // Handle local file upload error
  const handleLocalUploadError = useCallback((error) => {
    console.error('[DraftsPage] Upload error:', error);
    // Error is already shown via toast in LocalFileUpload component
  }, []);


  // Show Microsoft connection screen if not connected
  if (isMicrosoftWord && !isMicrosoftConnected && !selectedDraftId) {
    return (
      <div className="h-full flex flex-col bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Connect to Microsoft Office
            </h2>
            <p className="text-gray-600 mb-6">
              To use Microsoft Word for drafting, you need to connect your Microsoft account.
            </p>
            <button
              onClick={() => {
                if (microsoftAuthUrl) {
                  window.location.href = microsoftAuthUrl;
                } else {
                  draftingApi.getMicrosoftAuthUrl().then(res => {
                    window.location.href = res.authUrl;
                  });
                }
              }}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Sign in with Microsoft
            </button>
            <button
              onClick={() => navigate('/draft-selection')}
              className="mt-4 w-full text-gray-600 hover:text-gray-800 font-medium py-2"
            >
              Back to Selection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header - Hidden when editor is open */}
      {!selectedDraftId && !selectedDraftUrl && (
        <header className="bg-white border-b border-gray-200 flex-shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
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
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">
                    {isMicrosoftWord ? 'Microsoft Word Drafts' : 'Document Drafts'}
                  </h1>
                  <p className="text-gray-600 text-sm">
                    {isMicrosoftWord
                      ? 'Create and manage your Microsoft Word documents'
                      : 'Create and manage your document drafts from Google Docs templates'
                    }
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleCreateBlankDocument}
                  disabled={isCreating}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 ${isCreating
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-white border-2 border-[#21C1B6] text-[#21C1B6] hover:bg-[#21C1B6] hover:text-white cursor-pointer'
                    }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {isCreating ? 'Creating...' : 'Blank Document'}
                </button>

                {!isMicrosoftWord && (
                  <>
                    <button
                      onClick={() => setIsUploadModalOpen(true)}
                      disabled={isCreating}
                      className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 ${isCreating
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-white border-2 border-[#21C1B6] text-[#21C1B6] hover:bg-[#21C1B6] hover:text-white cursor-pointer'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Upload from Local
                    </button>

                    <TemplatePicker
                      onTemplateSelected={handleCreateDraft}
                      disabled={isCreating}
                      buttonClassName={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 ${isCreating
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-white border-2 border-[#21C1B6] text-[#21C1B6] hover:bg-[#21C1B6] hover:text-white cursor-pointer'
                        }`}
                      buttonText={isCreating ? 'Creating...' : 'New Draft'}
                    />
                  </>
                )}
              </div>
            </div>

          </div>
        </header>
      )}

      {/* Content Area - Shows either list or editor */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {selectedDraftId && selectedDraftUrl ? (
          // Editor View - fills the remaining space
          <div className="flex-1 flex flex-col bg-white">
            {/* Editor Header with Back Button and Share Button */}
            <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCloseEditor}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
                  title="Back to Drafts"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <span className="ml-1 text-sm text-gray-600 truncate max-w-xs">
                  {drafts.find(d => d.id === selectedDraftId)?.fileName || 'Draft Editor'}
                </span>
              </div>
              <button
                onClick={() => setIsShareModalOpen(true)}
                className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-300"
                title="Share Document"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
            </div>

            {/* Editor Iframe */}
            <div className="flex-1 w-full overflow-hidden relative">
              {isIframeLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">Loading document...</p>
                  </div>
                </div>
              )}
              <iframe
                key={selectedDraftUrl} // Force re-render when URL changes (important after recreation)
                src={selectedDraftUrl}
                className="w-full h-full border-0"
                title={isMicrosoftWord ? "Microsoft Word Editor" : "Google Docs Editor"}
                allow="clipboard-read; clipboard-write; autoplay; popups; popups-to-escape-sandbox"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
                onLoad={handleIframeLoad}
              />
            </div>
          </div>
        ) : (
          // Draft List View
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">Loading drafts...</p>
                  </div>
                </div>
              ) : drafts.length === 0 ? (
                <div className="text-center py-20">
                  <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No drafts yet</h3>
                  <p className="text-gray-600 max-w-md mx-auto mb-6">
                    Create your first draft by selecting a Google Docs template. Your drafts will appear here.
                  </p>
                  <TemplatePicker
                    onTemplateSelected={handleCreateDraft}
                    buttonClassName="px-6 py-3 bg-[#21C1B6] hover:bg-[#1AA49B] text-white rounded-lg font-semibold shadow-md transition-all duration-200 cursor-pointer"
                    buttonText="Create Your First Draft"
                  />
                </div>
              ) : (
                <>
                  <div className="grid gap-4">
                    {drafts.map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        onOpen={() => handleOpenDraft(draft)}
                        onDelete={() => handleDeleteDraft(draft.id, draft.fileName)}
                        isOpening={openingDraftId === draft.id}
                      />
                    ))}
                  </div>

                  {/* Pagination */}
                  {pagination.total > pagination.limit && (
                    <div className="flex items-center justify-center gap-4 mt-8">
                      <button
                        onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                        disabled={pagination.offset === 0}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${pagination.offset === 0
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                      >
                        Previous
                      </button>
                      <span className="text-gray-600">
                        Page {Math.floor(pagination.offset / pagination.limit) + 1} of {Math.ceil(pagination.total / pagination.limit)}
                      </span>
                      <button
                        onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                        disabled={pagination.offset + pagination.limit >= pagination.total}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${pagination.offset + pagination.limit >= pagination.total
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Share Modal */}
      {selectedDraftId && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          draftId={selectedDraftId}
          googleFileId={drafts.find(d => d.id === selectedDraftId)?.googleFileId}
          documentTitle={drafts.find(d => d.id === selectedDraftId)?.fileName}
          accessToken={accessToken}
        />
      )}

      {/* Local File Upload Modal - Popup on same page with subtle blurred background */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={() => setIsUploadModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto border-2 border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Upload File from Local</h2>
                <button
                  onClick={() => setIsUploadModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <LocalFileUpload
                onUploadSuccess={handleLocalUploadSuccess}
                onUploadError={handleLocalUploadError}
                maxFileSize={100 * 1024 * 1024} // 100MB
                showEditorButton={false} // We'll handle opening in the success callback
                showUploadFlow={false} // Hide upload flow section
                className="mb-4"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DraftsPage;

