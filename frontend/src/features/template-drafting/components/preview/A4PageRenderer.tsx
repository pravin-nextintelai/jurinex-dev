/**
 * Template Drafting Component - A4 Page Renderer
 * Renders a single A4 page with blocks
 */

import React from 'react';
import { BlockRenderer } from './BlockRenderer';
import { getPageContainerId } from '../../utils/domAnchors';
import type { LayoutPage } from '../../types';

interface A4PageRendererProps {
    pageNo: number;
    layoutPage: LayoutPage;
    // html?: string; // Removed, handled in LeftPanel
}

export const A4PageRenderer: React.FC<A4PageRendererProps> = React.memo(({
    pageNo,
    layoutPage
}) => {
    const pageId = getPageContainerId(pageNo);
    const blocks = layoutPage?.blocks || [];

    // Render blocks dynamically
    return (
        <div
            id={pageId}
            className="a4-page"
            data-page-number={`Page ${pageNo}`}
        >
            {blocks.map((block) => (
                <BlockRenderer
                    key={block.key} // Stable key
                    block={block}
                    pageNo={pageNo}
                />
            ))}
        </div>
    );
});

A4PageRenderer.displayName = 'A4PageRenderer';
