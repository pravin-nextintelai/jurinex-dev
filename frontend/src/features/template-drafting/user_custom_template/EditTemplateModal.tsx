import React, { useState } from 'react';
import { Logger } from '../utils/logger';
import type { TemplateListItem } from '../types';
import { customTemplateApi } from './api';

interface EditTemplateModalProps {
    template: TemplateListItem;
    onClose: () => void;
    onSuccess: () => void;
}

const styles = {
    overlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    modal: {
        backgroundColor: 'var(--jx-bg-primary, #FFFFFF)',
        borderRadius: 'var(--jx-radius-lg, 0.75rem)',
        padding: '2rem',
        maxWidth: '500px',
        width: '90%',
        boxShadow: 'var(--jx-shadow-xl)',
        position: 'relative' as const,
    },
    header: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        marginBottom: '1.5rem',
        color: 'var(--jx-text-primary, #2D3748)',
    },
    formGroup: {
        marginBottom: '1rem',
    },
    label: {
        display: 'block',
        marginBottom: '0.5rem',
        fontWeight: 600,
        color: 'var(--jx-text-secondary, #4A5568)',
    },
    input: {
        width: '100%',
        padding: '0.75rem',
        borderRadius: 'var(--jx-radius-md, 0.5rem)',
        border: '1px solid var(--jx-border, #CBD5E0)',
        fontSize: '1rem',
    },
    textarea: {
        width: '100%',
        padding: '0.75rem',
        borderRadius: 'var(--jx-radius-md, 0.5rem)',
        border: '1px solid var(--jx-border, #CBD5E0)',
        fontSize: '1rem',
        minHeight: '100px',
        resize: 'vertical' as const,
    },
    actions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '1rem',
        marginTop: '2rem',
    },
    button: {
        padding: '0.75rem 1.5rem',
        borderRadius: 'var(--jx-radius-md, 0.5rem)',
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        fontSize: '1rem',
    },
    cancelButton: {
        backgroundColor: 'var(--jx-bg-secondary, #E2E8F0)',
        color: 'var(--jx-text-secondary, #4A5568)',
    },
    saveButton: {
        backgroundColor: 'var(--jx-primary, #3182CE)',
        color: '#FFFFFF',
    },
    error: {
        color: 'var(--jx-error, #E53E3E)',
        marginBottom: '1rem',
        fontSize: '0.875rem',
    },
};

export const EditTemplateModal: React.FC<EditTemplateModalProps> = ({
    template,
    onClose,
    onSuccess,
}) => {
    const [name, setName] = useState(template.name);
    const [description, setDescription] = useState(template.description);
    const [category, setCategory] = useState(template.category);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setError(null);
        try {
            await customTemplateApi.updateTemplate(template.id, {
                name,
                description,
                category,
            });
            onSuccess();
            onClose();
        } catch (err: unknown) {
            Logger.error('TEMPLATE_UPDATE_FAILED', { error: err });
            setError(
                err instanceof Error ? err.message : 'Failed to update template. Please try again.'
            );
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            style={styles.overlay}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div style={styles.modal}>
                <h2 style={styles.header}>Edit Template</h2>
                {error && <div style={styles.error}>{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Template Name</label>
                        <input
                            style={styles.input}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Category</label>
                        <input
                            style={styles.input}
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            required
                        />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Description</label>
                        <textarea
                            style={styles.textarea}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                    <div style={styles.actions}>
                        <button
                            type="button"
                            style={{ ...styles.button, ...styles.cancelButton }}
                            onClick={onClose}
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                ...styles.button,
                                ...styles.saveButton,
                                opacity: isSaving ? 0.7 : 1,
                            }}
                            disabled={isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
