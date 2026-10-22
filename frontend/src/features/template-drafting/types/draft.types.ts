/**
 * Template Drafting Component - Type Definitions
 * Draft-related interfaces
 */

import type { TemplateSchema } from './template.types';

export type DraftStatus = 'draft' | 'exported' | 'finalized' | 'deleted';

export interface DraftBlock {
    id: string;
    key: string;
    content: {
        value: string | number | null;
        label: string;
        type?: string;
        pageNo?: number;
        aiGenerated?: boolean;
        aiInsertedAt?: string;
        [key: string]: any;
    };
}

export interface DraftListItem {
    id: string;
    title: string;
    status: DraftStatus;
    templateName: string;
    templateCategory?: string;
    createdAt: string;
    updatedAt: string;
}

export interface LayoutBlock {
    id: string; // The block_id from backend
    key: string; // The stable key (used for mapping fields)
    text?: string; // Top-level text content (CRITICAL)
    content: {
        type: string;
        label: string;
        value?: string; // Placeholder or default text
        [key: string]: any;
    };
    meta?: {
        isAllCap?: boolean;
        isBold?: boolean;
        [key: string]: any;
    };
}

export interface LayoutPage {
    pageNo: number;
    blocks: LayoutBlock[];
}

export interface DraftLayout {
    pages: LayoutPage[];
}

export interface Draft {
    id: string;
    title: string;
    status: DraftStatus;
    templateName: string;
    templateVersionId: string;
    currentVersionId: string;
    schema: TemplateSchema | null;

    // New Structure
    layout?: DraftLayout; // Immutable layout structure
    fields?: Record<string, string | number | null>; // Mutable field values mapped by block key

    // Legacy / Fallback
    blocks?: DraftBlock[]; // Deprecated, but keeping for type safety during migration if needed
    fallback_html?: {
        pages: Array<{ pageNo: number; html: string }>;
        styles?: string;
    };

    createdAt: string;
    updatedAt: string;
    lastSavedAt?: string; // For resume logic
}

export interface DraftsResponse {
    success: boolean;
    count: number;
    drafts: DraftListItem[];
}

export interface DraftResponse {
    success: boolean;
    draft: Draft;
}

export interface CreateDraftRequest {
    templateId: string;
    title?: string;
}

export interface CreateDraftResponse {
    success: boolean;
    draft: {
        id: string;
        title: string;
        status: DraftStatus;
        templateVersionId: string;
        currentVersionId: string;
        createdAt: string;
    };
}

export interface UpdateFieldsRequest {
    fields: Record<string, string | number | null>;
}

export interface UpdateFieldsResponse {
    success: boolean;
    versionId: string;
    versionNo: number;
}

export interface DraftVersion {
    id: string;
    versionNo: number;
    actionType: 'initial' | 'form_update' | 'ai_insert' | 'undo' | 'redo' | 'restore';
    parentVersionId: string | null;
    blockCount: number;
    createdAt: string;
}

export interface VersionHistoryResponse {
    success: boolean;
    draftId: string;
    currentVersionId: string;
    versions: DraftVersion[];
}

export interface UndoRedoResponse {
    success: boolean;
    previousVersionId: string;
    currentVersionId: string;
    versionNo: number;
}
