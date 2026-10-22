/**
 * Template Drafting Component - Utilities Barrel Export
 */

export { Logger, trackPerformance } from './logger';
export { debounce, throttle } from './debounce';
export { groupBlocksByPage, getPageCount, getBlocksForPage, findBlockByKey, type PageGroup } from './pageGrouping';
export {
    getBlockElementId,
    getFieldValueId,
    getPageContainerId,
    findBlockElement,
    findFieldValueElement,
    updateBlockValueInDom,
    scrollToBlock
} from './domAnchors';
export {
    validateField,
    validateForm,
    getFieldError,
    type ValidationError,
    type ValidationResult
} from './validation';
