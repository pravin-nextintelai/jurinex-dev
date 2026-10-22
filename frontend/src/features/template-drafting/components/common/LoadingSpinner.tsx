/**
 * Template Drafting Component - Loading Spinner
 */

import React from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
    size = 'md',
    message
}) => {
    const sizeMap = {
        sm: '24px',
        md: '40px',
        lg: '56px'
    };

    return (
        <div className="loading-state">
            <div
                className="loading-spinner"
                style={{ width: sizeMap[size], height: sizeMap[size] }}
            />
            {message && <p style={{ marginTop: '16px' }}>{message}</p>}
        </div>
    );
};
