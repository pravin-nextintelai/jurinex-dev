/**
 * Template Drafting Component - Template Card
 */

import React from 'react';
import { StatusBadge } from '../common/StatusBadge';
import type { TemplateListItem } from '../../types';

interface TemplateCardProps {
    template: TemplateListItem;
    onClick: (template: TemplateListItem) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({ template, onClick }) => {
    const handleClick = () => {
        onClick(template);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(template);
        }
    };

    return (
        <div
            className="template-card"
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
            aria-label={`Select ${template.name} template`}
        >
            <div className="template-card__header">
                <h3 className="template-card__name">{template.name}</h3>
                <StatusBadge status={template.isActive ? 'active' : 'inactive'} />
            </div>

            <p className="template-card__description">
                {template.description || 'No description available'}
            </p>

            <div className="template-card__meta">
                <span className="template-card__category">
                    📁 {template.category}
                </span>
                <span>
                    📅 {new Date(template.createdAt).toLocaleDateString()}
                </span>
            </div>
        </div>
    );
};
