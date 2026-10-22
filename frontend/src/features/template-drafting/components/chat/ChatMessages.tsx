/**
 * Template Drafting Component - Chat Messages
 * Displays chat history with AI suggestions
 */

import React, { useEffect, useRef } from 'react';
import { AiSuggestionCard } from './AiSuggestionCard';
import { useDraftStore } from '../../store/draftStore';

export const ChatMessages: React.FC = () => {
    const chatHistory = useDraftStore(state => state.chatHistory);
    const isAiLoading = useDraftStore(state => state.isAiLoading);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory, isAiLoading]);

    const formatTime = (date: Date): string => {
        return new Date(date).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="chat-panel__messages">
            {chatHistory.length === 0 && !isAiLoading && (
                <div style={{
                    textAlign: 'center',
                    padding: '32px',
                    color: 'var(--jx-text-muted)'
                }}>
                    <p>💬 Start a conversation</p>
                    <p style={{ fontSize: '12px', marginTop: '8px' }}>
                        Ask AI for suggestions to fill in your document
                    </p>
                </div>
            )}

            {chatHistory.map((message) => (
                <div key={message.id}>
                    <div className={`chat-message chat-message--${message.role}`}>
                        {message.content}
                        <div className="chat-message__time">
                            {formatTime(message.timestamp)}
                        </div>
                    </div>

                    {/* Show suggestion card if message has pending suggestion */}
                    {message.suggestion && message.suggestion.status === 'pending' && (
                        <AiSuggestionCard suggestion={message.suggestion} />
                    )}
                </div>
            ))}

            {isAiLoading && (
                <div className="chat-loading">
                    <div className="chat-loading__dots">
                        <span className="chat-loading__dot" />
                        <span className="chat-loading__dot" />
                        <span className="chat-loading__dot" />
                    </div>
                    AI is thinking...
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
};
