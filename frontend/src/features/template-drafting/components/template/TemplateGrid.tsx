/**
 * Template Drafting Component - Template Grid
 */

import React from 'react';
import { TemplateCard } from './TemplateCard';
import { LoadingSpinner, EmptyState } from '../common';
import type { TemplateListItem } from '../../types';

interface TemplateGridProps {
    templates: TemplateListItem[];
    isLoading: boolean;
    onTemplateClick: (template: TemplateListItem) => void;
}

export const TemplateGrid: React.FC<TemplateGridProps> = ({
    templates,
    isLoading,
    onTemplateClick
}) => {
    if (isLoading) {
        return <LoadingSpinner message="Loading templates..." />;
    }

    if (templates.length === 0) {
        return (
            <EmptyState
                title="No Templates Found"
                description="There are no templates available at the moment. Please check back later."
                icon={
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                }
            />
        );
    }

    return (
        <div className="template-grid">
            {templates.map((template) => (
                <TemplateCard
                    key={template.id}
                    template={template}
                    onClick={onTemplateClick}
                />
            ))}
        </div>
    );
};
