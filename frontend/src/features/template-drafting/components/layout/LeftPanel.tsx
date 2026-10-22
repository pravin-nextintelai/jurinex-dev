/**
 * Template Drafting Component - Left Panel
 * Displays document preview (Virtual Layout or HTML Fallback)
 */

import React, { useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useDraftStore } from '../../store/draftStore';
import { useUiStore } from '../../store/uiStore';
import { A4PageRenderer } from '../preview/A4PageRenderer';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Logger } from '../../utils/logger';

export const LeftPanel: React.FC = () => {
    const draftId = useDraftStore(state => state.draftId);
    const isLoading = useDraftStore(state => state.isLoading);
    const layoutPages = useDraftStore(state => state.layoutPages); // LAYOUT PAGES
    const hasLayout = useDraftStore(state => state.hasLayout);

    // Fallback states
    const fallbackHtmlPages = useDraftStore(state => state.fallbackHtmlPages);
    const previewHtml = useDraftStore(state => state.previewHtml); // Deprecated but might exist

    // UI state
    const isLeftPanelCollapsed = useUiStore(state => state.isLeftPanelCollapsed);
    const zoomLevel = useUiStore(state => state.zoomLevel);

    useEffect(() => {
        if (draftId) {
            Logger.info('LEFT_PANEL_MOUNTED', { draftId, hasLayout });
        }
    }, [draftId, hasLayout]);

    // RENDER: 1. Layout Structure (Preferred)
    if (hasLayout && layoutPages.length > 0) {
        return (
            <div className={`split-view__left ${isLeftPanelCollapsed ? 'collapsed' : ''}`}>
                <div className="preview-container" style={{ height: '100%', overflow: 'hidden' }}>
                    <Virtuoso
                        style={{ height: '100%', width: '100%' }}
                        totalCount={layoutPages.length}
                        overscan={2} // Render 2 pages ahead
                        itemContent={(index) => (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                paddingBottom: '32px',
                                transform: `scale(${zoomLevel})`,
                                transformOrigin: 'top center'
                            }}>
                                <A4PageRenderer layoutPage={layoutPages[index]} pageNo={index + 1} />
                            </div>
                        )}
                    />
                </div>
            </div>
        );
    }

    // RENDER: 2. Fallback HTML Pages (Legacy)
    if (fallbackHtmlPages && fallbackHtmlPages.length > 0) {
        return (
            <div className={`split-view__left ${isLeftPanelCollapsed ? 'collapsed' : ''}`}>
                <div className="preview-container" style={{ overflowY: 'auto', height: '100%' }}>
                    <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}>
                        {fallbackHtmlPages.map(page => (
                            <div
                                key={page.pageNo}
                                className="a4-page-wrapper"
                                style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}
                                dangerouslySetInnerHTML={{ __html: page.html }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // RENDER: 3. Basic HTML Preview (Last Resort)
    if (previewHtml) {
        return (
            <div className={`split-view__left ${isLeftPanelCollapsed ? 'collapsed' : ''}`}>
                <div className="preview-container" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}>
                    <div
                        className="html-preview-frame"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                </div>
            </div>
        );
    }

    // RENDER: 4. Loading or Empty
    return (
        <div className={`split-view__left ${isLeftPanelCollapsed ? 'collapsed' : ''}`}>
            {isLoading ? (
                <div className="preview-loading">
                    <LoadingSpinner message="Loading document..." />
                </div>
            ) : (
                <div className="empty-preview">
                    <p>Document content unavailable.</p>
                    <p className="text-sm text-gray-400">No layout or fallback content found.</p>
                </div>
            )}
        </div>
    );
};
