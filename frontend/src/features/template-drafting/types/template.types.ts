/**
 * Template Drafting Component - Type Definitions
 * Template-related interfaces
 */

export interface TemplateField {
    key: string;
    label: string;
    type: 'string' | 'number' | 'integer' | 'textarea' | 'date';
    required?: boolean;
    maxLength?: number;
    min?: number;
    max?: number;
    defaultValue?: string | number;
}

export interface TemplateSchema {
    fields: TemplateField[];
}

export interface TemplateListItem {
    id: string;
    name: string;
    description: string;
    category: string;
    isActive: boolean;
    createdAt: string;
    /** Optional cover image URL (used by user custom templates) */
    imageUrl?: string;
}

export interface TemplatePage {
    pageNo: number;
    blocks: TemplateBlock[];
    html?: string; // For fallback_html rendering
}

export interface TemplateBlock {
    key: string;
    content: {
        type?: string;
        text?: string;
        style?: Record<string, any>;
        [key: string]: any;
    };
}

export interface TemplateContent {
    format?: 'dual-document-v1' | 'legacy';
    structured?: {
        pages: TemplatePage[];
        pageCount: number;
    };
    fallback_html?: {
        pages: Array<{ pageNo: number; html: string }>;
    };
    blocks?: TemplateBlock[]; // Legacy format
}

export interface Template extends TemplateListItem {
    schema: TemplateSchema;
    content: TemplateContent;
    latestVersionId: string;
    versionNo: number;
    updatedAt: string;
}

export interface TemplatesResponse {
    success: boolean;
    count: number;
    templates: TemplateListItem[];
}

export interface TemplateResponse {
    success: boolean;
    template: Template;
}
