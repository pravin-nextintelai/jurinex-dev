/**
 * Template Drafting Component - Chat Input
 * Text input with send button for AI requests
 */

import React, { useState, useRef, useEffect } from 'react';
import { useDraftStore } from '../../store/draftStore';

interface ChatInputProps {
    targetBlock?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({ targetBlock }) => {
    const [message, setMessage] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const isAiLoading = useDraftStore(state => state.isAiLoading);
    const schema = useDraftStore(state => state.schema);
    const requestAiSuggestion = useDraftStore(state => state.requestAiSuggestion);

    // Get first field key as default target if not provided
    const defaultTarget = schema?.fields?.[0]?.key || 'content';
    const activeTarget = targetBlock || defaultTarget;

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [message]);

    const handleSubmit = async () => {
        if (!message.trim() || isAiLoading) return;

        const instruction = message.trim();
        setMessage('');

        await requestAiSuggestion(activeTarget, instruction);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="chat-panel__input-area">
            <div className="chat-input">
                <div className="chat-input__field">
                    <textarea
                        ref={textareaRef}
                        className="chat-input__textarea"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`Ask AI to help with ${activeTarget}...`}
                        disabled={isAiLoading}
                        rows={1}
                    />
                    <button
                        className="chat-input__send-btn"
                        onClick={handleSubmit}
                        disabled={!message.trim() || isAiLoading}
                        title="Send (Enter)"
                    >
                        <svg
                            className="chat-input__send-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M22 2L11 13" />
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
