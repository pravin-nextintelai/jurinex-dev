/**
 * Template Drafting Component - Page Scroll Indicator
 * Shows current page number and navigation
 */

import React from 'react';
import { useUiStore } from '../../store/uiStore';

export const PageScrollIndicator: React.FC = () => {
    const currentPageNo = useUiStore(state => state.currentPageNo);
    const totalPages = useUiStore(state => state.totalPages);

    if (totalPages === 0) {
        return null;
    }

    return (
        <div className="page-scroll-indicator no-print">
            Page {currentPageNo} of {totalPages}
        </div>
    );
};
