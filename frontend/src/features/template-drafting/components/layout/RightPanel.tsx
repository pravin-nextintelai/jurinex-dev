/**
 * Template Drafting Component - Right Panel
 * Contains Form and Chat tabs
 */

import React from 'react';
import { DynamicForm } from '../form/DynamicForm';
import { ChatPanel } from '../chat/ChatPanel';
import { useUiStore } from '../../store/uiStore';

export const RightPanel: React.FC = () => {
    const activeRightPanel = useUiStore(state => state.activeRightPanel);
    const setActiveRightPanel = useUiStore(state => state.setActiveRightPanel);

    return (
        <div className="right-panel">
            <div className="right-panel__tabs">
                <button
                    className={`right-panel__tab ${activeRightPanel === 'form' ? 'right-panel__tab--active' : ''}`}
                    onClick={() => setActiveRightPanel('form')}
                >
                    📝 Form
                </button>
                <button
                    className={`right-panel__tab ${activeRightPanel === 'chat' ? 'right-panel__tab--active' : ''}`}
                    onClick={() => setActiveRightPanel('chat')}
                >
                    ✨ AI Chat
                </button>
            </div>

            <div className="right-panel__content">
                {activeRightPanel === 'form' ? (
                    <DynamicForm />
                ) : (
                    <ChatPanel />
                )}
            </div>
        </div>
    );
};
