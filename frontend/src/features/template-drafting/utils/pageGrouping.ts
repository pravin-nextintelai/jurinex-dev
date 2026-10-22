/**
 * Template Drafting Component - Page Grouping Utility
 * Groups blocks by pageNo for A4 rendering
 */

import type { DraftBlock } from '../types';

export interface PageGroup {
    pageNo: number;
    blocks: DraftBlock[];
}

/**
 * Group draft blocks by their pageNo property
 * Blocks without pageNo are assigned to page 1
 */
export const groupBlocksByPage = (blocks: DraftBlock[]): PageGroup[] => {
    const pageMap = new Map<number, DraftBlock[]>();

    for (const block of blocks) {
        const pageNo = block.content.pageNo ?? 1;

        if (!pageMap.has(pageNo)) {
            pageMap.set(pageNo, []);
        }

        pageMap.get(pageNo)!.push(block);
    }

    // Convert to sorted array
    const pages: PageGroup[] = [];
    const sortedPageNos = Array.from(pageMap.keys()).sort((a, b) => a - b);

    for (const pageNo of sortedPageNos) {
        pages.push({
            pageNo,
            blocks: pageMap.get(pageNo)!
        });
    }

    return pages;
};

/**
 * Get total page count from blocks
 */
export const getPageCount = (blocks: DraftBlock[]): number => {
    if (blocks.length === 0) return 0;

    let maxPage = 1;
    for (const block of blocks) {
        const pageNo = block.content.pageNo ?? 1;
        if (pageNo > maxPage) {
            maxPage = pageNo;
        }
    }

    return maxPage;
};

/**
 * Get blocks for a specific page
 */
export const getBlocksForPage = (blocks: DraftBlock[], pageNo: number): DraftBlock[] => {
    return blocks.filter(block => (block.content.pageNo ?? 1) === pageNo);
};

/**
 * Find block by key across all pages
 */
export const findBlockByKey = (blocks: DraftBlock[], key: string): DraftBlock | undefined => {
    return blocks.find(block => block.key === key);
};
