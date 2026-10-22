/**
 * Template Drafting Component - AI Suggestion Card
 * Displays AI suggestion with insert/reject actions
 */

import React from 'react';
import { useDraftStore } from '../../store/draftStore';
import type { AiSuggestion } from '../../types';

interface AiSuggestionCardProps {
    suggestion: AiSuggestion;
}

export const AiSuggestionCard: React.FC<AiSuggestionCardProps> = ({ suggestion }) => {
    const insertAiSuggestion = useDraftStore(state => state.insertAiSuggestion);
    const rejectAiSuggestion = useDraftStore(state => state.rejectAiSuggestion);

    const handleInsert = () => {
        insertAiSuggestion(suggestion.suggestionId);
    };

    const handleReject = () => {
        rejectAiSuggestion(suggestion.suggestionId);
    };

    return (
        <div className="ai-suggestion-card">
            <div className="ai-suggestion-card__header">
                <span className="ai-suggestion-card__icon">✨</span>
                <span className="ai-suggestion-card__label">AI Suggestion</span>
                <span className="ai-suggestion-card__target">
                    for: {suggestion.targetBlock}
                </span>
            </div>

            <div className="ai-suggestion-card__content">
                {suggestion.content}
            </div>

            <div className="ai-suggestion-card__actions">
                <button
                    className="ai-suggestion-card__button ai-suggestion-card__button--insert"
                    onClick={handleInsert}
                >
                    ✓ Insert
                </button>
                <button
                    className="ai-suggestion-card__button ai-suggestion-card__button--reject"
                    onClick={handleReject}
                >
                    ✕ Discard
                </button>
            </div>
        </div>
    );
};
