/**
 * PdfViewer Component
 * 
 * Read-only PDF viewer using native browser PDF rendering.
 * Used for viewing PDF documents (not editable).
 */
import React, { useState } from 'react';
import logo from '../img/logo.jpg';

const PdfViewer = ({
    viewerUrl,
    title,
    onClose
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [isMaximized, setIsMaximized] = useState(false);

    const handleLoad = () => {
        setIsLoading(false);
    };

    const toggleMaximize = () => {
        setIsMaximized(prev => !prev);
    };

    const openInNewTab = () => {
        window.open(viewerUrl, '_blank');
    };

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
        background: '#130e0eff'
    } : {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 100px)',
        overflow: 'hidden'
    };

    return (
        <div style={containerStyle}>
            {/* Toolbar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: '#ffffffff',
                borderBottom: '1px solid #1900fdff',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <img src={logo} alt="Jurinex Logo" style={{ height: 26, marginRight: 4 }} />
                    <span style={{ color: 'black', fontWeight: 700, fontSize: 13, marginRight: 8 }}>JURINEX</span>
                    {/* PDF Icon */}
                    <svg style={{ width: 18, height: 18, color: '#ef4444', marginRight: 8 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span style={{ color: 'black', fontWeight: 500, fontSize: 13 }}>{title || 'PDF Document'}</span>

                    {/* Read-only Badge */}
                    <span style={{
                        marginLeft: 10,
                        padding: '2px 8px',
                        background: '#374151',
                        color: '#ffffffff',
                        fontSize: 10,
                        fontWeight: 500,
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Read-only PDF
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Maximize/Minimize Button */}
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
                            color: '#000000ff',
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
                        style={{
                            padding: 5,
                            borderRadius: 5,
                            border: 'none',
                            background: 'transparent',
                            color: '#000000ff',
                            cursor: 'pointer'
                        }}
                        title="Close"
                    >
                        <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* PDF Viewer Area */}
            <div style={{
                flex: 1,
                position: 'relative',
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden',
                background: '#8b8b8bff'
            }}>
                {/* Loading Spinner */}
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
                                borderTopColor: '#ef4444',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 10px'
                            }} />
                            <p style={{ color: '#374151', fontWeight: 500, fontSize: 13 }}>Loading PDF...</p>
                        </div>
                    </div>
                )}

                {/* PDF Iframe */}
                {viewerUrl && (
                    <iframe
                        src={viewerUrl}
                        title="PDF Viewer"
                        onLoad={handleLoad}
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

export default PdfViewer;
