import React from 'react';

interface ImagePreviewModalProps {
    imageUrl: string;
    altText?: string;
    onClose: () => void;
}

const styles = {
    overlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1100,
        cursor: 'zoom-out',
    },
    imageContainer: {
        position: 'relative' as const,
        maxWidth: '90%',
        maxHeight: '90%',
        backgroundColor: 'transparent',
        borderRadius: 'var(--jx-radius-lg, 0.5rem)',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    },
    image: {
        display: 'block' as const,
        maxWidth: '100%',
        maxHeight: '90vh',
        objectFit: 'contain' as const,
    },
    closeButton: {
        position: 'absolute' as const,
        top: '1rem',
        right: '1rem',
        background: 'rgba(0, 0, 0, 0.5)',
        color: '#FFF',
        border: 'none',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '1.5rem',
        transition: 'background 0.2s',
        zIndex: 1101,
    },
};

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
    imageUrl,
    altText,
    onClose,
}) => {
    return (
        <div style={styles.overlay} onClick={onClose}>
            <button
                style={styles.closeButton}
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                title="Close Preview"
            >
                &times;
            </button>
            <div style={styles.imageContainer} onClick={(e) => e.stopPropagation()}>
                <img src={imageUrl} alt={altText ?? 'Preview'} style={styles.image} />
            </div>
        </div>
    );
};
