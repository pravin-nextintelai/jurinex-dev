/**
 * Template Drafting Component - Template Listing Page
 * Page for selecting templates
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TemplateGrid, TemplateCategoryFilter } from '../components/template';
import { ErrorBoundary } from '../components/common';
import { useTemplateStore, useFilteredTemplates, useTemplateCategories } from '../store/templateStore';
import { Logger } from '../utils/logger';
import type { TemplateListItem } from '../types';

// Inline styles for the page (CSS file import removed for reliability)
const styles = {
    root: {
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: '#f8f9fa'
    },
    container: {
        padding: '48px',
        maxWidth: '1400px',
        margin: '0 auto'
    },
    header: {
        marginBottom: '32px'
    },
    title: {
        fontSize: '32px',
        fontWeight: 'bold' as const,
        color: '#1A365D',
        marginBottom: '8px'
    },
    subtitle: {
        fontSize: '16px',
        color: '#666'
    },
    errorBox: {
        backgroundColor: '#FFF3F3',
        border: '1px solid #FF6B6B',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '24px',
        color: '#C62828'
    },
    retryButton: {
        marginTop: '12px',
        padding: '8px 16px',
        backgroundColor: '#1A365D',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '14px'
    }
};

export const TemplateListingPage: React.FC = () => {
    const navigate = useNavigate();

    const isLoading = useTemplateStore((state) => state.isLoading);
    const error = useTemplateStore((state) => state.error);
    const categoryFilter = useTemplateStore((state) => state.categoryFilter);
    const loadTemplates = useTemplateStore((state) => state.loadTemplates);
    const setCategoryFilter = useTemplateStore((state) => state.setCategoryFilter);
    const clearError = useTemplateStore((state) => state.clearError);

    const filteredTemplates = useFilteredTemplates();
    const categories = useTemplateCategories();

    useEffect(() => {
        loadTemplates();
        Logger.info('TEMPLATE_LISTING_PAGE_LOADED');
    }, [loadTemplates]);

    const handleTemplateClick = (template: TemplateListItem) => {
        Logger.audit('TEMPLATE_SELECTED', {
            templateId: template.id,
            templateName: template.name
        });
        navigate(`/template-drafting/preview/${template.id}`);
    };

    const handleRetry = () => {
        clearError();
        loadTemplates();
    };

    return (
        <ErrorBoundary>
            <div style={styles.root}>
                <div style={styles.container}>
                    <div style={styles.header}>
                        <h1 style={styles.title}>Template Drafting</h1>
                        <p style={styles.subtitle}>
                            Select a template to start drafting your legal document
                        </p>
                    </div>

                    {error && (
                        <div style={styles.errorBox}>
                            <p>{error.message}</p>
                            <button style={styles.retryButton} onClick={handleRetry}>
                                Retry
                            </button>
                        </div>
                    )}

                    {!error && (
                        <>
                            <TemplateCategoryFilter
                                categories={categories}
                                selectedCategory={categoryFilter}
                                onCategoryChange={setCategoryFilter}
                            />

                            <TemplateGrid
                                templates={filteredTemplates}
                                isLoading={isLoading}
                                onTemplateClick={handleTemplateClick}
                            />
                        </>
                    )}
                </div>
            </div>
        </ErrorBoundary>
    );
};
