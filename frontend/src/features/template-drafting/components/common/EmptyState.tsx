/**
 * Template Drafting Component - Empty State
 */

import React from 'react';

interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    title,
    description,
    icon,
    action
}) => {
    return (
        <div className="empty-state">
            {icon && <div className="empty-state__icon">{icon}</div>}
            <h3 className="empty-state__title">{title}</h3>
            {description && <p className="empty-state__description">{description}</p>}
            {action && <div style={{ marginTop: '16px' }}>{action}</div>}
        </div>
    );
};
