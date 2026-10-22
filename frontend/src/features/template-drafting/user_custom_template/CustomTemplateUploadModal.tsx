import React, { useState, useRef } from 'react';
import { Logger } from '../utils/logger';
import { customTemplateApi } from './api';
import type { CustomTemplateUploadModalProps } from './types';

type ModalMode = 'upload' | 'generate';

const styles = {
    overlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(5px)',
        padding: '1rem',
        animation: 'fadeIn 0.2s ease-out',
    },
    modal: {
        backgroundColor: '#FFFFFF',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '650px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        position: 'relative' as const,
        color: '#2D3748',
        display: 'flex',
        flexDirection: 'column' as const,
        maxHeight: '90vh',
        overflow: 'hidden',
        animation: 'slideUp 0.3s ease-out',
    },
    header: {
        padding: '1.5rem 2rem',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    title: {
        fontSize: '1.5rem',
        fontWeight: 700,
        color: '#1A202C',
        margin: 0,
        letterSpacing: '-0.025em',
    },
    closeButton: {
        background: 'transparent',
        border: 'none',
        fontSize: '1.5rem',
        cursor: 'pointer',
        color: '#A0AEC0',
        padding: '0.5rem',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        lineHeight: 1,
    },
    content: {
        padding: '2rem',
        overflowY: 'auto' as const,
        flex: 1,
    },
    formGroup: {
        marginBottom: '1.5rem',
    },
    label: {
        display: 'block',
        fontSize: '0.875rem',
        fontWeight: 600,
        marginBottom: '0.5rem',
        color: '#4A5568',
    },
    input: {
        width: '100%',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid #E2E8F0',
        fontSize: '1rem',
        fontFamily: 'inherit',
        backgroundColor: '#FFFFFF',
        transition: 'all 0.2s',
        color: '#2D3748',
        outline: 'none',
    },
    textarea: {
        width: '100%',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid #E2E8F0',
        fontSize: '1rem',
        fontFamily: 'inherit',
        backgroundColor: '#FFFFFF',
        minHeight: '120px',
        resize: 'vertical' as const,
        transition: 'all 0.2s',
        color: '#2D3748',
        outline: 'none',
    },
    dropZone: {
        border: '2px dashed #CBD5E0',
        borderRadius: '12px',
        padding: '2rem',
        textAlign: 'center' as const,
        cursor: 'pointer',
        backgroundColor: '#F7FAFC',
        transition: 'all 0.2s ease',
        marginTop: '0.5rem',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '160px',
    },
    dropZoneActive: {
        borderColor: '#3182CE',
        backgroundColor: '#EBF8FF',
    },
    fileIcon: {
        fontSize: '2.5rem',
        color: '#A0AEC0',
        marginBottom: '1rem',
    },
    dropTextMain: {
        fontSize: '1rem',
        fontWeight: 600,
        color: '#2D3748',
        marginBottom: '0.25rem',
    },
    dropTextSub: {
        color: '#718096',
        fontSize: '0.875rem',
    },
    selectedFile: {
        marginTop: '0.75rem',
        padding: '0.75rem 1rem',
        backgroundColor: '#F0FFF4',
        border: '1px solid #C6F6D5',
        color: '#22543D',
        borderRadius: '8px',
        fontSize: '0.875rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontWeight: 500,
    },
    footer: {
        padding: '1.5rem 2rem',
        borderTop: '1px solid #E2E8F0',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '1rem',
        backgroundColor: '#F7FAFC',
        borderBottomLeftRadius: '16px',
        borderBottomRightRadius: '16px',
    },
    button: {
        padding: '0.75rem 1.5rem',
        borderRadius: '8px',
        fontSize: '0.95rem',
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
    },
    cancelButton: {
        backgroundColor: '#FFFFFF',
        color: '#4A5568',
        border: '1px solid #CBD5E0',
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    },
    submitButton: {
        backgroundColor: '#3182CE',
        color: '#FFFFFF',
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        background: 'linear-gradient(to bottom, #4299E1, #3182CE)',
    },
    submitButtonDisabled: {
        backgroundColor: '#CBD5E0',
        background: '#CBD5E0',
        cursor: 'not-allowed',
        transform: 'none',
        boxShadow: 'none',
    },
    errorText: {
        color: '#E53E3E',
        fontSize: '0.875rem',
        marginTop: '0.5rem',
        padding: '0.5rem',
        backgroundColor: '#FFF5F5',
        borderRadius: '6px',
        border: '1px solid #FED7D7',
    },
};

const VALID_FILE_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
];

function validateAndSetFile(
    file: File,
    setFile: (f: File | null) => void,
    setError: (s: string | null) => void
) {
    const name = (file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';

    // Frontend protection: legacy ".doc" often causes backend DOCX extractor crashes.
    if (ext === '.doc') {
        setError('Legacy DOC (.doc) is not supported. Please upload a PDF or DOCX file instead.');
        return;
    }

    const isPdf = ext === '.pdf' || (file.type || '').toLowerCase().includes('application/pdf');
    const isDocx =
        ext === '.docx' ||
        (file.type || '').toLowerCase() ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isTxt = ext === '.txt' || (file.type || '').toLowerCase().startsWith('text/');

    const valid = isPdf || isDocx || isTxt || file.name.endsWith('.hdaf') || file.name.endsWith('.hnd');
    if (!valid) {
        setError('Please upload a template file in PDF, DOCX, or TXT format.');
        return;
    }
    setFile(file);
    setError(null);
}

export const CustomTemplateUploadModal: React.FC<CustomTemplateUploadModalProps> = ({
    isOpen,
    onClose,
    onUploadSuccess,
}) => {
    const [mode, setMode] = useState<ModalMode>('upload');
    const [name, setName] = useState('');
    const [category, setCategory] = useState('Contracts');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressStage, setProgressStage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) validateAndSetFile(droppedFile, setFile, setError);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) validateAndSetFile(selectedFile, setFile, setError);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !name) {
            setError('Please provide a template name and a file.');
            return;
        }

        console.log('[Custom Template Upload] Submit started', { name, file: file.name, category });
        setIsUploading(true);
        setError(null);
        setProgress(0);
        setProgressStage('Initializing...');

        const startTime = Date.now();
        const duration = 15000;
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const p = Math.min(95, (elapsed / duration) * 100);
            setProgress(p);
            if (p < 15) setProgressStage('OCR Processing...');
            else if (p < 30) setProgressStage('Analysing Document Structure...');
            else if (p < 45) setProgressStage('Chunking Content...');
            else if (p < 65) setProgressStage('Fields Extracting...');
            else if (p < 90) setProgressStage('Making Sections...');
            else setProgressStage('Finalizing...');
        }, 200);

        try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('category', category);
            formData.append('description', description);
            formData.append('file', file);
            if (imageFile) formData.append('image', imageFile);
            formData.append('subcategory', 'Custom');

            console.log('[Custom Template Upload] Calling API uploadTemplate...');
            const uploadResult = await customTemplateApi.uploadTemplate(formData);
            console.log('[Custom Template Upload] API returned success.', uploadResult);

            if (uploadResult?.template_id && uploadResult.status === 'processing') {
                setProgressStage('Template uploaded. Waiting for analysis...');
                const ready = await customTemplateApi.waitForTemplateReady(uploadResult.template_id, 8000, 45);
                if (ready.status === 'error') {
                    throw new Error('Template analysis failed. Please try another file or retry.');
                }
            }

            clearInterval(timer);
            setProgress(100);
            setProgressStage('Done!');

            setTimeout(() => {
                Logger.info('CUSTOM_TEMPLATE_UPLOAD_SUCCESS', { name, category });
                onUploadSuccess();
                onClose();
                setName('');
                setDescription('');
                setFile(null);
                setImageFile(null);
                setIsUploading(false);
                setProgress(0);
            }, 800);
        } catch (err: unknown) {
            console.error('[Custom Template Upload] API error', err);
            clearInterval(timer);
            setIsUploading(false);
            setProgress(0);
            setError(
                err instanceof Error ? err.message : 'Failed to upload template. Please try again.'
            );
        }
    };

    const getInputStyle = (fieldName: string) => ({
        ...styles.input,
        borderColor: focusedField === fieldName ? '#3182CE' : '#E2E8F0',
        boxShadow:
            focusedField === fieldName ? '0 0 0 3px rgba(49, 130, 206, 0.1)' : 'none',
    });

    const getTextareaStyle = () => ({
        ...styles.textarea,
        borderColor: focusedField === 'description' ? '#3182CE' : '#E2E8F0',
        boxShadow:
            focusedField === 'description' ? '0 0 0 3px rgba(49, 130, 206, 0.1)' : 'none',
    });

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <div style={styles.header}>
                    <h2 style={styles.title}>
                        {mode === 'generate' ? 'Generate Template with AI' : 'Upload Custom Template'}
                    </h2>
                    <button
                        style={styles.closeButton}
                        onClick={onClose}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#2D3748';
                            e.currentTarget.style.backgroundColor = '#F7FAFC';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#A0AEC0';
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                    >
                        &times;
                    </button>
                </div>

                {/* Mode Tab Switcher */}
                <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F7FAFC' }}>
                    <button
                        type="button"
                        onClick={() => setMode('upload')}
                        style={{
                            flex: 1,
                            padding: '0.75rem 1rem',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            border: 'none',
                            borderBottom: mode === 'upload' ? '2px solid #3182CE' : '2px solid transparent',
                            backgroundColor: 'transparent',
                            color: mode === 'upload' ? '#3182CE' : '#718096',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        📄 Upload File
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('generate')}
                        style={{
                            flex: 1,
                            padding: '0.75rem 1rem',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            border: 'none',
                            borderBottom: mode === 'generate' ? '2px solid #5A67D8' : '2px solid transparent',
                            backgroundColor: 'transparent',
                            color: mode === 'generate' ? '#5A67D8' : '#718096',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        ✨ Generate with AI
                    </button>
                </div>

                {/* Generate with AI Panel */}
                {mode === 'generate' && (
                    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Hero */}
                        <div style={{
                            background: 'linear-gradient(135deg, #EBF4FF 0%, #E8E8FF 100%)',
                            borderRadius: '12px',
                            padding: '1.5rem',
                            textAlign: 'center',
                            border: '1px solid #C3DAFE',
                        }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚖️</div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#2D3748', margin: '0 0 0.5rem' }}>
                                AI Legal Template Generator
                            </h3>
                            <p style={{ fontSize: '0.875rem', color: '#4A5568', margin: 0, lineHeight: 1.6 }}>
                                Answer 6 quick questions and let Gemini AI draft a complete,
                                professionally structured legal template — with numbered clauses,
                                all standard sections, and auto-detected form fields.
                            </p>
                        </div>

                        {/* Feature list */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {[
                                ['📋', 'Numbered clauses & standard sections (PARTIES, RECITALS, TERMS…)'],
                                ['🏷️', 'Auto-extracted form fields with __placeholder__ syntax'],
                                ['⚖️', 'Jurisdiction-aware — Indian statutes, state-specific law'],
                                ['🌐', 'Bilingual support (English + Hindi / Marathi / Gujarati…)'],
                                ['📄', 'Brief to Ultra-Detailed — you control the length'],
                            ].map(([icon, text]) => (
                                <div key={String(text)} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                                    <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.1rem' }}>{icon}</span>
                                    <span style={{ fontSize: '0.8125rem', color: '#4A5568', lineHeight: 1.5 }}>{text}</span>
                                </div>
                            ))}
                        </div>

                        {/* CTA */}
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                window.location.href = '/build-template';
                            }}
                            style={{
                                padding: '0.875rem 1.5rem',
                                borderRadius: '10px',
                                border: 'none',
                                background: 'linear-gradient(135deg, #4299E1, #5A67D8)',
                                color: '#FFFFFF',
                                fontSize: '1rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: '0 4px 14px rgba(66, 99, 235, 0.35)',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(66, 99, 235, 0.45)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 14px rgba(66, 99, 235, 0.35)';
                            }}
                        >
                            <span>✨</span> Start AI Template Builder
                        </button>

                        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#A0AEC0', margin: 0 }}>
                            Takes 30–90 seconds · Saved directly to your template library
                        </p>
                    </div>
                )}

                {/* Upload Form (only shown in upload mode) */}
                {mode === 'upload' && (
                <div style={styles.content}>
                    <form id="upload-form" onSubmit={handleSubmit}>
                        <div style={styles.formGroup}>
                            <label style={styles.label}>Template Name *</label>
                            <input
                                style={getInputStyle('name')}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onFocus={() => setFocusedField('name')}
                                onBlur={() => setFocusedField(null)}
                                placeholder="e.g., Non-Disclosure Agreement v2"
                                required
                            />
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.label}>Category *</label>
                            <div style={{ position: 'relative' }}>
                                <select
                                    style={{
                                        ...getInputStyle('category'),
                                        appearance: 'none',
                                        WebkitAppearance: 'none',
                                        MozAppearance: 'none',
                                        cursor: 'pointer',
                                    }}
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    onFocus={() => setFocusedField('category')}
                                    onBlur={() => setFocusedField(null)}
                                >
                                    <option value="Contracts">Contracts</option>
                                    <option value="Agreements">Agreements</option>
                                    <option value="Letters">Letters</option>
                                    <option value="Legal Notices">Legal Notices</option>
                                    <option value="Other">Other</option>
                                </select>
                                <div
                                    style={{
                                        position: 'absolute',
                                        right: '1rem',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        pointerEvents: 'none',
                                        color: '#718096',
                                        fontSize: '0.8rem',
                                    }}
                                >
                                    ▼
                                </div>
                            </div>
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.label}>Description</label>
                            <textarea
                                style={getTextareaStyle()}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                onFocus={() => setFocusedField('description')}
                                onBlur={() => setFocusedField(null)}
                                placeholder="Briefly describe the template's purpose..."
                            />
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.label}>Cover Image</label>
                            <div
                                style={{
                                    ...styles.dropZone,
                                    minHeight: '100px',
                                    padding: '1.5rem',
                                    borderColor: '#E2E8F0',
                                    borderStyle: 'solid',
                                }}
                                onClick={() =>
                                    document.getElementById('image-upload')?.click()
                                }
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = '#CBD5E0';
                                    e.currentTarget.style.backgroundColor = '#EDF2F7';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = '#E2E8F0';
                                    e.currentTarget.style.backgroundColor = '#F7FAFC';
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem',
                                    }}
                                >
                                    <span style={{ fontSize: '1.5rem', color: '#CBD5E0' }}>
                                        🖼️
                                    </span>
                                    <div style={{ textAlign: 'left' }}>
                                        <p
                                            style={{
                                                ...styles.dropTextMain,
                                                fontSize: '0.9rem',
                                                marginBottom: 0,
                                            }}
                                        >
                                            {imageFile ? imageFile.name : 'Upload Cover Image'}
                                        </p>
                                        <p style={{ ...styles.dropTextSub, fontSize: '0.75rem' }}>
                                            {imageFile ? 'Click to replace' : 'Optional • PNG, JPG'}
                                        </p>
                                    </div>
                                    {imageFile && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setImageFile(null);
                                            }}
                                            style={{
                                                marginLeft: 'auto',
                                                background: 'none',
                                                border: 'none',
                                                color: '#E53E3E',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                            }}
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                                <input
                                    id="image-upload"
                                    type="file"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        if (e.target.files?.[0])
                                            setImageFile(e.target.files[0]);
                                    }}
                                    accept="image/*"
                                />
                            </div>
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.label}>Template File *</label>
                            <div
                                style={{
                                    ...styles.dropZone,
                                    ...(isDragging ? styles.dropZoneActive : {}),
                                }}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                onMouseEnter={(e) => {
                                    if (!isDragging) {
                                        e.currentTarget.style.borderColor = '#3182CE';
                                        e.currentTarget.style.backgroundColor = '#EBF8FF';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isDragging) {
                                        e.currentTarget.style.borderColor = '#CBD5E0';
                                        e.currentTarget.style.backgroundColor = '#F7FAFC';
                                    }
                                }}
                            >
                                <div style={styles.fileIcon}>📄</div>
                                <p style={styles.dropTextMain}>
                                    {isDragging ? 'Drop file here' : 'Drag & drop file here'}
                                </p>
                                <p style={styles.dropTextSub}>
                                    or click to browse from computer
                                </p>
                                <p
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#A0AEC0',
                                        marginTop: '0.5rem',
                                    }}
                                >
                                    Supports PDF, DOCX, TXT
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    style={{ display: 'none' }}
                                    onChange={handleFileSelect}
                                    accept=".pdf,.docx,.txt"
                                />
                            </div>
                            {file && (
                                <div style={styles.selectedFile}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                        }}
                                    >
                                        <span>📎</span>
                                        <span>{file.name}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFile(null);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: '#E53E3E',
                                            fontWeight: 'bold',
                                        }}
                                    >
                                        &times;
                                    </button>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div style={styles.errorText}>⚠️ {error}</div>
                        )}
                    </form>
                </div>
                )}

                {mode === 'upload' && (
                <div style={styles.footer}>
                    <button
                        type="button"
                        style={{ ...styles.button, ...styles.cancelButton }}
                        onClick={onClose}
                        disabled={isUploading}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = '#F7FAFC')
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = '#FFFFFF')
                        }
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="upload-form"
                        style={{
                            ...styles.button,
                            ...styles.submitButton,
                            ...(isUploading ? styles.submitButtonDisabled : {}),
                        }}
                        disabled={isUploading}
                        onMouseEnter={(e) =>
                            !isUploading && (e.currentTarget.style.transform = 'translateY(-1px)')
                        }
                        onMouseLeave={(e) =>
                            !isUploading && (e.currentTarget.style.transform = 'translateY(0)')
                        }
                    >
                        {isUploading ? (
                            <div
                                style={{
                                    width: '250px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.25rem',
                                    alignItems: 'flex-start',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        width: '100%',
                                        fontSize: '0.75rem',
                                        color: '#FFFFFF',
                                        fontWeight: 600,
                                    }}
                                >
                                    <span
                                        style={{
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '200px',
                                        }}
                                    >
                                        {progressStage}
                                    </span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div
                                    style={{
                                        width: '100%',
                                        height: '6px',
                                        backgroundColor: 'rgba(255,255,255,0.3)',
                                        borderRadius: '3px',
                                        overflow: 'hidden',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${progress}%`,
                                            height: '100%',
                                            backgroundColor: '#FFFFFF',
                                            borderRadius: '3px',
                                            transition: 'width 0.2s linear',
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            'Upload Template'
                        )}
                    </button>
                </div>
                )}

                <style>{`
                    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        </div>
    );
};
