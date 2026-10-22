/**
 * Template Drafting Component - Draft Editor Page
 * Main split-view editor for draft editing
 */

import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SplitViewLayout } from '../components/layout';
import { LoadingSpinner, ErrorBoundary } from '../components/common';
import { useDraftStore } from '../store/draftStore';
import { useUiStore } from '../store/uiStore';
import { Logger } from '../utils/logger';

import '../styles/index.css';

export const DraftEditorPage: React.FC = () => {
    const navigate = useNavigate();
    const { draftId } = useParams<{ draftId: string }>();

    const isLoading = useDraftStore(state => state.isLoading);
    const error = useDraftStore(state => state.error);
    const pageCount = useDraftStore(state => state.pageCount);
    const draftStatus = useDraftStore(state => state.draftStatus);
    const loadDraft = useDraftStore(state => state.loadDraft);
    const clearDraft = useDraftStore(state => state.clearDraft);
    const clearError = useDraftStore(state => state.clearError);

    const setTotalPages = useUiStore(state => state.setTotalPages);
    const reset = useUiStore(state => state.reset);

    useEffect(() => {
        if (draftId) {
            loadDraft(draftId);
            Logger.info('DRAFT_EDITOR_PAGE_LOADED', { draftId });
        }

        return () => {
            clearDraft();
            reset();
            Logger.info('DRAFT_EDITOR_PAGE_UNLOADED', { draftId });
        };
    }, [draftId, loadDraft, clearDraft, reset]);

    // Update total pages when pageCount changes
    useEffect(() => {
        setTotalPages(pageCount);
    }, [pageCount, setTotalPages]);

    const handleGoBack = () => {
        navigate('/template-drafting');
    };

    const handleRetry = () => {
        clearError();
        if (draftId) {
            loadDraft(draftId);
        }
    };

    // Check if draft is finalized
    if (draftStatus === 'finalized') {
        return (
            <div className="template-drafting-root" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                padding: '48px'
            }}>
                <h2 style={{ marginBottom: '16px' }}>Draft is Finalized</h2>
                <p style={{ color: 'var(--jx-text-secondary)', marginBottom: '24px' }}>
                    This draft has been finalized and cannot be edited.
                </p>
                <button
                    className="action-toolbar__button action-toolbar__button--primary"
                    onClick={handleGoBack}
                >
                    Back to Templates
                </button>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="template-drafting-root" style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh'
            }}>
                <LoadingSpinner message="Loading draft..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="template-drafting-root" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                padding: '48px'
            }}>
                <div className="error-state" style={{ maxWidth: '400px' }}>
                    <p className="error-state__message">{error.message}</p>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                        <button className="action-toolbar__button" onClick={handleGoBack}>
                            Back
                        </button>
                        {error.recoverable && (
                            <button className="error-state__button" onClick={handleRetry}>
                                Retry
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <ErrorBoundary>
            <div className="template-drafting-root" style={{ height: '100vh' }}>
                <SplitViewLayout />
            </div>
        </ErrorBoundary>
    );
};
