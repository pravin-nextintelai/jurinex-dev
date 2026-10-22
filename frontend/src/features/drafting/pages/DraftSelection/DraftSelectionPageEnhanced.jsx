import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  TrashIcon,
  Squares2X2Icon,
  Bars3Icon,
  ArrowsUpDownIcon,
  ArrowPathIcon,
  FolderIcon,
  EllipsisVerticalIcon,
  UserIcon,
  ClockIcon,
  TagIcon,
  GlobeAltIcon,
  CalendarIcon,
  EyeIcon,
  StarIcon
} from '@heroicons/react/24/outline';
import DraftSelectionCard from '../../components/DraftComponents/DraftSelectionCard';
import WordLogo from '@/assets/Wordlogo.svg.png';
import ZohoLogo from '@/assets/zoho-logo-web.png';
import draftApi from '../../api/draftApi';
import { toast } from 'react-toastify';
import { TemplateWizardGallery } from '../../components/TemplateWizard';
import { createDraft, listDrafts, deleteDraft } from '../../api/draftFormApi';
import './styles/enhanced-draft-selection.css';
import '../../components/TemplateWizard/TemplateWizardGallery.css';

const DRAFTS_PER_PAGE = 5;
const LIST_DRAFTS_TIMEOUT_MS = 8000; // Stop waiting so user isn't stuck when backend is busy (e.g. section generation)

// Module-level cache — persists across navigation, cleared only on page refresh
let _draftsCache = null;
// In-flight promise — shared so React StrictMode's double-invoke reuses one fetch
let _draftsFetchPromise = null;

const DraftSelectionPageEnhanced = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [recentDrafts, setRecentDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState(null);
  const [draftsPage, setDraftsPage] = useState(1);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  const loadDrafts = React.useCallback(async (showRefreshSpinner = false) => {
    // Use cache on navigation back — skip fetch unless user explicitly refreshes
    if (!showRefreshSpinner && _draftsCache !== null) {
      setRecentDrafts(_draftsCache);
      return;
    }
    // Reuse an already-in-flight fetch (React StrictMode fires effects twice in dev)
    if (!showRefreshSpinner && _draftsFetchPromise) {
      try { setRecentDrafts((await _draftsFetchPromise) ?? []); } catch { /* ignore */ }
      return;
    }
    if (showRefreshSpinner) setLoadingDrafts(true);
    // Start the fetch and store the promise before the first await so the
    // second StrictMode invocation sees it synchronously.
    _draftsFetchPromise = listDrafts(null, 20, 0);
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), LIST_DRAFTS_TIMEOUT_MS)
      );
      const res = await Promise.race([_draftsFetchPromise, timeoutPromise]);
      const drafts = res?.success && Array.isArray(res.drafts) ? res.drafts : [];
      _draftsCache = drafts;
      setRecentDrafts(drafts);
    } catch (err) {
      setRecentDrafts(_draftsCache ?? []);
      if (err?.message === 'timeout') {
        toast.info('Documents are loading in the background. Click refresh to try again.');
      }
    } finally {
      _draftsFetchPromise = null;
      setLoadingDrafts(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts(false);
  }, [loadDrafts]);

  const draftOptions = [
    {
      id: 'google-docs',
      title: 'Google Docs',
      description: 'Create and edit documents with Google Docs integration. Collaborate in real-time with cloud storage.',
      icon: 'google',
      iconBgColor: '#4285F4',
      route: '/drafts?platform=google-docs',
      disabled: false
    },
    {
      id: 'microsoft-word',
      title: 'Microsoft Word',
      description: 'Use Microsoft Word for professional document drafting. Full Office 365 integration available.',
      icon: 'microsoft',
      iconBgColor: '#2B579A',
      logo: WordLogo,
      route: '/drafting?platform=microsoft-word',
      disabled: false
    },
    {
      id: 'template-based',
      title: 'Zoho Office',
      description: 'Start with pre-built legal templates and customize them to your needs.',
      icon: 'template',
      iconBgColor: '#9C27B0',
      logo: ZohoLogo,
      logoSize: 'large',
      route: '/draft/zoho-office',
      disabled: false
    }
  ];

  const handleMicrosoftWordClick = async () => {
    try {
      setIsConnecting(true);

      const connectionStatus = await draftApi.getMicrosoftStatus();

      if (connectionStatus.isConnected) {
        navigate('/draft/microsoft-word');
      } else {
        await draftApi.signInWithMicrosoft();
      }
    } catch (error) {
      console.error('Error connecting to Microsoft Word:', error);
      toast.error('Failed to connect to Microsoft Office. Please try again.');
      setIsConnecting(false);
    }
  };

  const handleCardClick = (option) => {
    if (option.id === 'microsoft-word') {
      handleMicrosoftWordClick();
    } else {
      navigate(option.route);
    }
  };

  const handleDeleteDraft = async (e, draftId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      setDeletingDraftId(draftId);
      await deleteDraft(draftId);
      setRecentDrafts((prev) => {
        const updated = prev.filter((d) => d.draft_id !== draftId);
        _draftsCache = updated;
        return updated;
      });
      setDraftsPage((p) => {
        const nextCount = recentDrafts.length - 1;
        const totalPages = Math.max(1, Math.ceil(nextCount / DRAFTS_PER_PAGE));
        return p > totalPages ? totalPages : p;
      });
      toast.success('Draft deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete draft');
    } finally {
      setDeletingDraftId(null);
    }
  };

  const draftsPagination = useMemo(() => {
    const total = recentDrafts.length;
    const totalPages = Math.max(1, Math.ceil(total / DRAFTS_PER_PAGE));
    const page = Math.min(Math.max(1, draftsPage), totalPages);
    const start = (page - 1) * DRAFTS_PER_PAGE;
    const paginatedDrafts = recentDrafts.slice(start, start + DRAFTS_PER_PAGE);
    return { paginatedDrafts, page, totalPages, total };
  }, [recentDrafts, draftsPage]);

  const handleTemplateClick = async (template) => {
    const templateId = template.id ?? template.template_id;
    const templateName = template.name ?? template.title;
    if (!templateId) return;
    try {
      setIsCreatingDraft(true);
      // Always create a new draft from the gallery so the user gets a clean form (no case, no field values).
      // Use "Recent drafts" to continue an existing draft.
      const res = await createDraft(templateId, templateName ? `${templateName} - Draft` : '');
      const draftId = res?.draft?.draft_id;
      if (draftId) {
        _draftsCache = null; // invalidate so next visit re-fetches the new draft
        navigate(`/draft-form/${draftId}`);
      } else {
        toast.error('Draft created but no draft ID returned.');
      }
    } catch (error) {
      console.error('Error opening template:', error);
      toast.error(error.message || 'Failed to open template. Please try again.');
    } finally {
      setIsCreatingDraft(false);
    }
  };

  // Default view: cards + template gallery
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Document Drafting
          </h1>
          <p className="text-gray-600 text-sm">
            Select the platform you prefer to create and manage your legal documents
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {draftOptions.map((option) => (
            <DraftSelectionCard
              key={option.id}
              title={option.title}
              description={option.description}
              icon={option.icon}
              iconBgColor={option.iconBgColor}
              logo={option.logo}
              logoSize={option.logoSize}
              onClick={() => handleCardClick(option)}
              disabled={option.disabled || (option.id === 'microsoft-word' && isConnecting)}
            />
          ))}
        </div>

        {/* Template Gallery – fetches from agent-draft API and shows preview images */}
        <div className="mb-10 p-6 sm:p-8 rounded-2xl bg-white border border-gray-200/80 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Template Gallery
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Browse and select from our collection of legal document templates
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/draft-selection/templates')}
              className="inline-flex items-center text-sm font-medium text-[#21C1B6] hover:text-[#1AA49B] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6] rounded-md transition-colors"
            >
              See all
            </button>
          </div>
          <TemplateWizardGallery key={location.key} onTemplateClick={handleTemplateClick} />
        </div>

        {/* Recent drafts – latest drafts */}
        <div className="mb-12">
          {/* Recent Documents Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pt-6 border-t border-gray-100">
            <h2 className="text-xl font-medium text-gray-800">
              Recent documents
            </h2>

            <div className="flex items-center gap-4 sm:gap-8">
              <div className="flex items-center gap-1 sm:gap-3">
                {/* View switcher */}
                <button
                  onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                  title={viewMode === 'grid' ? 'List view' : 'Grid view'}
                >
                  {viewMode === 'grid' ? (
                    <Bars3Icon className="w-5 h-5" />
                  ) : (
                    <Squares2X2Icon className="w-5 h-5" />
                  )}
                </button>

                {/* Refresh list (e.g. after returning while section generation was running) */}
                <button
                  onClick={() => loadDrafts(true)}
                  disabled={loadingDrafts}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
                  title="Refresh documents"
                >
                  <ArrowPathIcon className={`w-5 h-5 ${loadingDrafts ? 'animate-spin' : ''}`} />
                </button>
                {/* Sort */}
                <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors" title="Sort options">
                  <ArrowsUpDownIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {recentDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-200 shadow-sm text-center px-6">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <DocumentTextIcon className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">No documents yet</h3>
              <p className="text-gray-500 max-w-sm">
                Choose a template above or click "Custom Template" to start your first legal draft.
              </p>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="recent-draft-grid">
                  {draftsPagination.paginatedDrafts.map((d) => (
                    <div
                      key={d.draft_id}
                      role="button"
                      tabIndex={0}
                      className="template-wizard-card group flex flex-col bg-white overflow-hidden cursor-pointer border border-gray-200 rounded-lg"
                      onClick={() => navigate(`/draft-form/${d.draft_id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/draft-form/${d.draft_id}`); }}
                    >
                      {/* Preview area — fills exactly like template card image area */}
                      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100">
                        {/* Tags */}
                        <div className="absolute top-2 left-2 right-2 flex justify-between items-center z-10">
                          <div className="flex items-center gap-1 bg-white/90 px-1.5 py-0.5 rounded-full border border-gray-100 shadow-sm">
                            <TagIcon className="w-2.5 h-2.5 text-blue-500" />
                            <span className="text-[9px] font-bold text-gray-700 uppercase tracking-tight">
                              {d.template_category || d.category || (d.template_name || 'Legal').split(' ')[0]}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 bg-green-50/90 px-1.5 py-0.5 rounded-full border border-green-100">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-[9px] font-bold text-green-700 uppercase tracking-tight">Active</span>
                          </div>
                        </div>

                        {/* W icon */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                            <span className="text-white text-2xl font-bold font-serif">W</span>
                          </div>
                        </div>

                        {/* Delete */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteDraft(e, d.draft_id); }}
                          className="absolute bottom-2 right-2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all opacity-0 group-hover:opacity-100 z-10 bg-white/80 border border-gray-100"
                          title="Delete"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Footer — same structure as template card footer */}
                      <div className="p-2.5 flex-shrink-0 bg-white border-t border-gray-100">
                        <h3 className="text-sm font-medium text-gray-800 truncate tracking-tight block w-full">
                          {d.draft_title || d.template_name || 'Untitled draft'}
                        </h3>
                        <div className="flex items-center gap-1 mt-0.5">
                          <CalendarIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-[10px] text-gray-400 truncate">
                            {d.updated_at ? new Date(d.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-bottom border-gray-200">
                        <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Last modified</th>
                        <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {draftsPagination.paginatedDrafts.map((d) => (
                        <tr
                          key={d.draft_id}
                          className="hover:bg-blue-50/30 transition-colors cursor-pointer group text-sm"
                          onClick={() => navigate(`/draft-form/${d.draft_id}`)}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-blue-50 dark:bg-blue-900/10 flex items-center justify-center flex-shrink-0">
                                <DocumentTextIcon className="w-4 h-4 text-blue-600" />
                              </div>
                              <span className="font-medium text-gray-900 truncate max-w-xs sm:max-w-md">
                                {d.draft_title || d.template_name || 'Untitled draft'}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-gray-900">
                                {d.updated_at ? new Date(d.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
                              </span>
                              <span className="text-[11px] text-gray-500">
                                Last opened {d.updated_at ? new Date(d.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteDraft(e, d.draft_id);
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="Delete"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                              <button
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <EllipsisVerticalIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination (kept similar but styled) */}
              {draftsPagination.totalPages > 1 && (
                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 py-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">
                    Showing {((draftsPagination.page - 1) * DRAFTS_PER_PAGE) + 1}–{Math.min(draftsPagination.page * DRAFTS_PER_PAGE, draftsPagination.total)} of {draftsPagination.total} documents
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDraftsPage((p) => Math.max(1, p - 1))}
                      disabled={draftsPagination.page <= 1}
                      className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-1 mx-2">
                      {Array.from({ length: draftsPagination.totalPages }, (_, i) => i + 1).map(p => (
                        <button
                          key={p}
                          onClick={() => setDraftsPage(p)}
                          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${draftsPage === p ? 'bg-[#21C1B6] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraftsPage((p) => Math.min(draftsPagination.totalPages, p + 1))}
                      disabled={draftsPagination.page >= draftsPagination.totalPages}
                      className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      aria-label="Next page"
                    >
                      <ChevronRightIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {(isConnecting || isCreatingDraft) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-8 text-center max-w-md">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {isCreatingDraft ? 'Opening template...' : 'Connecting to Microsoft Word'}
              </h3>
              <p className="text-gray-600">
                {isCreatingDraft ? 'Creating your draft and loading the form.' : 'Please wait while we redirect you to Microsoft Office...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftSelectionPageEnhanced;
