/**
 * Template Drafting Component - Draft Resume Page
 * Lists existing drafts for the user to continue working
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { draftApi } from '../services/draftApi';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { Logger } from '../utils/logger';
import '../styles/index.css';

interface DraftSummary {
    id: string;
    title: string;
    status: string;
    templateName: string;
    templateCategory?: string;
    createdAt: string;
    updatedAt: string;
}

export const DraftResumePage: React.FC = () => {
    const navigate = useNavigate();
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadDrafts();
    }, []);

    const loadDrafts = async () => {
        try {
            setIsLoading(true);
            const response = await draftApi.list();
            // Sort by updated at desc
            const sorted = response.drafts.sort((a: any, b: any) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            setDrafts(sorted);
            Logger.info('DRAFTS_LOADED', { count: sorted.length });
        } catch (err) {
            Logger.error('DRAFTS_LOAD_FAILED', { error: (err as Error).message });
            setError('Failed to load drafts');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResume = (draftId: string) => {
        navigate(`/template-drafting/drafts/${draftId}/edit`);
    };

    const handleDelete = async (e: React.MouseEvent, draftId: string) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this draft?')) {
            try {
                await draftApi.delete(draftId);
                setDrafts(drafts.filter(d => d.id !== draftId));
                Logger.info('DRAFT_DELETED', { draftId });
            } catch (err) {
                Logger.error('DRAFT_DELETE_FAILED', { draftId, error: (err as Error).message });
                alert('Failed to delete draft');
            }
        }
    };

    const handleNewDraft = () => {
        navigate('/template-drafting');
    };

    if (isLoading) {
        return (
            <div className="template-drafting-root" style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <LoadingSpinner message="Loading your drafts..." />
            </div>
        );
    }

    return (
        <ErrorBoundary>
            <div className="template-drafting-root">
                <div className="template-listing">
                    <header className="template-listing__header">
                        <div>
                            <h1 className="template-listing__title">My Drafts</h1>
                            <p className="template-listing__subtitle">Continue working on your saved documents</p>
                        </div>
                        <button
                            className="template-card__select-btn"
                            style={{ padding: '10px 20px' }}
                            onClick={handleNewDraft}
                        >
                            + New Draft
                        </button>
                    </header>

                    {error && (
                        <div className="error-banner">
                            {error} <button onClick={loadDrafts}>Retry</button>
                        </div>
                    )}

                    <div className="draft-list" style={{ maxWidth: '800px', margin: '0 auto' }}>
                        {drafts.length === 0 ? (
                            <div className="empty-state" style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', border: '1px solid #eee' }}>
                                <p style={{ fontSize: '18px', marginBottom: '16px' }}>You don't have any saved drafts.</p>
                                <button className="template-card__select-btn" onClick={handleNewDraft}>
                                    Create New Draft
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {drafts.map(draft => (
                                    <div
                                        key={draft.id}
                                        className="draft-item"
                                        style={{
                                            padding: '20px',
                                            background: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            transition: 'transform 0.2s',
                                        }}
                                        onClick={() => handleResume(draft.id)}
                                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                                        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                                    >
                                        <div>
                                            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>{draft.title || draft.templateName}</h3>
                                            <div style={{ display: 'flex', gap: '12px', color: '#64748b', fontSize: '14px' }}>
                                                <span>Template: {draft.templateName}</span>
                                                <span>•</span>
                                                <span>Status: {draft.status}</span>
                                                <span>•</span>
                                                <span>Last edited: {new Date(draft.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <button
                                                onClick={(e) => handleDelete(e, draft.id)}
                                                style={{
                                                    padding: '8px 12px',
                                                    background: 'transparent',
                                                    border: '1px solid #ef4444',
                                                    color: '#ef4444',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Delete
                                            </button>
                                            <button
                                                className="template-card__select-btn"
                                                style={{ margin: 0 }}
                                            >
                                                Continue
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
};
