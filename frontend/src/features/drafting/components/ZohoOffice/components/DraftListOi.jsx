/**
 * DraftListOi Component
 * 
 * Displays list of drafts with actions for Office Integrator.
 */
import React from 'react';

/**
 * @param {Object} props
 * @param {Array} props.drafts - List of drafts
 * @param {boolean} props.isLoading - Loading state
 * @param {Function} props.onEdit - Edit callback (draftId)
 * @param {Function} props.onDownload - Download callback (draftId)
 * @param {Function} props.onRefresh - Refresh callback
 */
const DraftListOi = ({
    drafts = [],
    isLoading = false,
    onEdit,
    onDownload,
    onRefresh,
    onRename,
    onDelete
}) => {
    // Local state for filtering and menu
    const [filterType, setFilterType] = React.useState('all');
    const [openMenuId, setOpenMenuId] = React.useState(null);

    // Filter Logic
    const filteredDrafts = React.useMemo(() => {
        if (filterType === 'all') return drafts;
        return drafts.filter(d => d.fileType === filterType);
    }, [drafts, filterType]);

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (e) => {
            if (openMenuId && !e.target.closest('.action-menu-container')) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openMenuId]);

    /**
     * Format date
     */
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    /**
     * Get status badge
     */
    const StatusBadge = ({ status }) => {
        const styles = {
            uploaded: 'bg-blue-50 text-blue-700 border-blue-200',
            oi_ready: 'bg-purple-50 text-purple-700 border-purple-200',
            synced: 'bg-green-50 text-green-700 border-green-200',
            deleted: 'bg-red-50 text-red-700 border-red-200'
        };

        const labels = {
            uploaded: 'Uploaded',
            oi_ready: 'Ready',
            synced: 'Saved',
            deleted: 'Deleted'
        };

        return (
            <span className={`px-2 py-0.5 text-xs rounded border ${styles[status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                {labels[status] || status}
            </span>
        );
    };

    /**
     * File type badge (Word, Excel, PowerPoint, PDF)
     */
    const FileTypeBadge = ({ fileType }) => {
        const config = {
            word: { label: 'Word', style: 'bg-blue-50 text-blue-600 border-blue-200' },
            excel: { label: 'Excel', style: 'bg-green-50 text-green-600 border-green-200' },
            powerpoint: { label: 'PowerPoint', style: 'bg-orange-50 text-orange-600 border-orange-200' },
            pdf: { label: 'Read-only', style: 'bg-gray-50 text-gray-600 border-gray-200' }
        };

        const { label, style } = config[fileType] || config.word;

        return (
            <span className={`px-2 py-0.5 text-xs rounded border ${style}`}>
                {label}
            </span>
        );
    };

    // Loading skeleton
    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-white">
                <div className="p-5 border-b border-gray-100">
                    <div className="h-6 w-32 bg-gray-100 rounded animate-pulse"></div>
                </div>
                <div className="p-5 space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm animate-pulse">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="h-4 bg-gray-100 rounded w-48 mb-2"></div>
                                    <div className="h-3 bg-gray-50 rounded w-32"></div>
                                </div>
                                <div className="flex gap-2">
                                    <div className="h-8 w-16 bg-gray-100 rounded"></div>
                                    <div className="h-8 w-16 bg-gray-100 rounded"></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Empty state
    if (drafts.length === 0 && filterType === 'all') {
        return (
            <div className="flex flex-col h-full bg-white">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Your Documents</h3>
                    <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <p className="text-gray-900 font-medium mb-1">No documents yet</p>
                    <p className="text-gray-500 text-sm">Upload a document to get started</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header with Filter */}
            <div className="p-5 border-b border-gray-100 bg-white sticky top-0 z-10 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                    Your Documents
                </h3>
                <div className="flex items-center gap-2">
                    {/* Filter Dropdown */}
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="bg-white text-gray-700 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    >
                        <option value="all">All Types</option>
                        <option value="word">Word</option>
                        <option value="excel">Excel</option>
                        <option value="powerpoint">PowerPoint</option>
                        <option value="pdf">PDF</option>
                    </select>

                    <button
                        onClick={onRefresh}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Refresh list"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* List Container */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                {filteredDrafts.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 text-sm">
                        No documents found matching current filter
                    </div>
                ) : (
                    filteredDrafts.map((draft) => (
                        <div
                            key={draft.id}
                            className="bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors shadow-sm relative group"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="flex items-center gap-3 mb-1">
                                        {/* Icon based on file type */}
                                        {(() => {
                                            const type = draft.fileType;
                                            if (type === 'excel') return (
                                                <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            );
                                            if (type === 'powerpoint') return (
                                                <svg className="w-6 h-6 text-orange-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                                </svg>
                                            );
                                            if (type === 'pdf') return (
                                                <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                </svg>
                                            );
                                            // Default Word
                                            return (
                                                <svg className="w-6 h-6 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            );
                                        })()}

                                        <span className="text-gray-900 font-semibold truncate text-base" title={draft.title}>
                                            {draft.title}
                                        </span>
                                        <FileTypeBadge fileType={draft.fileType} />
                                    </div>
                                    <div className="text-gray-500 text-xs flex items-center gap-2 pl-9">
                                        <StatusBadge status={draft.status} />
                                        <span>•</span>
                                        <span>
                                            {draft.lastSyncedAt
                                                ? `Saved: ${formatDate(draft.lastSyncedAt)}`
                                                : `Created: ${formatDate(draft.createdAt)}`
                                            }
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Edit/View Button */}
                                    {(() => {
                                        const type = draft.fileType;
                                        const isPdf = type === 'pdf';

                                        // Specific styles for buttons in white theme
                                        const buttonClass = isPdf
                                            ? 'text-gray-600 border-gray-300 hover:bg-gray-50 hover:text-gray-900'
                                            : 'text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300';

                                        const buttonLabel = isPdf ? 'View' : 'Edit';

                                        return (
                                            <button
                                                onClick={() => onEdit(draft.id)}
                                                className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${buttonClass}`}
                                            >
                                                {isPdf ? (
                                                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                )}
                                                {buttonLabel}
                                            </button>
                                        );
                                    })()}

                                    {/* Download Button */}
                                    <button
                                        onClick={() => onDownload(draft.id)}
                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                                        title="Download"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                    </button>

                                    {/* Action Menu (3 dots) */}
                                    <div className="relative action-menu-container">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(openMenuId === draft.id ? null : draft.id);
                                            }}
                                            className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                            </svg>
                                        </button>

                                        {/* Dropdown Menu */}
                                        {openMenuId === draft.id && (
                                            <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-xl z-20 py-1 origin-top-right ring-1 ring-black ring-opacity-5">
                                                {/* Download - Only for Word/PDF */}
                                                {['word', 'pdf'].includes(draft.fileType) && (
                                                    <button
                                                        onClick={() => {
                                                            onDownload(draft.id);
                                                            setOpenMenuId(null);
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                                    >
                                                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                        </svg>
                                                        Download
                                                    </button>
                                                )}

                                                {/* Rename */}
                                                <button
                                                    onClick={() => {
                                                        onRename(draft);
                                                        setOpenMenuId(null);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                                >
                                                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                    Rename
                                                </button>

                                                {/* Delete */}
                                                <button
                                                    onClick={() => {
                                                        onDelete(draft);
                                                        setOpenMenuId(null);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100 mt-1 pt-2"
                                                >
                                                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default DraftListOi;
