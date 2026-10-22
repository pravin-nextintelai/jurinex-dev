import React, { useState, useRef, useEffect } from 'react';
import type { TemplateListItem } from '../types';
import type { CustomTemplateCardProps } from './types';
import { EditTemplateModal } from './EditTemplateModal';
import { ImagePreviewModal } from './ImagePreviewModal';

const styles = {
    card: {
        backgroundColor: 'var(--jx-bg-primary, #FFFFFF)',
        borderRadius: 'var(--jx-radius-lg, 0.75rem)',
        boxShadow: 'var(--jx-shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1))',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column' as const,
        height: '300px',
        position: 'relative' as const,
        border: '1px solid var(--jx-border, #E2E8F0)',
        overflow: 'hidden',
    },
    thumbnailContainer: {
        width: '100%',
        height: '75%',
        backgroundColor: 'var(--jx-bg-secondary, #F7FAFC)',
        borderBottom: '1px solid var(--jx-border, #E2E8F0)',
        position: 'relative' as const,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    thumbnailImage: {
        width: '100%',
        height: '100%',
        objectFit: 'cover' as const,
        objectPosition: 'top',
    },
    thumbnailContentPreview: {
        padding: '1rem',
        fontSize: '0.6rem',
        color: '#718096',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        textAlign: 'left' as const,
        whiteSpace: 'pre-wrap' as const,
    },
    footer: {
        height: '25%',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column' as const,
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        zIndex: 2,
    },
    title: {
        fontSize: 'var(--jx-text-lg, 1.125rem)',
        fontWeight: 'bold',
        color: 'var(--jx-text-primary, #2D3748)',
        margin: 0,
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    category: {
        fontSize: 'var(--jx-text-xs, 0.75rem)',
        color: 'var(--jx-text-secondary, #718096)',
        marginTop: '0.25rem',
    },
    actionsContainer: {
        position: 'absolute' as const,
        top: '1rem',
        right: '1rem',
        display: 'flex',
        gap: '0.5rem',
        zIndex: 10,
    },
    iconButton: {
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        backgroundColor: '#FFFFFF',
        border: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        fontSize: '1.2rem',
        color: '#4A5568',
        transition: 'all 0.2s',
        padding: 0,
    },
    menu: {
        position: 'absolute' as const,
        top: '100%',
        right: 0,
        marginTop: '0.5rem',
        backgroundColor: '#FFFFFF',
        borderRadius: '0.5rem',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        border: '1px solid #E2E8F0',
        minWidth: '150px',
        overflow: 'hidden',
        zIndex: 20,
    },
    menuItem: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '0.75rem 1rem',
        border: 'none',
        background: 'none',
        textAlign: 'left' as const,
        cursor: 'pointer',
        fontSize: '0.875rem',
        color: '#2D3748',
        transition: 'background-color 0.2s',
    },
    menuItemDelete: {
        color: '#E53E3E',
    },
    uploadCard: {
        justifyContent: 'center',
        alignItems: 'center',
        border: '2px dashed var(--jx-border-dark, #CBD5E0)',
        backgroundColor: 'var(--jx-bg-secondary, #F7FAFC)',
        minHeight: '300px',
    },
    uploadIcon: {
        fontSize: '3rem',
        color: 'var(--jx-text-muted, #A0AEC0)',
        marginBottom: '1rem',
    },
    uploadText: {
        fontSize: 'var(--jx-text-base, 1rem)',
        fontWeight: 600,
        color: 'var(--jx-text-secondary, #718096)',
    },
    noPreviewOverlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
    },
    noPreviewModal: {
        background: 'white',
        padding: '2rem',
        borderRadius: '8px',
        zIndex: 1101,
    },
};

export const CustomTemplateCard: React.FC<CustomTemplateCardProps> = ({
    template,
    onClick,
    onDelete,
    onUpdate,
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
        };
        if (isMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMenuOpen]);

    const handleMenuToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsMenuOpen((prev) => !prev);
    };

    const handleEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsMenuOpen(false);
        setIsEditOpen(true);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsMenuOpen(false);
        if (window.confirm(`Are you sure you want to delete "${template.name}"?`)) {
            onDelete(template.id);
        }
    };

    const handlePreview = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPreviewOpen(true);
    };

    return (
        <>
            <div
                style={styles.card}
                onClick={() => onClick(template)}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = 'var(--jx-shadow-lg)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'var(--jx-shadow-md)';
                }}
            >
                <div style={styles.thumbnailContainer}>
                    {template.imageUrl ? (
                        <img
                            src={template.imageUrl}
                            alt={template.name}
                            style={styles.thumbnailImage}
                        />
                    ) : (
                        <div style={styles.thumbnailContentPreview}>
                            <div
                                style={{
                                    fontWeight: 'bold',
                                    marginBottom: '4px',
                                    fontSize: '0.75rem',
                                }}
                            >
                                {template.name}
                            </div>
                            <div style={{ fontSize: '0.65rem', marginBottom: '8px' }}>
                                {template.description}
                            </div>
                            {[...Array(6)].map((_, i) => (
                                <div
                                    key={`preview-line-${template.id || template.name}-${i}`}
                                    style={{
                                        marginTop: '6px',
                                        height: '4px',
                                        background: '#EDF2F7',
                                        width: `${Math.random() * 40 + 60}%`,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                    <div style={styles.actionsContainer}>
                        <button
                            style={styles.iconButton}
                            onClick={handlePreview}
                            title="Preview"
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#3182CE')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#4A5568')}
                        >
                            👀
                        </button>
                        <div style={{ position: 'relative' }} ref={menuRef}>
                            <button
                                style={styles.iconButton}
                                onClick={handleMenuToggle}
                                title="More Options"
                            >
                                ⋮
                            </button>
                            {isMenuOpen && (
                                <div style={styles.menu}>
                                    <button
                                        style={styles.menuItem}
                                        onClick={handleEdit}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.backgroundColor = '#F7FAFC')
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.backgroundColor = 'transparent')
                                        }
                                    >
                                        ✏️ Edit
                                    </button>
                                    <button
                                        style={{ ...styles.menuItem, ...styles.menuItemDelete }}
                                        onClick={handleDelete}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.backgroundColor = '#FFF5F5')
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.backgroundColor = 'transparent')
                                        }
                                    >
                                        🗑️ Delete
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div style={styles.footer}>
                    <h3 style={styles.title} title={template.name}>
                        {template.name}
                    </h3>
                    <span style={styles.category}>{template.category}</span>
                </div>
            </div>

            {isEditOpen && (
                <EditTemplateModal
                    template={template}
                    onClose={() => setIsEditOpen(false)}
                    onSuccess={onUpdate}
                />
            )}

            {isPreviewOpen && template.imageUrl && (
                <ImagePreviewModal
                    imageUrl={template.imageUrl}
                    altText={template.name}
                    onClose={() => setIsPreviewOpen(false)}
                />
            )}

            {isPreviewOpen && !template.imageUrl && (
                <div
                    style={styles.noPreviewOverlay}
                    onClick={() => setIsPreviewOpen(false)}
                >
                    <div
                        style={styles.noPreviewModal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>No Preview Available</h3>
                        <p>This template does not have a cover image.</p>
                        <button
                            onClick={() => setIsPreviewOpen(false)}
                            style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export const UploadTriggerCard: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    return (
        <div
            style={{ ...styles.card, ...styles.uploadCard }}
            onClick={onClick}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--jx-primary, #1A365D)';
                e.currentTarget.style.backgroundColor = 'var(--jx-info-light, #BEE3F8)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--jx-border-dark, #CBD5E0)';
                e.currentTarget.style.backgroundColor = 'var(--jx-bg-secondary, #F7FAFC)';
            }}
        >
            <div style={styles.uploadIcon}>+</div>
            <p style={styles.uploadText}>Upload Custom Template</p>
        </div>
    );
};
