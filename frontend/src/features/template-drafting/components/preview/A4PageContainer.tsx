/**
 * Template Drafting Component - A4 Page Container
 * Virtualized container for rendering multiple A4 pages
 */

import React, { useCallback, useRef } from 'react';
import { A4PageRenderer } from './A4PageRenderer';
import { useUiStore } from '../../store/uiStore';
import { Logger } from '../../utils/logger';
import type { PageGroup } from '../../utils/pageGrouping';

interface A4PageContainerProps {
    pages: PageGroup[];
    fallbackHtmlPages?: Array<{ pageNo: number; html: string }>;
}

export const A4PageContainer: React.FC<A4PageContainerProps> = ({
    pages,
    fallbackHtmlPages
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const setCurrentPage = useUiStore((state) => state.setCurrentPage);

    // Create a map for quick fallback HTML lookup
    const htmlPageMap = React.useMemo(() => {
        const map = new Map<number, string>();
        if (fallbackHtmlPages) {
            fallbackHtmlPages.forEach(p => map.set(p.pageNo, p.html));
        }
        return map;
    }, [fallbackHtmlPages]);

    // Handle scroll to update current page indicator
    const handleScroll = useCallback(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const scrollTop = container.scrollTop;
        const pageHeight = 297 * 3.78 + 24; // A4 height in px + gap (approx)

        const currentPage = Math.floor(scrollTop / pageHeight) + 1;
        setCurrentPage(Math.min(currentPage, pages.length));
    }, [pages.length, setCurrentPage]);

    // Log performance for large page counts
    React.useEffect(() => {
        if (pages.length > 50) {
            Logger.info('LARGE_DOCUMENT_LOADED', { pageCount: pages.length });
        }
    }, [pages.length]);

    if (pages.length === 0) {
        return (
            <div className="a4-page-container">
                <div className="empty-state">
                    <p>No pages to display</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="a4-page-container"
            onScroll={handleScroll}
        >
            {pages.map((page) => {
                const pageHtml = htmlPageMap.get(page.pageNo);
                // If we have HTML, ignore blocks to prevent double rendering logic
                const blocksToRender = pageHtml ? [] : page.blocks;

                return (
                    <A4PageRenderer
                        key={page.pageNo}
                        pageNo={page.pageNo}
                        blocks={blocksToRender}
                        html={pageHtml}
                    />
                );
            })}
        </div>
    );
};
