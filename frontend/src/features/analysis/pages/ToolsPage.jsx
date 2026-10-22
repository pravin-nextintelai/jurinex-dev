import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import MindmapViewer from '../components/MindmapViewer';
import { Network, FileText, Loader2, ChevronDown, AlertCircle, CheckCircle, Upload, X, Plus } from 'lucide-react';
import { mindmapService } from '../api/mindmapService';
import { formatFileSize } from '@/shared/utils/planUtils';
import { useLlmChatLimits } from '@/shared/hooks/useLlmChatLimits';
import { formatUploadLimitExceededMessage } from '@/shared/api/llmChatLimitsService';
import { API_BASE_URL } from '@/config/apiConfig';

const ToolsPage = () => {
  const location = useLocation();
  const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
  const { maxUploadBytes, maxUploadMbLabel, loading: limitsLoading, error: limitsError } = useLlmChatLimits();
  const fileInputRef = useRef(null);
  
  const [files, setFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState(paramFileId ? [paramFileId] : []);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [mindmapData, setMindmapData] = useState(null);
  const [isGeneratingMindmap, setIsGeneratingMindmap] = useState(false);
  const [mindmapError, setMindmapError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({});
  const [fileSizeLimitError, setFileSizeLimitError] = useState(null);
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const [sessionId] = useState(() => {
    if (paramSessionId) return paramSessionId;
    const stateSessionId = location.state?.sessionId;
    if (stateSessionId) return stateSessionId;
    return generateUUID();
  });
  
  const getAuthToken = () => {
    const tokenKeys = [
      'authToken',
      'token',
      'accessToken',
      'jwt',
      'bearerToken',
      'auth_token',
      'access_token',
      'api_token',
      'userToken',
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  useEffect(() => {
    const fetchFiles = async () => {
      setIsLoadingFiles(true);
      try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/mindmap/files`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch files');
        }

        const data = await response.json();
        if (data.success && data.files) {
          setFiles(data.files);
          
          if (paramFileId && data.files.find(f => f.id === paramFileId)) {
            const file = data.files.find(f => f.id === paramFileId);
            setSelectedFileIds([paramFileId]);
            setSelectedFiles([file]);
            
            loadExistingMindmap([paramFileId]);
          }
        }
      } catch (error) {
        console.error('Error fetching files:', error);
        setMindmapError('Failed to load files. Please try again.');
      } finally {
        setIsLoadingFiles(false);
      }
    };

    fetchFiles();
  }, []);

  const loadExistingMindmap = async (fileIds) => {
    try {
      if (fileIds.length === 1) {
        const result = await mindmapService.getMindmapsByFile(fileIds[0], sessionId);
        if (result.success && result.mindmaps && result.mindmaps.length > 0) {
          const latestMindmapId = result.mindmaps[0].id;
          const mindmap = await mindmapService.getMindmap(latestMindmapId);
          if (mindmap.success && mindmap.data) {
            setMindmapData(mindmap);
            setMindmapError(null);
          }
        }
      }
    } catch (error) {
      console.log('No existing mindmap found for these files');
    }
  };

  const handleFileToggle = (file) => {
    const isSelected = selectedFileIds.includes(file.id);
    if (isSelected) {
      setSelectedFileIds(selectedFileIds.filter(id => id !== file.id));
      setSelectedFiles(selectedFiles.filter(f => f.id !== file.id));
    } else {
      setSelectedFileIds([...selectedFileIds, file.id]);
      setSelectedFiles([...selectedFiles, file]);
    }
    setMindmapData(null);
    setMindmapError(null);
  };

  const handleFileUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    if (limitsLoading) {
      setUploadError('Loading upload limits from server… Please try again in a moment.');
      event.target.value = '';
      return;
    }
    if (limitsError || maxUploadBytes == null) {
      setUploadError('Could not load upload limits (llm_chat_config). Please refresh the page.');
      event.target.value = '';
      return;
    }

    const maxSize = maxUploadBytes;
    let hasFileSizeError = false;

    const validFiles = selectedFiles.filter((file) => {
      if (file.size > maxSize) {
        const fileSizeFormatted = formatFileSize(file.size);
        setFileSizeLimitError({
          message: formatUploadLimitExceededMessage({
            fileName: file.name,
            fileSizeFormatted,
            limitMbLabel: maxUploadMbLabel,
          }),
        });
        hasFileSizeError = true;
        return false;
      }
      return true;
    });

    if (validFiles.length === 0 && !hasFileSizeError) {
      event.target.value = '';
      return;
    } else if (hasFileSizeError) {
      event.target.value = '';
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress({});

    try {
      const token = getAuthToken();
      const formData = new FormData();
      validFiles.forEach(file => {
        formData.append('files', file);
      });

      const response = await fetch(`${API_BASE_URL}/mindmap/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const fetchResponse = await fetch(`${API_BASE_URL}/mindmap/files`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const fetchData = await fetchResponse.json();
        if (fetchData.success && fetchData.files) {
          setFiles(fetchData.files);
        }
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      setUploadError(error.message || 'Failed to upload files. Please try again.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleGenerateMindmap = async () => {
    if (selectedFileIds.length === 0) {
      setMindmapError('Please select at least one file first');
      return;
    }

    setIsGeneratingMindmap(true);
    setMindmapError(null);
    setMindmapData(null);

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/mindmap/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_ids: selectedFileIds,
          session_id: sessionId,
          prompt: null
        })
      });

      const result = await response.json();

      console.log('Mindmap generation response:', result);

      if (response.ok && result.success) {
        if (result.mindmap && result.mindmap.data) {
          setMindmapData(result.mindmap);
          setMindmapError(null);
        } else {
          console.warn('Unexpected response structure, using full result:', result);
          setMindmapData(result.mindmap || result);
          setMindmapError(null);
        }
      } else {
        throw new Error(result.error || result.details || 'Failed to generate mindmap');
      }
    } catch (error) {
      console.error('Error generating mindmap:', error);
      setMindmapError(
        error.response?.data?.error || 
        error.message || 
        'Failed to generate mindmap. Please try again.'
      );
      setMindmapData(null);
    } finally {
      setIsGeneratingMindmap(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Network className="h-6 w-6 text-[#21C1B6]" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Tools - Mindmap</h1>
              <p className="text-sm text-gray-600 mt-0.5">Visualize document relationships and generate interactive mind maps</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                  <span className="text-sm">Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-[#21C1B6]" />
                  <span className="text-sm font-medium">Upload Files</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-3 flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <button
              onClick={() => setShowFileDropdown(!showFileDropdown)}
              disabled={isLoadingFiles}
              className="w-full flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed justify-between"
            >
              {isLoadingFiles ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                  <span className="text-sm text-gray-600">Loading files...</span>
                </>
              ) : (
                <>
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-[#21C1B6] flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {selectedFiles.length > 0 
                        ? `${selectedFiles.length} file(s) selected`
                        : 'Select files'}
                    </span>
                  </div>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </button>

            {showFileDropdown && !isLoadingFiles && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowFileDropdown(false)}
                />
                <div className="absolute left-0 mt-2 w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
                  {files.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      No processed files available. Upload and process a document first.
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 sticky top-0">
                        <p className="text-xs font-semibold text-gray-700 uppercase">Select Files (Multiple)</p>
                        <p className="text-xs text-gray-500 mt-1">{selectedFileIds.length} selected</p>
                      </div>
                      {files.map((file) => {
                        const isSelected = selectedFileIds.includes(file.id);
                        return (
                          <button
                            key={file.id}
                            onClick={() => handleFileToggle(file)}
                            className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 ${
                              isSelected ? 'bg-[#E0F7F6]' : ''
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              <div className={`mt-1 h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                isSelected 
                                  ? 'bg-[#21C1B6] border-[#21C1B6]' 
                                  : 'border-gray-300'
                              }`}>
                                {isSelected && <CheckCircle className="h-4 w-4 text-white" />}
                              </div>
                              <FileText className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                                isSelected ? 'text-[#21C1B6]' : 'text-gray-400'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${
                                  isSelected ? 'text-[#21C1B6]' : 'text-gray-900'
                                }`}>
                                  {file.name}
                                </p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                                  {file.status === 'processed' && (
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                  )}
                                  {file.hasChats && (
                                    <span className="text-xs text-[#21C1B6]">• Has chats</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {selectedFiles.length > 0 && (
            <div className="flex items-center space-x-2 flex-wrap gap-2">
              {selectedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg"
                >
                  <FileText className="h-4 w-4 text-[#21C1B6]" />
                  <span className="text-sm font-medium text-gray-900 max-w-[150px] truncate">
                    {file.name}
                  </span>
                  <button
                    onClick={() => handleFileToggle(file)}
                    className="text-[#21C1B6] hover:text-[#1AA49B] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleGenerateMindmap}
            disabled={selectedFileIds.length === 0 || isGeneratingMindmap}
            className="flex items-center space-x-2 px-6 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium whitespace-nowrap"
          >
            {isGeneratingMindmap ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Network className="h-4 w-4" />
                <span>Generate Mindmap</span>
              </>
            )}
          </button>
        </div>

        {fileSizeLimitError && (
          <div className="mt-3 animate-fadeIn" style={{ zIndex: 1000 }}>
            <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg shadow-sm p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 mb-1">Upload limit exceeded</p>
                  <p className="text-xs text-gray-700 leading-relaxed">
                    {fileSizeLimitError.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFileSizeLimitError(null)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-3 animate-fadeIn">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{uploadError}</p>
              </div>
              <button
                onClick={() => setUploadError(null)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {mindmapError && (
          <div className="mt-3 animate-fadeIn">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{mindmapError}</p>
              </div>
              <button
                onClick={() => setMindmapError(null)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-gray-50 overflow-hidden">
        {mindmapData ? (
          <MindmapViewer
            mindmapData={mindmapData}
            apiBaseUrl={API_BASE_URL}
            getAuthToken={getAuthToken}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md px-4">
              <Network className="h-20 w-20 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                {selectedFileIds.length > 0 ? 'Ready to Generate' : 'Select Files'}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {selectedFileIds.length > 0
                  ? `Click "Generate Mindmap" to create a visual mind map for ${selectedFileIds.length} selected file(s)`
                  : 'Please select one or more processed files from the dropdown above to generate a mindmap'}
              </p>
              {selectedFiles.length > 0 && (
                <div className="mt-4 p-3 bg-white rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">Selected Files:</p>
                  {selectedFiles.map((file) => (
                    <div key={file.id} className="text-left mb-1 last:mb-0">
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolsPage;
