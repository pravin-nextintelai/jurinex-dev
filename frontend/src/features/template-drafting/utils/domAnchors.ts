/**
 * Template Drafting Component - DOM Anchors
 * Stable DOM ID generation for targeted updates
 */

/**
 * Generate stable DOM ID for a draft block
 */
export const getBlockElementId = (blockKey: string, pageNo: number): string => {
    return `draft-block-${pageNo}-${blockKey}`;
};

/**
 * Generate stable DOM ID for a field value within a block
 */
export const getFieldValueId = (blockKey: string, pageNo: number): string => {
    return `draft-field-${pageNo}-${blockKey}-value`;
};

/**
 * Generate stable DOM ID for a page container
 */
export const getPageContainerId = (pageNo: number): string => {
    return `draft-page-${pageNo}`;
};

/**
 * Find block element in DOM
 */
export const findBlockElement = (blockKey: string, pageNo: number): HTMLElement | null => {
    return document.getElementById(getBlockElementId(blockKey, pageNo));
};

/**
 * Find field value element in DOM
 */
export const findFieldValueElement = (blockKey: string, pageNo: number): HTMLElement | null => {
    return document.getElementById(getFieldValueId(blockKey, pageNo));
};

/**
 * Update block content directly in DOM (no React rerender)
 * Used for fast form -> preview sync
 */
export const updateBlockValueInDom = (
    blockKey: string,
    pageNo: number,
    newValue: string | number | null
): boolean => {
    const valueElement = findFieldValueElement(blockKey, pageNo);

    if (valueElement) {
        valueElement.textContent = newValue?.toString() ?? '';
        return true;
    }

    // Fallback: try finding by data attribute
    const blockElement = findBlockElement(blockKey, pageNo);
    if (blockElement) {
        const valueSpan = blockElement.querySelector('[data-field-value]');
        if (valueSpan) {
            valueSpan.textContent = newValue?.toString() ?? '';
            return true;
        }
    }

    return false;
};

/**
 * Scroll to specific block
 */
export const scrollToBlock = (blockKey: string, pageNo: number): void => {
    const element = findBlockElement(blockKey, pageNo);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Add highlight effect
        element.classList.add('draft-block--highlight');
        setTimeout(() => {
            element.classList.remove('draft-block--highlight');
        }, 2000);
    }
};
