/**
 * Template Drafting Component - Type Definitions
 * AI Suggestion interfaces
 */

export type SuggestionStatus = 'pending' | 'inserted' | 'rejected';
export type ResponseSize = 'short' | 'medium' | 'long';

export interface AiUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    modelUsed: string;
    estimatedCostUsd: number;
    estimatedCostInr: number;
}

export interface AiSuggestion {
    id?: string;
    suggestionId: string;
    targetBlock: string;
    content: string;
    status: SuggestionStatus;
    model?: string;
    usage?: AiUsage;
    createdAt: string;
}

export interface AiSuggestRequest {
    targetBlock: string;
    prompt?: string;
    instruction?: string;
    stateAware?: boolean;
    fileIds?: string[];
    responseSize?: ResponseSize;
}

export interface AiSuggestResponse {
    success: boolean;
    suggestion: AiSuggestion;
}

export interface PendingSuggestionsResponse {
    success: boolean;
    count: number;
    suggestions: Array<{
        id: string;
        targetBlock: string;
        content: string;
        status: SuggestionStatus;
        createdAt: string;
    }>;
}

export interface InsertSuggestionResponse {
    success: boolean;
    versionId: string;
    versionNo: number;
    targetBlock: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    suggestion?: AiSuggestion;
}
