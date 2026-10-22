import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, FolderOpen, Calendar, FileEdit, Trash2, Scale, ChevronLeft, ChevronRight, Palette, HardDrive, Info } from 'lucide-react';
import { FileManagerContext } from '@/shared/context/FileManagerContext';
import { useAuth } from '@/shared/context';
import CreateFolderModal from '@/features/case-storage/components/CreateFolderModal';
import CaseCreationFlow from '../components/CreateCase/CaseCreationFlow';
import { CONTENT_SERVICE_DIRECT, PAYMENT_SERVICE_URL } from '@/config/apiConfig';
import { canUsePermission, PERMISSION_KEYS } from '@/shared/utils/permissions';

const getUserIdFromToken = () => {
  try {
    const token = localStorage.getItem('token') ||
      localStorage.getItem('authToken') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('jwt');
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    const userId = parsed.id || parsed.userId || parsed.user_id || parsed.sub;
    const userIdInt = parseInt(userId, 10);
    return isNaN(userIdInt) || userIdInt <= 0 ? null : userIdInt;
  } catch (error) {
    console.error('Error extracting user ID:', error);
    return null;
  }
};

// ── Skeleton card ─────────────────────────────────────────────────────────────
const SkeletonCard = () => (
  <div className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
    <div className="w-10 h-10 rounded-xl bg-gray-100 mb-4" />
    <div className="h-3.5 bg-gray-100 rounded-full w-4/5 mb-2" />
    <div className="h-3 bg-gray-100 rounded-full w-2/5" />
  </div>
);

// ── Project card ──────────────────────────────────────────────────────────────
const formatStorage = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
};

// ── Case storage chip + hover card ───────────────────────────────────────────
// Bar turns green while usage is small, yellow above half, red when near full.
const storageBarColor = (pct) => (pct < 50 ? '#22c55e' : pct < 85 ? '#eab308' : '#ef4444');
// Remaining (unfilled) portion: light tint of the same color.
const storageTrackColor = (pct) => (pct < 50 ? '#dcfce7' : pct < 85 ? '#fef9c3' : '#fee2e2');

const CaseStorageChip = ({ summary, limitBytes }) => {
  const [open, setOpen] = useState(false);
  if (!summary) return null;
  const used = Number(summary.total_bytes) || 0;
  const limit = Number(limitBytes) || 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color = storageBarColor(pct);
  const pctLabel = limit > 0 ? (pct > 0 && pct < 1 ? '<1% used' : `${Math.round(pct)}% used`) : null;

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        title="Case storage details"
      >
        <HardDrive className="w-4 h-4" style={{ color }} />
        {formatStorage(used)}
        <Info className="w-3.5 h-3.5 text-gray-300" />
      </div>

      {open && (
      <div className="absolute right-0 top-full z-50" style={{ paddingTop: 6 }}>
      <div className="w-72 bg-white rounded-xl border border-gray-200 shadow-xl p-4">
        <p className="text-[11px] font-bold text-gray-700 tracking-wide uppercase mb-3">Case Storage</p>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: storageTrackColor(pct) }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%`, background: color }}
          />
        </div>
        {pctLabel && <p className="text-[11px] text-gray-400 text-right mt-1">{pctLabel}</p>}
        <div className="border-t border-gray-100 mt-3 pt-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">Used</span>
            <span className="font-semibold text-gray-800">
              {formatStorage(used)}{limit > 0 ? ` / ${formatStorage(limit)}` : ''}
            </span>
          </div>
          {limit > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">Available</span>
              <span className="font-semibold text-gray-800">{formatStorage(Math.max(0, limit - used))}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Documents</span>
            <span className="font-semibold text-gray-800">{formatStorage(summary.files_bytes)} · {summary.file_count} {summary.file_count === 1 ? 'file' : 'files'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Case chat history</span>
            <span className="font-semibold text-gray-800">{formatStorage(summary.chat_bytes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Cases</span>
            <span className="font-semibold text-gray-800">{summary.case_count}</span>
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
};

const ProjectCard = ({ folder, onClick }) => {
  const dateStr = folder.created_at
    ? new Date(folder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div
      className="group bg-white rounded-2xl border border-gray-100 p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
      onClick={onClick}
    >
      {/* top accent */}
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'linear-gradient(90deg, #21C1B6, #1AA49B)' }} />

      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-all duration-200 group-hover:scale-105"
        style={{ background: '#f0fdfb' }}>
        <FolderOpen className="w-5 h-5" style={{ color: '#21C1B6' }} />
      </div>

      <h3 className="text-sm font-semibold text-gray-800 mb-3 leading-snug line-clamp-2 group-hover:text-[#21C1B6] transition-colors duration-150">
        {folder.case_title || folder.name}
      </h3>

      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <Calendar className="w-3 h-3 flex-shrink-0" />
        <span>Updated {dateStr}</span>
      </div>
    </div>
  );
};

// ── Draft card ────────────────────────────────────────────────────────────────
const DraftCard = ({ draftData, onClick, onDelete }) => {
  const dateStr = draftData.updated_at
    ? new Date(draftData.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div
      className="group bg-white rounded-2xl border cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden p-5"
      style={{ borderColor: '#21C1B620', boxShadow: '0 1px 4px rgba(33,193,182,0.08)' }}
      onClick={onClick}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
        style={{ background: 'linear-gradient(90deg, #21C1B6, #1AA49B)' }} />

      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#f0fdfb' }}>
          <FileEdit className="w-5 h-5" style={{ color: '#21C1B6' }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#21C1B6' }}>
            DRAFT
          </span>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-all"
            title="Delete draft"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-gray-800 mb-3 leading-snug line-clamp-2 group-hover:text-[#21C1B6] transition-colors duration-150">
        {draftData.draft_data?.caseTitle || 'Untitled Case Draft'}
      </h3>

      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <Calendar className="w-3 h-3 flex-shrink-0" />
        <span>Updated {dateStr}</span>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const DocumentUploadPage = () => {
  const { folders, storageSummary, loadFoldersAndFiles, createFolder, loading, error } = useContext(FileManagerContext);
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [filterBy, setFilterBy] = useState('all');
  const [showCaseFlow, setShowCaseFlow] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [caseData, setCaseData] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [draftData, setDraftData] = useState(null);
  const [_loadingDraft, setLoadingDraft] = useState(false);
  const [openDraftDirectly, setOpenDraftDirectly] = useState(false);
  // Plan storage limit (same source as the billing page) for the usage bar.
  // Must live ABOVE the showCaseFlow early return — hooks after a conditional
  // return crash React ("Rendered fewer hooks than expected").
  const [storageLimitBytes, setStorageLimitBytes] = useState(null);
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${PAYMENT_SERVICE_URL}/api/storage/usage`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.limitBytes) setStorageLimitBytes(Number(d.limitBytes)); })
      .catch(() => {});
  }, []);
  const foldersPerPage = 6;
  const navigate = useNavigate();
  const canCreateCases = canUsePermission(user, PERMISSION_KEYS.CREATE_CASE);

  useEffect(() => {
    loadFoldersAndFiles();
    loadDraft();
  }, [loadFoldersAndFiles]);

  const loadDraft = async () => {
    const userId = getUserIdFromToken();
    if (!userId) return;
    setLoadingDraft(true);
    try {
      const token = localStorage.getItem('token') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('jwt');
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-draft/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.exists === false || !result.draft_data) { setDraftData(null); return; }
        const parsedDraft = {
          ...result,
          draft_data: typeof result.draft_data === 'string' ? JSON.parse(result.draft_data) : result.draft_data
        };
        setDraftData(parsedDraft);
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleStartCaseFlow = () => {
    if (!canCreateCases) return;
    setOpenDraftDirectly(false);
    setShowCaseFlow(true);
  };

  const handleDraftClick = () => {
    if (!canCreateCases) return;
    setOpenDraftDirectly(true);
    setShowCaseFlow(true);
  };

  const handleDeleteDraft = async (e) => {
    e.stopPropagation();
    const confirmDelete = window.confirm('Are you sure you want to delete this draft? This action cannot be undone.');
    if (!confirmDelete) return;
    try {
      const token = localStorage.getItem('token') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('jwt_token');
      if (!token) { console.error('No auth token found'); return; }
      const userId = getUserIdFromToken();
      if (!userId) { console.error('Could not extract user ID from token'); return; }
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-draft/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (response.ok) { console.log('✅ Draft deleted successfully'); loadDraft(); }
      else { console.error('Failed to delete draft:', response.statusText); alert('Failed to delete draft. Please try again.'); }
    } catch (error) {
      console.error('Error deleting draft:', error);
      alert('An error occurred while deleting the draft.');
    }
  };

  const handleCaseFlowComplete = (data) => {
    let caseName = data.caseTitle;
    if (!caseName || caseName === 'Untitled Case') {
      const pNames = (data.petitioners || []).map(p => p.fullName).filter(Boolean);
      const rNames = (data.respondents || []).map(r => r.fullName).filter(Boolean);
      if (pNames.length && rNames.length) {
        const p = pNames.length === 1 ? pNames[0] : `${pNames[0]} & ${pNames.length - 1} Other${pNames.length - 1 > 1 ? 's' : ''}`;
        const r = rNames.length === 1 ? rNames[0] : `${rNames[0]} & ${rNames.length - 1 > 1 ? 's' : ''}`;
        caseName = `${p} vs ${r}`;
      } else if (pNames.length) caseName = `${pNames[0]} (Petitioner)`;
      else if (rNames.length) caseName = `${rNames[0]} (Respondent)`;
      else caseName = 'Untitled Case';
    }
    setCaseData({ ...data, caseTitle: caseName });
    setShowCaseFlow(false);
    setIsCreatingFolder(true);
    loadDraft();
  };

  const handleCreateFolder = async (folderName) => {
    await createFolder(folderName);
    setIsCreatingFolder(false);
    setCaseData(null);
    navigate(`/documents/${folderName}`);
  };

  const handleProjectClick = (folderName) => navigate(`/documents/${folderName}`);

  const sorted = [...folders].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const filtered = sorted.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.case_title && f.case_title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const shouldShowDraft = filterBy === 'all' || filterBy === 'drafts';
  const shouldShowProjects = filterBy === 'all' || filterBy === 'projects';
  const projectsToShow = shouldShowProjects ? filtered : [];

  const totalPages = Math.ceil(projectsToShow.length / foldersPerPage);
  const indexOfLastFolder = currentPage * foldersPerPage;
  const indexOfFirstFolder = indexOfLastFolder - foldersPerPage;
  const currentFolders = projectsToShow.slice(indexOfFirstFolder, indexOfLastFolder);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (showCaseFlow) {
    return (
      <CaseCreationFlow
        onComplete={handleCaseFlowComplete}
        onCancel={() => { setShowCaseFlow(false); setOpenDraftDirectly(false); loadDraft(); }}
        skipDraftPrompt={openDraftDirectly}
      />
    );
  }

  const isEmpty = (!shouldShowDraft || !draftData || !draftData.draft_data) && projectsToShow.length === 0;

  // Total storage across ALL cases (documents + case chat history). Prefer the
  // server summary; fall back to summing folder file sizes client-side.
  const caseStorage = storageSummary ?? (folders.length
    ? (() => {
        const filesBytes = folders.reduce((s, f) => s + (Number(f.storage_bytes)
          || (Array.isArray(f.children) ? f.children.reduce((a, c) => a + (Number(c.size) || 0), 0) : 0)), 0);
        return {
          files_bytes: filesBytes,
          chat_bytes: 0,
          total_bytes: filesBytes,
          case_count: folders.length,
          file_count: folders.reduce((s, f) => s + (f.document_count ?? (Array.isArray(f.children) ? f.children.length : 0)), 0),
        };
      })()
    : null);

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f0fdfb' }}>
                <Scale className="w-4 h-4" style={{ color: '#21C1B6' }} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
            </div>
            <p className="text-sm text-gray-400 ml-10">Manage and organize your legal case files</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <CaseStorageChip summary={caseStorage} limitBytes={storageLimitBytes} />
            <button
              onClick={() => navigate('/batch-request')}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all duration-200 cursor-pointer"
              title="Send bulk AI queries via Gemini Batch API"
            >
              <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Batch Requests
            </button>
            <button
              onClick={() => navigate('/branding')}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all duration-200 cursor-pointer"
              title="Manage Custom Branding"
            >
              <Palette className="w-4 h-4 text-teal-600" />
              Custom Branding
            </button>
            <button
              onClick={handleStartCaseFlow}
              disabled={!canCreateCases}
              className={`flex items-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all duration-200 ${canCreateCases ? 'hover:shadow-md hover:-translate-y-0.5' : 'cursor-not-allowed opacity-50'}`}
              style={{ background: '#21C1B6' }}
              onMouseEnter={(e) => { if (canCreateCases) e.currentTarget.style.background = '#1AA49B'; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#21C1B6')}
              title={!canCreateCases ? 'You do not have permission to create new cases' : undefined}
            >
              <Plus className="w-4 h-4" />
              Create New Case
            </button>
          </div>
        </div>

        {/* ── Search & Filters ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none transition-all bg-gray-50 text-gray-800 placeholder-gray-400"
              onFocus={e => { e.target.style.borderColor = '#21C1B6'; e.target.style.boxShadow = '0 0 0 3px #21C1B615'; }}
              onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = ''; }}
            />
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Filter</span>
            <select
              value={filterBy}
              onChange={(e) => { setFilterBy(e.target.value); setCurrentPage(1); }}
              className="px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700 focus:outline-none cursor-pointer transition-all"
              onFocus={e => e.target.style.borderColor = '#21C1B6'}
              onBlur={e => e.target.style.borderColor = '#e5e7eb'}
            >
              <option value="all">All</option>
              <option value="drafts">Drafts</option>
              <option value="projects">Projects</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700 focus:outline-none cursor-pointer transition-all"
              onFocus={e => e.target.style.borderColor = '#21C1B6'}
              onBlur={e => e.target.style.borderColor = '#e5e7eb'}
            >
              <option value="activity">Recent Activity</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-red-50">
              <FolderOpen className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">Failed to load projects</h3>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#f0fdfb' }}>
              <Scale className="w-8 h-8" style={{ color: '#21C1B6' }} />
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              {filterBy === 'drafts' ? 'No drafts found' : filterBy === 'projects' ? 'No projects found' : 'No items found'}
            </h3>
            <p className="text-sm text-gray-400 mb-5">
              {searchQuery ? 'Try adjusting your search terms' : 'Get started by creating your first legal case'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleStartCaseFlow}
                className="inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ background: '#21C1B6' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1AA49B'}
                onMouseLeave={e => e.currentTarget.style.background = '#21C1B6'}
              >
                <Plus className="w-4 h-4" />
                Create Your First Case
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shouldShowDraft && draftData && draftData.draft_data && (
                <DraftCard
                  key="draft-folder"
                  draftData={draftData}
                  onClick={handleDraftClick}
                  onDelete={handleDeleteDraft}
                />
              )}
              {currentFolders.map((folder) => (
                <ProjectCard
                  key={folder.id}
                  folder={folder}
                  onClick={() => handleProjectClick(folder.name)}
                />
              ))}
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-1.5 mt-8">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#21C1B6] hover:text-[#21C1B6] transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className="w-9 h-9 rounded-xl text-sm font-semibold border transition-all"
                    style={currentPage === page
                      ? { background: '#21C1B6', color: '#fff', borderColor: '#21C1B6' }
                      : { background: '#fff', color: '#6b7280', borderColor: '#e5e7eb' }}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#21C1B6] hover:text-[#21C1B6] transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Count ── */}
        {filtered.length > 0 && !loading && (
          <div className="mt-5 text-center text-xs text-gray-400 font-medium">
            Showing {indexOfFirstFolder + 1}–{Math.min(indexOfLastFolder, filtered.length)} of {filtered.length} project{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <CreateFolderModal
        isOpen={isCreatingFolder}
        onClose={() => { setIsCreatingFolder(false); setCaseData(null); }}
        onCreate={handleCreateFolder}
        initialName={caseData?.caseTitle || ''}
      />
    </div>
  );
};

export default DocumentUploadPage;
