/**
 * Template Drafting Component - AI API Service
 */

import { api } from './api';
import type {
    AiSuggestRequest,
    AiSuggestResponse,
    PendingSuggestionsResponse,
    InsertSuggestionResponse
} from '../types';

export const aiApi = {
    /**
     * Request AI suggestion for a block
     */
    suggest: async (
        draftId: string,
        params: AiSuggestRequest
    ): Promise<AiSuggestResponse> => {
        const response = await api.post<AiSuggestResponse>(
            `/drafts/${draftId}/ai/suggest`,
            params
        );
        return response.data;
    },

    /**
     * Get all pending suggestions for a draft
     */
    getPending: async (draftId: string): Promise<PendingSuggestionsResponse> => {
        const response = await api.get<PendingSuggestionsResponse>(
            `/drafts/${draftId}/ai/suggestions`
        );
        return response.data;
    },

    /**
     * Insert AI suggestion into draft (creates new version)
     */
    insert: async (
        draftId: string,
        suggestionId: string
    ): Promise<InsertSuggestionResponse> => {
        const response = await api.post<InsertSuggestionResponse>(
            `/drafts/${draftId}/ai/${suggestionId}/insert`
        );
        return response.data;
    },

    /**
     * Reject/discard AI suggestion
     */
    reject: async (
        draftId: string,
        suggestionId: string
    ): Promise<{ success: boolean; message: string }> => {
        const response = await api.delete(`/drafts/${draftId}/ai/${suggestionId}`);
        return response.data;
    }
};
