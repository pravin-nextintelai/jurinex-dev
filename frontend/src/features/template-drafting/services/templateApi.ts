/**
 * Template Drafting Component - Template API Service
 */

import { api } from './api';
import type { TemplatesResponse, TemplateResponse } from '../types';

export const templateApi = {
    /**
     * List all active templates
     */
    list: async (): Promise<TemplatesResponse> => {
        const response = await api.get<TemplatesResponse>('/templates');
        return response.data;
    },

    /**
     * List templates by category
     */
    listByCategory: async (category: string): Promise<TemplatesResponse> => {
        const response = await api.get<TemplatesResponse>('/templates', {
            params: { category }
        });
        return response.data;
    },

    /**
     * Get template by ID with full content and schema.
     * Uses unified agent-draft-service endpoint (system + custom templates).
     * include_sections and include_preview_url ensure sections and preview are returned when available.
     */
    getById: async (templateId: string): Promise<TemplateResponse> => {
        const response = await api.get<TemplateResponse>(`/templates/${templateId}`, {
            params: { include_sections: true, include_preview_url: true }
        });
        return response.data;
    },

    /**
     * Get only the template schema (efficient for form generation)
     */
    getSchema: async (templateId: string): Promise<{
        success: boolean;
        templateId: string;
        templateName: string;
        schema: { fields: any[] };
    }> => {
        const response = await api.get(`/templates/${templateId}/schema`);
        return response.data;
    }
};
