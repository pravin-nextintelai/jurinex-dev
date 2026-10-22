/**
 * Template Drafting Component - Chat Panel
 * Main chat container with messages and input
 */

import React from 'react';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { EvidenceSelector } from './EvidenceSelector';

export const ChatPanel: React.FC = () => {
    return (
        <div className="chat-panel">
            <div className="chat-panel__header">
                <h3 className="chat-panel__title">
                    <span className="chat-panel__title-icon">✨</span>
                    AI Assistant
                </h3>
            </div>

            <ChatMessages />

            <EvidenceSelector />

            <ChatInput />
        </div>
    );
};
