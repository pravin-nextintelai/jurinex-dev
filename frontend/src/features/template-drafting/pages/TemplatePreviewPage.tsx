/**
 * Template Drafting Component - Template Preview Page
 * Full preview of selected template before creating draft
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LoadingSpinner, ErrorBoundary } from '../components/common';
import { A4PageRenderer } from '../components/preview';
import { useTemplateStore } from '../store/templateStore';
import { draftApi } from '../services';
import { getUniversalSections } from '../services/universalSectionsApi';
import type { UniversalSection } from '../components/constants';
import { Logger } from '../utils/logger';

export const TemplatePreviewPage: React.FC = () => {
    const navigate = useNavigate();
    const { templateId } = useParams<{ templateId: string }>();

    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [sections, setSections] = useState<UniversalSection[]>([]);

    useEffect(() => {
        getUniversalSections().then(setSections);
    }, []);

    const selectedTemplate = useTemplateStore(state => state.selectedTemplate);
    const isLoadingDetails = useTemplateStore(state => state.isLoadingDetails);
    const error = useTemplateStore(state => state.error);
    const loadTemplateById = useTemplateStore(state => state.loadTemplateById);

    useEffect(() => {
        if (templateId) {
            loadTemplateById(templateId);
            Logger.info('TEMPLATE_PREVIEW_PAGE_LOADED', { templateId });
        }
    }, [templateId, loadTemplateById]);

    const handleStartDraft = async () => {
        if (!templateId || isCreatingDraft) return;
        setIsCreatingDraft(true);
        try {
            Logger.info('CREATE_DRAFT_START', { templateId });
            const response = await draftApi.create({
                templateId,
                title: `Draft - ${selectedTemplate?.name || 'New Document'}`
            });
            Logger.info('CREATE_DRAFT_SUCCESS', { templateId, draftId: response.draft.id });
            navigate(`/template-drafting/edit/${response.draft.id}`);
        } catch (error) {
            Logger.error('CREATE_DRAFT_FAILED', { templateId, error: (error as Error).message });
            alert('Failed to create draft. Please try again.');
            setIsCreatingDraft(false);
        }
    };

    const handleGoBack = () => {
        navigate('/template-drafting');
    };

    // Get pages from template content
    const getPreviewPages = () => {
        if (!selectedTemplate?.content) return [];

        const content = selectedTemplate.content;

        // Use fallback_html if available
        if (content.fallback_html?.pages) {
            return content.fallback_html.pages.map(p => ({
                pageNo: p.pageNo,
                html: p.html,
                blocks: []
            }));
        }

        // Use structured pages
        if (content.structured?.pages) {
            return content.structured.pages.map(p => ({
                pageNo: p.pageNo,
                blocks: p.blocks,
                html: undefined
            }));
        }

        // Legacy format - single page
        if (content.blocks) {
            return [{
                pageNo: 1,
                blocks: content.blocks,
                html: undefined
            }];
        }

        return [];
    };

    if (isLoadingDetails) {
        return (
            <div className="template-drafting-root" style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '400px'
            }}>
                <LoadingSpinner message="Loading template..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="template-drafting-root" style={{ padding: '48px' }}>
                <div className="error-state">
                    <p className="error-state__message">{error.message}</p>
                    <button className="error-state__button" onClick={handleGoBack}>
                        Back to Templates
                    </button>
                </div>
            </div>
        );
    }

    if (!selectedTemplate) {
        return (
            <div className="template-drafting-root" style={{ padding: '48px' }}>
                <p>Template not found.</p>
                <button
                    className="action-toolbar__button"
                    onClick={handleGoBack}
                    style={{ marginTop: '16px' }}
                >
                    Back to Templates
                </button>
            </div>
        );
    }

    const previewPages = getPreviewPages();

    return (
        <ErrorBoundary>
            <div className="template-drafting-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--jx-border)',
                    background: 'var(--jx-bg-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <button
                            className="action-toolbar__button"
                            onClick={handleGoBack}
                        >
                            ← Back
                        </button>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                                {selectedTemplate.name}
                            </h1>
                            <p style={{ margin: '4px 0 0', color: 'var(--jx-text-secondary)', fontSize: '14px' }}>
                                {selectedTemplate.category} • {previewPages.length} pages
                            </p>
                        </div>
                    </div>

                    <button
                        className="action-toolbar__button action-toolbar__button--primary"
                        onClick={handleStartDraft}
                        disabled={isCreatingDraft}
                        style={{ padding: '12px 24px', fontSize: '16px' }}
                    >
                        {isCreatingDraft ? '⏳ Creating...' : '✨ Start Draft'}
                    </button>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

                    {/* Left Sidebar: Universal Structure */}
                    <div style={{
                        width: '300px',
                        borderRight: '1px solid var(--jx-border)',
                        background: '#fff',
                        overflowY: 'auto',
                        padding: '16px'
                    }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Document Structure</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {sections.map((section) => (
                                <div key={section.id} style={{
                                    padding: '8px 12px',
                                    border: '1px solid var(--jx-border)',
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    background: 'var(--jx-bg-secondary)'
                                }}>
                                    <div style={{ fontWeight: 500, color: 'var(--jx-text-primary)' }}>{section.title}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--jx-text-secondary)', marginTop: '2px' }}>
                                        {section.description}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: Document Preview */}
                    <div style={{ flex: 1, background: '#f5f5f5', overflow: 'hidden' }}>
                        <div className="a4-page-container" style={{ height: '100%', overflowY: 'auto', padding: '32px' }}>
                            {previewPages.length === 0 ? (
                                <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
                                    <p>No preview content available.</p>
                                    <p style={{ fontSize: '13px', marginTop: '8px' }}>
                                        This document will be generated following the standard structure.
                                    </p>
                                </div>
                            ) : (
                                previewPages.map((page) => {
                                    // 1. Render HTML Fallback
                                    if (page.html) {
                                        return (
                                            <div
                                                key={page.pageNo}
                                                className="a4-page-wrapper"
                                                style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}
                                                dangerouslySetInnerHTML={{ __html: page.html }}
                                                data-page-number={`Page ${page.pageNo}`}
                                            />
                                        );
                                    }

                                    // 2. Render Virtual Layout
                                    const layoutPage = {
                                        pageNo: page.pageNo,
                                        blocks: (page.blocks || []).map(b => ({
                                            ...b,
                                            id: b.key,
                                            content: {
                                                ...b.content,
                                                label: b.content.label || '',
                                                type: b.content.type || 'paragraph'
                                            }
                                        }))
                                    };

                                    return (
                                        <div key={page.pageNo} style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
                                            <A4PageRenderer
                                                pageNo={page.pageNo}
                                                layoutPage={layoutPage}
                                            />
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
};
