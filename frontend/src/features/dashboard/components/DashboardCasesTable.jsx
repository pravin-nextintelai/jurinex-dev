import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Trash2, ChevronRight, Search, FolderOpen, Scale } from 'lucide-react';
import documentApi from '@/shared/api/documentApi';

// ── helpers (unchanged logic) ─────────────────────────────────────────────────

const getCourtDisplay = (c) => {
  if (c.court_name && typeof c.court_name === 'string') return c.court_name;
  if (c.court_level && typeof c.court_level === 'string') return c.court_level;
  return 'N/A';
};

const getCaseTypeDisplay = (c) => {
  if (c.case_type && typeof c.case_type === 'string') return c.case_type;
  if (c.sub_type && typeof c.sub_type === 'string') return c.sub_type;
  if (c.case_type && typeof c.case_type === 'number') return `Type ID: ${c.case_type}`;
  return 'N/A';
};

const getCaseName = (c) => {
  if (c.case_title && c.case_title !== 'Untitled Case') return c.case_title;
  const pNames = (c.petitioners || []).map(p => p.fullName || p.name).filter(Boolean);
  const rNames = (c.respondents || []).map(r => r.fullName || r.name).filter(Boolean);
  if (pNames.length && rNames.length) {
    const p = pNames.length === 1 ? pNames[0] : `${pNames[0]} & ${pNames.length - 1} Other${pNames.length - 1 > 1 ? 's' : ''}`;
    const r = rNames.length === 1 ? rNames[0] : `${rNames[0]} & ${rNames.length - 1} Other${rNames.length - 1 > 1 ? 's' : ''}`;
    return `${p} vs ${r}`;
  }
  if (pNames.length) return `${pNames[0]} (Petitioner)`;
  if (rNames.length) return `${rNames[0]} (Respondent)`;
  return c.case_title || 'Untitled Case';
};

const getPartiesDisplay = (c) => {
  let display = '';
  const pNames = (c.petitioners || []).map(p => p.fullName || p.name).filter(Boolean).join(', ');
  const rNames = (c.respondents || []).map(r => r.fullName || r.name).filter(Boolean).join(', ');
  if (pNames) display = pNames;
  if (rNames) display += (display ? ' vs ' : '') + rNames;
  return display || c.case_title || 'N/A';
};

const DISPOSED_STATUSES = ['Disposed', 'Completed', 'Closed', 'disposed', 'completed', 'closed'];

// ── status badge ──────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  if (DISPOSED_STATUSES.includes(status)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        {status}
      </span>
    );
  }
  if (['Pending', 'pending', 'Awaiting', 'awaiting'].includes(status)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      {status || 'Active'}
    </span>
  );
};

// ── skeleton row ──────────────────────────────────────────────────────────────

const SkeletonRow = () => (
  <tr className="border-b border-gray-100 animate-pulse">
    {[40, 28, 20, 36, 16, 16].map((w, i) => (
      <td key={i} className="px-5 py-4">
        <div className={`h-3 bg-gray-100 rounded-full w-${w}`} />
      </td>
    ))}
  </tr>
);

// ── mobile card ───────────────────────────────────────────────────────────────

const MobileCard = ({ caseItem, onView, onDelete }) => (
  <div
    className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm active:shadow-md transition-all duration-150 cursor-pointer"
    onClick={() => onView(caseItem.id)}
  >
    <div className="flex justify-between items-start mb-3">
      <div className="flex-1 min-w-0 pr-3">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
          {caseItem._caseName || 'Untitled Case'}
        </h3>
        <p className="text-xs text-gray-400 mt-1">{caseItem._courtDisplay}</p>
      </div>
      <StatusBadge status={caseItem.status} />
    </div>

    <div className="grid grid-cols-2 gap-2 mb-3">
      <div className="bg-gray-50 rounded-lg p-2">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Type</p>
        <p className="text-xs text-gray-700 mt-0.5 truncate">{caseItem._caseTypeDisplay}</p>
      </div>
      <div className="bg-gray-50 rounded-lg p-2">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Parties</p>
        <p className="text-xs text-gray-700 mt-0.5 truncate">{caseItem._partiesDisplay}</p>
      </div>
    </div>

    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); onView(caseItem.id); }}
          className="flex items-center gap-1 text-xs font-medium text-[#21C1B6] hover:text-[#1AA49B]"
        >
          <Eye size={13} /> View
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(caseItem.id); }}
          className="flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-600"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
      <ChevronRight size={15} className="text-gray-300" />
    </div>
  </div>
);

// ── empty state ───────────────────────────────────────────────────────────────

const EmptyState = ({ tab }) => (
  <tr>
    <td colSpan={6}>
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: '#f0fdfb' }}>
          <Scale size={26} style={{ color: '#21C1B6' }} />
        </div>
        <p className="text-gray-700 font-semibold text-sm">No {tab === 'ongoing' ? 'ongoing' : 'disposed'} cases</p>
        <p className="text-gray-400 text-xs mt-1 text-center max-w-xs">
          {tab === 'ongoing'
            ? 'All your active cases will appear here once created.'
            : 'Cases marked as disposed or closed will appear here.'}
        </p>
      </div>
    </td>
  </tr>
);

// ── main component ────────────────────────────────────────────────────────────

const DashboardCasesTable = () => {
  const [cases, setCases] = useState([]);
  const [advocateName, setAdvocateName] = useState('');
  const [filteredCases, setFilteredCases] = useState([]);
  const [activeTab, setActiveTab] = useState('ongoing');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [search, setSearch] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchCases = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await documentApi.getCases();
      let casesData = [];
      if (response.cases && Array.isArray(response.cases)) casesData = response.cases;
      else if (response.data && Array.isArray(response.data)) casesData = response.data;
      else if (Array.isArray(response)) casesData = response;
      console.log('Fetched cases:', casesData);
      const processed = casesData.map(c => ({
        ...c,
        _courtDisplay: getCourtDisplay(c),
        _caseTypeDisplay: getCaseTypeDisplay(c),
        _partiesDisplay: getPartiesDisplay(c),
        _caseName: getCaseName(c),
      }));
      setCases(processed);
      filterCasesByTab(processed, activeTab);
    } catch (err) {
      console.error('Error fetching cases:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const filterCasesByTab = (casesData, tab) => {
    let filtered = [];
    switch (tab) {
      case 'ongoing':
        filtered = casesData.filter(c => !DISPOSED_STATUSES.includes(c.status));
        break;
      case 'disposed':
        filtered = casesData.filter(c => DISPOSED_STATUSES.includes(c.status));
        break;
      default:
        filtered = casesData;
    }
    console.log(`Filtered ${tab} cases:`, filtered);
    setFilteredCases(filtered);
  };

  useEffect(() => {
    fetchCases();
    const storedUserName = localStorage.getItem('userName');
    if (storedUserName) setAdvocateName(storedUserName);
  }, []);

  useEffect(() => {
    filterCasesByTab(cases, activeTab);
  }, [activeTab, cases]);

  const handleTabChange = (tab) => setActiveTab(tab);

  const handleViewCase = (caseId) => navigate(`/cases/${caseId}`);

  const handleDeleteCase = async (caseId) => {
    if (window.confirm('Are you sure you want to delete this case? This action cannot be undone.')) {
      try {
        await documentApi.deleteCase(caseId);
        await fetchCases();
        alert('Case deleted successfully.');
      } catch (err) {
        console.error('Error deleting case:', err);
        alert(`Failed to delete case: ${err.message}`);
      }
    }
  };

  const getOngoingCount = () => cases.filter(c => !DISPOSED_STATUSES.includes(c.status)).length;
  const getDisposedCount = () => cases.filter(c => DISPOSED_STATUSES.includes(c.status)).length;

  const displayCases = search.trim()
    ? filteredCases.filter(c => {
        const q = search.toLowerCase();
        return (
          (c._caseName || '').toLowerCase().includes(q) ||
          (c._courtDisplay || '').toLowerCase().includes(q) ||
          (c._caseTypeDisplay || '').toLowerCase().includes(q) ||
          (c._partiesDisplay || '').toLowerCase().includes(q)
        );
      })
    : filteredCases;

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
        <p className="text-red-600 text-sm font-medium">Failed to load cases</p>
        <p className="text-red-400 text-xs mt-0.5">{error.message}</p>
        <button
          onClick={fetchCases}
          className="mt-3 px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-medium hover:bg-red-600 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
              My Cases
            </h2>
            <div className="flex-1 h-px bg-gray-100" style={{ minWidth: 40 }} />
          </div>
          {advocateName && (
            <span className="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
              {advocateName}
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cases…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
            style={{ '--tw-ring-color': '#21C1B6' }}
            onFocus={e => e.target.style.boxShadow = '0 0 0 2px #21C1B640'}
            onBlur={e => e.target.style.boxShadow = ''}
          />
        </div>
      </div>

      {/* Card */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-gray-100">
          {[
            { key: 'ongoing', label: 'Ongoing', count: getOngoingCount() },
            { key: 'disposed', label: 'Disposed', count: getDisposedCount() },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-colors rounded-t-lg
                ${activeTab === tab.key
                  ? 'text-[#21C1B6]'
                  : 'text-gray-400 hover:text-gray-600'
                }`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium
                ${activeTab === tab.key
                  ? 'bg-[#e6faf9] text-[#21C1B6]'
                  : 'bg-gray-100 text-gray-400'
                }`}>
                {tab.count}
              </span>
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#21C1B6]" />
              )}
            </button>
          ))}
        </div>

        {/* Mobile */}
        {isMobile ? (
          <div className="p-3 space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-gray-50 rounded-2xl p-4 animate-pulse">
                  <div className="h-3 bg-gray-200 rounded-full w-3/4 mb-2" />
                  <div className="h-2 bg-gray-100 rounded-full w-1/2" />
                </div>
              ))
            ) : displayCases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14">
                <Scale size={28} style={{ color: '#21C1B6' }} className="mb-3 opacity-60" />
                <p className="text-gray-500 text-sm font-medium">No cases found</p>
                {search && (
                  <p className="text-gray-400 text-xs mt-1">Try a different search term</p>
                )}
              </div>
            ) : (
              displayCases.map(c => (
                <MobileCard
                  key={c.id}
                  caseItem={c}
                  onView={handleViewCase}
                  onDelete={handleDeleteCase}
                />
              ))
            )}
          </div>
        ) : (
          /* Desktop table */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Case Name', 'Court / Bench', 'Case Type', 'Parties', 'Status', 'Actions'].map(h => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                ) : displayCases.length === 0 ? (
                  <EmptyState tab={search ? 'search' : activeTab} />
                ) : (
                  displayCases.map(c => (
                    <tr
                      key={c.id}
                      className="hover:bg-gray-50 transition-colors duration-100 group cursor-pointer"
                      onClick={() => handleViewCase(c.id)}
                    >
                      <td className="px-5 py-4 max-w-xs">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: '#f0fdfb' }}>
                            <FolderOpen size={13} style={{ color: '#21C1B6' }} />
                          </div>
                          <span
                            className="text-sm font-medium text-gray-900 truncate block max-w-[220px]"
                            title={c._caseName || 'Untitled Case'}
                          >
                            {c._caseName || 'Untitled Case'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-gray-500">
                        {c._courtDisplay}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-gray-500">
                        {c._caseTypeDisplay}
                      </td>
                      <td className="px-5 py-4 max-w-[200px]">
                        <span className="text-xs text-gray-500 truncate block" title={c._partiesDisplay}>
                          {c._partiesDisplay}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewCase(c.id); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#21C1B6] bg-[#f0fdfb] hover:bg-[#e6faf9] text-xs font-medium transition-colors"
                            title="View Case"
                          >
                            <Eye size={12} /> View
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCase(c.id); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-400 bg-red-50 hover:bg-red-100 text-xs font-medium transition-colors"
                            title="Delete Case"
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardCasesTable;
