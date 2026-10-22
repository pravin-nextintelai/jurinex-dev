/**
 * Template Drafting Component - Export API Service
 */

import { api } from './api';
import type { ExportResponse, FinalizeResponse } from '../types';

export const exportApi = {
    /**
     * Get HTML preview of draft
     * Returns raw HTML string
     */
    preview: async (draftId: string): Promise<string> => {
        const response = await api.get(`/drafts/${draftId}/preview`, {
            responseType: 'text'
        });
        return response.data;
    },

    /**
     * Get preview metadata (without HTML content)
     */
    previewMeta: async (draftId: string): Promise<{
        success: boolean;
        cached: boolean;
        versionId: string;
        renderId: string;
        htmlLength: number;
    }> => {
        const response = await api.get(`/drafts/${draftId}/preview`, {
            params: { format: 'json' }
        });
        return response.data;
    },

    /**
     * Export draft to DOCX
     * Returns signed download URL
     */
    exportDocx: async (draftId: string): Promise<ExportResponse> => {
        const response = await api.post<ExportResponse>(`/drafts/${draftId}/export`);
        return response.data;
    },

    /**
     * Finalize draft (lock from further edits)
     */
    finalize: async (draftId: string): Promise<FinalizeResponse> => {
        const response = await api.post<FinalizeResponse>(`/drafts/${draftId}/finalize`);
        return response.data;
    }
};
