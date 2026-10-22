/**
 * Template Drafting Component - Action Toolbar
 * Top-left action buttons for PDF, print, export
 */

import React, { useState } from 'react';
import { useDraftStore } from '../../store/draftStore';
import { exportApi } from '../../services';
import { Logger } from '../../utils/logger';

export const ActionToolbar: React.FC = () => {
    const [isExporting, setIsExporting] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const draftId = useDraftStore(state => state.draftId);

    const handleDownloadPdf = () => {
        window.print();
        Logger.audit('PRINT_INITIATED', { draftId });
    };

    const handlePrint = () => {
        window.print();
        Logger.audit('PRINT_INITIATED', { draftId });
    };

    const handleExportDocx = async () => {
        if (!draftId || isExporting) return;

        setIsExporting(true);
        setIsDropdownOpen(false);

        try {
            Logger.info('EXPORT_DOCX_START', { draftId });

            const response = await exportApi.exportDocx(draftId);

            // Open download URL in new tab
            window.open(response.downloadUrl, '_blank');

            Logger.info('EXPORT_DOCX_SUCCESS', {
                draftId,
                fileName: response.fileName
            });
        } catch (error) {
            Logger.error('EXPORT_DOCX_FAILED', {
                draftId,
                error: (error as Error).message
            });
            alert('Failed to export document. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleFinalize = async () => {
        if (!draftId) return;

        const confirmed = window.confirm(
            'Are you sure you want to finalize this draft? This will lock it from further edits.'
        );

        if (!confirmed) {
            setIsDropdownOpen(false);
            return;
        }

        try {
            Logger.info('FINALIZE_START', { draftId });

            await exportApi.finalize(draftId);

            Logger.info('FINALIZE_SUCCESS', { draftId });

            alert('Draft finalized successfully!');
            setIsDropdownOpen(false);
        } catch (error) {
            Logger.error('FINALIZE_FAILED', {
                draftId,
                error: (error as Error).message
            });
            alert('Failed to finalize draft. Please try again.');
        }
    };

    return (
        <div className="action-toolbar no-print">
            <button
                className="action-toolbar__button"
                onClick={handleDownloadPdf}
                title="Print / Save as PDF"
            >
                📄 PDF
            </button>

            <button
                className="action-toolbar__button"
                onClick={handlePrint}
                title="Print document"
            >
                🖨️ Print
            </button>

            <div className={`action-toolbar__dropdown ${isDropdownOpen ? 'action-toolbar__dropdown--open' : ''}`}>
                <button
                    className="action-toolbar__button action-toolbar__button--primary"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                    {isExporting ? '⏳ Exporting...' : '📤 Export ▾'}
                </button>

                <div className="action-toolbar__dropdown-menu">
                    <div
                        className="action-toolbar__dropdown-item"
                        onClick={handleExportDocx}
                    >
                        📝 Export as DOCX
                    </div>
                    <div
                        className="action-toolbar__dropdown-item"
                        onClick={handleFinalize}
                    >
                        ✓ Finalize Draft
                    </div>
                </div>
            </div>
        </div>
    );
};
