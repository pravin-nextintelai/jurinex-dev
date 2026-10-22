import React, { useState, useRef } from 'react';
import { toast } from 'react-toastify';
import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

/**
 * LocalFileUpload Component
 * 
 * Uploads files from local computer following the flow:
 * Local -> GCS -> Google Drive (converted to Google Docs) -> Database
 * 
 * Props:
 * - onUploadSuccess: (draft) => void - Callback when upload succeeds
 * - onUploadError: (error) => void - Callback when upload fails
 * - maxFileSize: number - Maximum file size in bytes (default: 100MB)
 * - acceptedFormats: string[] - Accepted file formats (default: common document formats)
 * - className: string - Additional CSS classes
 * - showEditorButton: boolean - Show button to open in Google Docs after upload (default: true)
 * - showUploadFlow: boolean - Show upload flow information section (default: true)
 */
const LocalFileUpload = ({
  onUploadSuccess,
  onUploadError,
  maxFileSize = 100 * 1024 * 1024, // 100MB default
  acceptedFormats = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/pdf', // .pdf
    'text/plain', // .txt
    'application/rtf', // .rtf
    'text/html', // .html
  ],
  className = '',
  showEditorButton = true,
  showUploadFlow = true
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedDraft, setUploadedDraft] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const getAuthToken = () => {
    return localStorage.getItem('token') || sessionStorage.getItem('token');
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size
    if (file.size > maxFileSize) {
      const errorMsg = `File size exceeds limit. Maximum size: ${formatFileSize(maxFileSize)}`;
      setError(errorMsg);
      toast.error(errorMsg);
      e.target.value = '';
      return;
    }

    // Validate file type
    if (acceptedFormats.length > 0 && !acceptedFormats.includes(file.type)) {
      const errorMsg = `File type not supported. Accepted formats: ${acceptedFormats.map(f => f.split('/').pop()).join(', ')}`;
      setError(errorMsg);
      toast.error(errorMsg);
      e.target.value = '';
      return;
    }

    setSelectedFile(file);
    setError('');
    setUploadedDraft(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // Validate file size
    if (file.size > maxFileSize) {
      const errorMsg = `File size exceeds limit. Maximum size: ${formatFileSize(maxFileSize)}`;
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    // Validate file type
    if (acceptedFormats.length > 0 && !acceptedFormats.includes(file.type)) {
      const errorMsg = `File type not supported. Accepted formats: ${acceptedFormats.map(f => f.split('/').pop()).join(', ')}`;
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    setSelectedFile(file);
    setError('');
    setUploadedDraft(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError('');

    try {
      const token = getAuthToken();
      if (!token) {
        throw new Error('Authentication required. Please log in.');
      }

      // Create FormData
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Show progress toast
      toast.info('Uploading file to GCS...', { autoClose: 2000 });

      // Upload file
      // Backend route: /api/drafts/upload
      // DRAFTING_SERVICE_URL is typically: ${GATEWAY_URL}/drafting
      // So full URL should be: ${GATEWAY_URL}/drafting/api/drafts/upload
      const uploadUrl = `${DRAFTING_SERVICE_URL}/api/drafts/upload`;
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      setUploadProgress(50);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        
        if (response.status === 401 && errorData.needsAuth) {
          throw new Error('Google Drive not connected. Please connect your Google Drive account first.');
        }
        
        throw new Error(errorData.error || errorData.details || 'Upload failed');
      }

      setUploadProgress(75);

      const result = await response.json();
      setUploadProgress(100);

      if (result.success) {
        // Backend returns: { success: true, google_file_id, iframeUrl }
        // OR: { success: true, draft: {...}, google_file_id, iframeUrl }
        const draftData = {
          id: result.draft?.id || null, // May not be in response
          google_file_id: result.google_file_id,
          title: result.draft?.title || selectedFile.name.replace(/\.[^/.]+$/, ''),
          iframeUrl: result.iframeUrl
        };
        
        setUploadedDraft(draftData);
        
        // Call success callback with iframeUrl immediately
        // This will close modal and open iframe automatically
        if (onUploadSuccess) {
          onUploadSuccess(draftData, result.iframeUrl);
        }

        // Reset form immediately (don't wait)
        setSelectedFile(null);
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error.message || 'Failed to upload file';
      setError(errorMessage);
      toast.error(errorMessage);
      
      if (onUploadError) {
        onUploadError(error);
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleOpenInGoogleDocs = () => {
    if (uploadedDraft?.google_file_id) {
      const editorUrl = `https://docs.google.com/document/d/${uploadedDraft.google_file_id}/edit`;
      window.open(editorUrl, '_blank');
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadedDraft(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`local-file-upload ${className}`}>
      {/* File Input */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 ${
          isUploading
            ? 'border-blue-500 bg-blue-50'
            : error
            ? 'border-red-500 bg-red-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept={acceptedFormats.join(',')}
          disabled={isUploading}
        />

        {isUploading ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
            <p className="text-sm text-gray-600">Uploading and converting to Google Docs...</p>
            {uploadProgress > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            )}
            <p className="text-xs text-gray-500">Progress: {uploadProgress}%</p>
          </div>
        ) : uploadedDraft ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center text-green-500">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-green-600">Upload successful!</p>
            <p className="text-xs text-gray-500">{uploadedDraft.title}</p>
            {showEditorButton && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenInGoogleDocs();
                }}
                className="mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors"
              >
                Open in Google Docs
              </button>
            )}
          </div>
        ) : selectedFile ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center text-blue-500">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700">{selectedFile.name}</p>
            <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveFile();
              }}
              className="mt-2 px-3 py-1 text-xs text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-center text-gray-400">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">
              Drag and drop a file here, or <span className="font-medium text-blue-500">click to browse</span>
            </p>
            <p className="text-xs text-gray-500">
              Supported: DOCX, DOC, PDF, TXT, RTF, HTML (Max: {formatFileSize(maxFileSize)})
            </p>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Upload Button */}
      {selectedFile && !isUploading && !uploadedDraft && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleUpload}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-200 flex items-center gap-2"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload to GCS & Google Drive
          </button>
        </div>
      )}

      {/* Flow Information - Only show if showUploadFlow is true */}
      {showUploadFlow && !selectedFile && !isUploading && !uploadedDraft && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-xs text-blue-700 font-medium mb-1">Upload Flow:</p>
          <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
            <li>File uploaded to Google Cloud Storage (GCS)</li>
            <li>File converted to Google Docs format</li>
            <li>Document saved to database with sync information</li>
          </ol>
        </div>
      )}
    </div>
  );
};

export default LocalFileUpload;

