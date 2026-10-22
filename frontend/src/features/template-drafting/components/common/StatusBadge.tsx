/**
 * Template Drafting Component - Status Badge
 */

import React from 'react';

interface StatusBadgeProps {
    status: 'active' | 'inactive' | 'draft' | 'exported' | 'finalized';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
    const getClassName = () => {
        switch (status) {
            case 'active':
                return 'template-card__badge--active';
            case 'inactive':
                return 'template-card__badge--inactive';
            case 'draft':
                return 'template-card__badge--active';
            case 'exported':
                return 'template-card__badge--active';
            case 'finalized':
                return 'template-card__badge--inactive';
            default:
                return '';
        }
    };

    const getLabel = () => {
        switch (status) {
            case 'active':
                return 'Active';
            case 'inactive':
                return 'Inactive';
            case 'draft':
                return 'Draft';
            case 'exported':
                return 'Exported';
            case 'finalized':
                return 'Finalized';
            default:
                return status;
        }
    };

    return (
        <span className={`template-card__badge ${getClassName()}`}>
            {getLabel()}
        </span>
    );
};
