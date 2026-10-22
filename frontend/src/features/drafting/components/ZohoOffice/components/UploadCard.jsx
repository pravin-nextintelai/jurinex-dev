/**
 * UploadCard Component
 * 
 * Drag-and-drop file upload card for drafting.
 */
import React, { useState, useRef, useCallback } from 'react';

const ALLOWED_TYPES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/pdf' // .pdf
];

const ALLOWED_EXTENSIONS = ['.docx', '.doc', '.pdf'];

/**
 * @param {Object} props
 * @param {Function} props.onUpload - Upload callback (receives File or File[])
 * @param {boolean} props.isUploading - Uploading state
 * @param {number} props.progress - Upload progress (0-100)
 */
const UploadCard = ({ onUpload, isUploading = false, progress = 0 }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    /**
     * Validate file
     */
    const validateFile = (file) => {
        // Check extension
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return `Invalid file type. Please upload ${ALLOWED_EXTENSIONS.join(', ')} files.`;
        }

        // Check size (50MB max)
        if (file.size > 50 * 1024 * 1024) {
            return 'File too large. Maximum size is 50MB.';
        }

        return null;
    };

    /**
     * Handle file selection
     */
    const handleFile = useCallback((file) => {
        setError(null);

        const validationError = validateFile(file);
        if (validationError) {
            setError(validationError);
            return;
        }

        onUpload(file);
    }, [onUpload]);

    /**
     * Handle drag events
     */
    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const fileList = Array.from(files);
            if (fileList.length === 1) {
                handleFile(fileList[0]);
            } else {
                onUpload(fileList);
            }
        }
    }, [handleFile, onUpload]);

    /**
     * Handle file input change (supports multiple selection)
     */
    const handleInputChange = useCallback((e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const fileList = Array.from(files);
            if (fileList.length === 1) {
                handleFile(fileList[0]);
            } else {
                onUpload(fileList);
            }
        }
        e.target.value = '';
    }, [handleFile, onUpload]);

    /**
     * Open file picker
     */
    const openPicker = useCallback(() => {
        if (!isUploading) {
            fileInputRef.current?.click();
        }
    }, [isUploading]);

    return (
        <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Upload Document
            </h3>

            {/* Dropzone */}
            <div
                onClick={openPicker}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                    border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
                    ${isDragging
                        ? 'border-[#21C1B6] bg-[#21C1B6]/10'
                        : 'border-gray-300 hover:border-[#21C1B6] hover:bg-gray-50'
                    }
                    ${isUploading ? 'pointer-events-none opacity-60' : ''}
                `}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    onChange={handleInputChange}
                    accept={ALLOWED_EXTENSIONS.join(',')}
                    className="hidden"
                    aria-label="Select one or more documents"
                />

                {isUploading ? (
                    <div>
                        <svg className="w-12 h-12 mx-auto text-[#21C1B6] animate-spin mb-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <p className="text-gray-900 font-medium mb-1">Uploading...</p>
                        {progress > 0 && (
                            <div className="w-48 mx-auto bg-gray-200 rounded-full h-2 mt-3">
                                <div
                                    className="bg-[#21C1B6] h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <div>
                        <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-gray-900 font-medium mb-1">
                            Drop file here or click to browse
                        </p>
                        <p className="text-gray-500 text-sm">
                            DOCX, DOC, or PDF (max 50MB). You can select multiple files.
                        </p>
                    </div>
                )}
            </div>

            {/* Error message */}
            {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center">
                    <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {error}
                </div>
            )}

            {/* Hint */}
            <p className="mt-4 text-gray-400 text-xs text-center">
                Tip: DOCX files work best with the editor
            </p>
        </div>
    );
};

export default UploadCard;
