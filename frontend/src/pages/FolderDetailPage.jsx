import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileManagerContext } from "../context/FileManagerContext";
import documentApi from "../services/documentApi";
import {
  ArrowLeft,
  Star,
  MoreVertical,
  Trash2,
} from "lucide-react";
import FolderContent from "../components/FolderContent/FolderContent";
import DocumentPreviewModal from "../components/DocumentPreviewModal";
import ChatInterface from "../components/ChatInterface/ChatInterface";
import { ChronologyButton, ChronologyModal } from "../components/Chronology";
import { toast } from "react-toastify";
import { CaseMemoryModal, MemoryButton } from "../components/CaseMemory";
import useMemorySettings from "../hooks/useMemorySettings";
import useMemoryTurnWatcher from "../hooks/useMemoryTurnWatcher";
import { describeTurnActivity, turnActivityTab } from "../utils/memoryLabels";

const FolderDetailPage = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const {
    setSelectedFolder,
    selectedFolder,
    loadFoldersAndFiles,
  } = useContext(FileManagerContext);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isChronologyOpen, setIsChronologyOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [memoryTab, setMemoryTab] = useState('memory');
  const [memoryChanged, setMemoryChanged] = useState(false);
  const [memoryRefresh, setMemoryRefresh] = useState(0);
  const memoryOpenRef = useRef(false);
  const [isStarred, setIsStarred] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // The Memory button follows the account-level switch, so it disappears as soon as
  // memory is turned off in Settings. A case that has memory switched off on its own
  // still shows the button, which is how the advocate switches it back on.
  const { effective: memoryEffective, loading: memorySettingsLoading } = useMemorySettings();
  const showMemoryButton = !memorySettingsLoading && memoryEffective.enabled;

  useEffect(() => {
    memoryOpenRef.current = isMemoryOpen;
  }, [isMemoryOpen]);

  // After each answer, say what memory did: an instruction saved, details
  // remembered, the case filled in from its details, or a suggestion waiting.
  const handleMemoryTurn = useCallback((turn) => {
    const message = describeTurnActivity(turn);
    if (!message) return;
    const tab = turnActivityTab(turn);
    setMemoryRefresh((count) => count + 1);
    if (!memoryOpenRef.current) {
      setMemoryTab(tab);
      setMemoryChanged(true);
    }
    toast.info(message, {
      autoClose: 8000,
      onClick: () => {
        setMemoryTab(tab);
        setMemoryChanged(false);
        setIsMemoryOpen(true);
      },
    });
  }, []);

  useMemoryTurnWatcher(folderName || selectedFolder, {
    enabled: showMemoryButton,
    onTurn: handleMemoryTurn,
  });

  useEffect(() => {
    if (folderName) {
      setSelectedFolder(folderName);
    }

    return () => {
      setSelectedFolder(null);
    };
  }, [folderName, setSelectedFolder]);

  useEffect(() => {
    loadFoldersAndFiles();
  }, [loadFoldersAndFiles]);

  const handleDocumentClick = (doc) => {
    setSelectedDocument(doc);
  };

  const handleClosePreview = () => {
    setSelectedDocument(null);
  };

  const handleOpenChronology = () => {
    setIsChronologyOpen(true);
  };

  const handleCloseChronology = () => {
    setIsChronologyOpen(false);
  };

  const handleOpenMemory = () => {
    setMemoryChanged(false);
    setIsMemoryOpen(true);
  };

  const handleCloseMemory = () => {
    setIsMemoryOpen(false);
    setMemoryTab('memory');
  };

  const handleToggleStar = () => {
    setIsStarred((prev) => !prev);
  };

  const handleDeleteFolder = async () => {
    const name = folderName || selectedFolder;
    if (!name) return;
    if (!window.confirm(`Delete case "${name}" and all its documents? This cannot be undone.`)) return;
    setIsDeleting(true);
    setShowMoreMenu(false);
    try {
      await documentApi.deleteFolderWithContents(name);
      navigate('/documents');
    } catch (err) {
      console.error('Failed to delete folder:', err);
      alert(`Failed to delete: ${err.response?.data?.error || err.message}`);
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden" style={{ background: '#f8fafc' }}>
      <div className="h-full flex flex-col mx-auto">

        {/* ── Top bar ── */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white relative" style={{ minHeight: '3rem' }}>
          <button
            onClick={() => navigate('/documents')}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-[#21C1B6] transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>All projects</span>
          </button>

          <h1 className="absolute left-1/2 -translate-x-1/2 text-sm font-bold text-gray-800 max-w-[min(60%,40rem)] truncate text-center px-2">
            {selectedFolder || 'Document Upload'}
          </h1>

          <div className="flex items-center gap-1 relative">
            <button
              type="button"
              onClick={handleToggleStar}
              aria-label="Star case"
              className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Star className={`w-4 h-4 transition-colors ${isStarred ? 'text-amber-400 fill-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
            </button>
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              aria-label="Case menu"
              className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors text-gray-400 hover:text-gray-600"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {showMoreMenu && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-50 overflow-hidden min-w-[160px]">
                <button
                  className="w-full text-left px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 flex items-center gap-2 transition-colors"
                  onClick={handleDeleteFolder}
                  disabled={isDeleting}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Deleting…' : 'Delete Case'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Chat (left) + Files panel (right) — both always visible */}
        <div className="flex-1 flex gap-2 p-2 overflow-hidden min-h-0">
          <div
            className="flex-1 min-w-0 h-full flex flex-col overflow-hidden rounded-xl bg-white border border-gray-100"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
          >
            <ChatInterface />
          </div>

          <div className="w-full max-w-[360px] min-w-[280px] flex flex-col h-full overflow-hidden flex-shrink-0">
            <div
              className="bg-white rounded-xl border border-gray-100 flex-1 flex flex-col overflow-hidden p-3 min-h-0"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
            >
              <div className="flex items-center gap-2 mb-2 flex-shrink-0 pb-2 border-b border-gray-100">
                <div
                  className="w-4 h-4 rounded flex items-center justify-center"
                  style={{ background: '#f0fdfb' }}
                >
                  <span className="text-[8px] font-bold" style={{ color: '#21C1B6' }}>
                    F
                  </span>
                </div>
                <h3 className="text-xs font-semibold text-gray-600">Files</h3>
                <div className="ml-auto flex items-center gap-0.5">
                  {showMemoryButton && <MemoryButton onClick={handleOpenMemory} badge={memoryChanged} />}
                  <ChronologyButton onClick={handleOpenChronology} />
                </div>
              </div>
              {selectedDocument ? (
                <DocumentPreviewModal document={selectedDocument} onClose={handleClosePreview} />
              ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <FolderContent onDocumentClick={handleDocumentClick} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {isChronologyOpen && (
        <ChronologyModal
          folderName={folderName || selectedFolder}
          caseTitle={selectedFolder || folderName}
          onClose={handleCloseChronology}
        />
      )}
      {isMemoryOpen && (
        <CaseMemoryModal
          folderName={folderName || selectedFolder}
          caseTitle={selectedFolder || folderName}
          onClose={handleCloseMemory}
          initialTab={memoryTab}
          refreshToken={memoryRefresh}
        />
      )}
    </div>
  );
};

export default FolderDetailPage;
