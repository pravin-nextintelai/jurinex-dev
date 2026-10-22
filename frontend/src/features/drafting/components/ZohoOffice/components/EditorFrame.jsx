/**
 * EditorFrame Component
 * 
 * Renders Office Integrator embedded editor in an iframe.
 * Uses full available height with minimize/maximize toggle.
 */
import React, { useState, useCallback, useEffect } from 'react';
import jurinexLogo from '../img/logo.jpg';

/**
 * SaveButton - Professional save button with state management
 * States: idle | saving | success | error
 */
const SaveButton = ({ onClick, disabled, isSaving }) => {
    const [saveState, setSaveState] = useState('idle'); // idle | saving | success | error

    // Sync with external isSaving prop
    useEffect(() => {
        if (isSaving) {
            setSaveState('saving');
        }
    }, [isSaving]);

    const handleClick = async () => {
        if (saveState === 'saving' || disabled) return;

        setSaveState('saving');
        try {
            await onClick();
            setSaveState('success');
            // Revert to idle after 2 seconds
            setTimeout(() => setSaveState('idle'), 2000);
        } catch (err) {
            setSaveState('error');
            // Revert to idle after 2 seconds
            setTimeout(() => setSaveState('idle'), 2000);
        }
    };

    // Button styles based on state
    const getButtonStyle = () => {
        const baseStyle = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            fontWeight: 500,
            fontSize: 12,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            minWidth: 90,
            justifyContent: 'center'
        };

        switch (saveState) {
            case 'saving':
                return {
                    ...baseStyle,
                    background: '#e5e7eb',
                    color: '#6b7280',
                    cursor: 'not-allowed'
                };
            case 'success':
                return {
                    ...baseStyle,
                    background: '#059669',
                    color: 'white',
                    cursor: 'default'
                };
            case 'error':
                return {
                    ...baseStyle,
                    background: '#dc2626',
                    color: 'white',
                    cursor: 'pointer'
                };
            default:
                return {
                    ...baseStyle,
                    background: disabled ? '#e5e7eb' : '#16a34a',
                    color: disabled ? '#9ca3af' : 'white',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                };
        }
    };

    // Spinner component
    const Spinner = () => (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            style={{ animation: 'spin 1s linear infinite' }}
        >
            <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="31.4 31.4"
                opacity="0.3"
            />
            <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="31.4 31.4"
                strokeDashoffset="75"
            />
        </svg>
    );

    // Checkmark icon
    const CheckIcon = () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
    );

    // Error icon
    const ErrorIcon = () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    );

    const renderContent = () => {
        switch (saveState) {
            case 'saving':
                return (
                    <>
                        <Spinner />
                        <span>Saving…</span>
                    </>
                );
            case 'success':
                return (
                    <>
                        <CheckIcon />
                        <span>Saved</span>
                    </>
                );
            case 'error':
                return (
                    <>
                        <ErrorIcon />
                        <span>Retry</span>
                    </>
                );
            default:
                return <span>Save</span>;
        }
    };

    return (
        <button
            onClick={handleClick}
            disabled={saveState === 'saving' || disabled}
            style={getButtonStyle()}
        >
            {renderContent()}
        </button>
    );
};

const EditorFrame = ({
    iframeUrl,
    title,
    onSave,
    onClose,
    isSaving = false
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadTimeout, setLoadTimeout] = useState(null);
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        if (iframeUrl) {
            setIsLoading(true);
            setLoadFailed(false);
            const timeout = setTimeout(() => {
                if (isLoading) {
                    setLoadFailed(true);
                    setIsLoading(false);
                }
            }, 10000);
            setLoadTimeout(timeout);
            return () => {
                if (timeout) clearTimeout(timeout);
            };
        }
    }, [iframeUrl]);

    const handleIframeLoad = useCallback(() => {
        setIsLoading(false);
        setLoadFailed(false);
        if (loadTimeout) clearTimeout(loadTimeout);
    }, [loadTimeout]);

    const handleIframeError = useCallback(() => {
        setIsLoading(false);
        setLoadFailed(true);
    }, []);

    const openInNewTab = useCallback(() => {
        window.open(iframeUrl, '_blank');
    }, [iframeUrl]);

    const toggleMaximize = useCallback(() => {
        setIsMaximized(prev => !prev);
    }, []);

    // Container styles based on maximize state
    const containerStyle = isMaximized ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: '#0f0b0bff'
    } : {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 100px)',
        overflow: 'hidden'
    };

    return (
        <div style={containerStyle}>
            {/* Compact Toolbar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'white',
                borderBottom: '1px solid #3f5175ff',
                flexShrink: 0
            }}>
                {/* logo adding into it */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <img src={jurinexLogo} alt="Jurinex" style={{ height: 34, marginRight: 8, borderRadius: 4 }} />
                    <span style={{ color: '#21C1B6', fontWeight: 800, fontSize: 14, marginRight: 12, letterSpacing: '0.5px' }}>JURINEX</span>
                    <svg style={{ width: 18, height: 18, color: '#f97316', marginRight: 8 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span style={{ color: '#111827', fontWeight: 600, fontSize: 13 }}>{title || 'Document'}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Save Button with States: idle | saving | success | error */}
                    <SaveButton
                        onClick={onSave}
                        disabled={isLoading}
                        isSaving={isSaving}
                    />

                    {/* Minimize/Maximize Button */}
                    <button
                        onClick={toggleMaximize}
                        style={{
                            padding: 5,
                            borderRadius: 5,
                            border: 'none',
                            background: '#21C1B6',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        title={isMaximized ? 'Minimize' : 'Maximize'}
                    >
                        {isMaximized ? (
                            <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                            </svg>
                        ) : (
                            <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                            </svg>
                        )}
                    </button>

                    {/* Open in New Tab */}
                    <button
                        onClick={openInNewTab}
                        style={{
                            padding: 5,
                            borderRadius: 5,
                            border: 'none',
                            background: 'transparent',
                            color: '#6b7280',
                            cursor: 'pointer'
                        }}
                        title="Open in new tab"
                    >
                        <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </button>

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        style={{
                            padding: 5,
                            borderRadius: 5,
                            border: 'none',
                            background: 'transparent',
                            color: '#6b7280',
                            cursor: isSaving ? 'not-allowed' : 'pointer',
                            opacity: isSaving ? 0.5 : 1
                        }}
                        title="Close"
                    >
                        <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Editor Area - Full height */}
            <div style={{
                flex: 1,
                position: 'relative',
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden'
            }}>
                {/* Loading */}
                {isLoading && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f3f4f6',
                        zIndex: 10
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 36,
                                height: 36,
                                border: '3px solid #e5e7eb',
                                borderTopColor: '#21C1B6',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 10px'
                            }} />
                            <p style={{ color: '#374151', fontWeight: 500, fontSize: 13 }}>Loading Editor...</p>
                        </div>
                    </div>
                )}

                {/* Failed */}
                {loadFailed && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f3f4f6',
                        zIndex: 10
                    }}>
                        <div style={{ textAlign: 'center', maxWidth: 280, padding: 16 }}>
                            <p style={{ color: '#374151', marginBottom: 10, fontSize: 13 }}>Editor could not load.</p>
                            <button
                                onClick={openInNewTab}
                                style={{
                                    padding: '8px 16px',
                                    background: '#f97316',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 5,
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    fontSize: 12
                                }}
                            >
                                Open in New Tab
                            </button>
                        </div>
                    </div>
                )}

                {/* Iframe - Full panel */}
                {iframeUrl && !loadFailed && (
                    <iframe
                        src={iframeUrl}
                        title="Document Editor"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                        allow="clipboard-write"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            visibility: isLoading ? 'hidden' : 'visible'
                        }}
                    />
                )}
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default EditorFrame;
