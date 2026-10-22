/**
 * Template Drafting Component - Evidence File Item
 * Displays an evidence file with selection toggle
 */

import React from 'react';
import type { EvidenceFile } from '../../types';

interface EvidenceFileItemProps {
    evidence: EvidenceFile;
    isSelected: boolean;
    onToggle: (id: string) => void;
}

export const EvidenceFileItem: React.FC<EvidenceFileItemProps> = ({
    evidence,
    isSelected,
    onToggle
}) => {
    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const displayName = evidence.originalName || evidence.original_name || evidence.fileName || 'Unknown file';
    const displaySize = formatSize(evidence.fileSize || 0);

    return (
        <button
            className={`evidence-file-item ${isSelected ? 'evidence-file-item--selected' : ''}`}
            onClick={() => onToggle(evidence.id)}
            title={`${displayName} (${displaySize})`}
        >
            📎 {displayName.length > 25
                ? `${displayName.slice(0, 20)}...`
                : displayName}
            {isSelected && ' ✓'}
        </button>
    );
};
