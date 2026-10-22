/**
 * Template Drafting Component - Evidence Selector
 * Upload and select evidence files for AI context
 */

import React, { useRef } from 'react';
import { EvidenceFileItem } from './EvidenceFileItem';
import { useDraftStore } from '../../store/draftStore';

export const EvidenceSelector: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const evidenceFiles = useDraftStore(state => state.evidenceFiles);
    const selectedEvidenceIds = useDraftStore(state => state.selectedEvidenceIds);
    const isUploadingEvidence = useDraftStore(state => state.isUploadingEvidence);
    const uploadEvidence = useDraftStore(state => state.uploadEvidence);
    const toggleEvidenceSelection = useDraftStore(state => state.toggleEvidenceSelection);

    const handleAddClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await uploadEvidence(file);
            // Reset input so same file can be selected again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="evidence-selector">
            <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.txt"
            />

            <button
                className="evidence-selector__add-btn"
                onClick={handleAddClick}
                disabled={isUploadingEvidence}
            >
                {isUploadingEvidence ? '⏳ Uploading...' : '+ Add Evidence'}
            </button>

            {evidenceFiles.map(evidence => (
                <EvidenceFileItem
                    key={evidence.id}
                    evidence={evidence}
                    isSelected={selectedEvidenceIds.includes(evidence.id)}
                    onToggle={toggleEvidenceSelection}
                />
            ))}
        </div>
    );
};
