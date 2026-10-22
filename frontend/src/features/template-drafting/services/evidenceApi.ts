/**
 * Template Drafting Component - Evidence API Service
 */

import { api } from './api';
import type { EvidenceUploadResponse, EvidenceListResponse } from '../types';

export const evidenceApi = {
    /**
     * Upload evidence file for AI context
     */
    upload: async (draftId: string, file: File): Promise<EvidenceUploadResponse> => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await api.post<EvidenceUploadResponse>(
            `/drafts/${draftId}/evidence/upload`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                timeout: 60000 // 60 seconds for file uploads
            }
        );
        return response.data;
    },

    /**
     * List all evidence for a draft
     */
    list: async (draftId: string): Promise<EvidenceListResponse> => {
        const response = await api.get<EvidenceListResponse>(`/drafts/${draftId}/evidence`);
        return response.data;
    },

    /**
     * Delete evidence file
     */
    delete: async (
        draftId: string,
        evidenceId: string
    ): Promise<{ success: boolean; message: string }> => {
        const response = await api.delete(`/drafts/${draftId}/evidence/${evidenceId}`);
        return response.data;
    },

    /**
     * Force text extraction (re-OCR)
     */
    extract: async (
        draftId: string,
        evidenceId: string
    ): Promise<{
        success: boolean;
        extractedCharacters: number;
        method: string;
        pageCount?: number;
    }> => {
        const response = await api.post(
            `/drafts/${draftId}/evidence/${evidenceId}/extract`
        );
        return response.data;
    }
};
