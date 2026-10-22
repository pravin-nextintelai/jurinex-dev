import React from 'react';
import { X, Check, Loader2, FileText } from 'lucide-react';

const PROGRESS_STAGES = {
  INIT: { range: [0, 15], label: 'Initialization', description: 'Starting document processing...' },
  EXTRACT: { range: [15, 45], label: 'Text Extraction', description: 'Extracting text and content from document...' },
  CHUNK: { range: [45, 62], label: 'Chunking', description: 'Breaking document into manageable sections...' },
  EMBED: { range: [62, 78], label: 'Embeddings', description: 'Creating semantic embeddings for search...' },
  STORE: { range: [78, 90], label: 'Database Storage', description: 'Storing processed data in database...' },
  SUMMARY: { range: [90, 95], label: 'Summary Generation', description: 'Generating document summary...' },
  FINAL: { range: [95, 100], label: 'Finalization', description: 'Completing processing and optimization...' },
};

const getStageStatus = (stageKey, progress) => {
  const stage = PROGRESS_STAGES[stageKey];
  if (progress >= stage.range[1]) return 'completed';
  if (progress >= stage.range[0] && progress < stage.range[1]) return 'active';
  return 'pending';
};

const ProgressStagesPopup = ({ 
  isOpen, 
  onClose, 
  processingStatus, 
  progressPercentage = 0,
  documentName = 'Document' 
}) => {
  if (!isOpen) return null;

  const progress = progressPercentage || processingStatus?.processing_progress || 0;
  const isError = processingStatus?.status === 'error';
  const isProcessing = processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing';

  return (
    <div className="mt-3 bg-white rounded-lg border border-gray-200 shadow-lg max-w-md w-full max-h-[400px] overflow-y-auto">
      <div className="flex items-center justify-between p-2 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          {isError ? (
            <div className="p-1.5 bg-red-100 rounded-full">
              <X className="h-4 w-4 text-red-600" />
            </div>
          ) : isProcessing ? (
            <div className="p-1.5 bg-blue-100 rounded-full">
              <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
            </div>
          ) : (
            <div className="p-1.5 bg-green-100 rounded-full">
              <Check className="h-4 w-4 text-green-600" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Processing Status</h3>
            <p className="text-xs text-gray-500 truncate max-w-xs" title={documentName}>
              {documentName}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isError && (
        <div className="p-2">
          <div className="p-2 bg-red-50 rounded border border-red-200">
            <p className="text-red-800 text-xs font-medium">Processing Failed</p>
            <p className="text-red-700 text-xs mt-0.5">
              {(typeof processingStatus?.job_error === 'string' ? processingStatus.job_error : null) || 'An error occurred during processing'}
            </p>
          </div>
        </div>
      )}

      {!isError && (
        <div className="p-2">
          <div className="flex items-center space-x-1.5 mb-2">
            <FileText className="h-3 w-3 text-gray-600" />
            <h4 className="text-xs font-semibold text-gray-900">Processing Stages</h4>
          </div>
          
          <div className="space-y-1">
            {Object.entries(PROGRESS_STAGES).map(([key, { label, description }], index) => {
              const status = getStageStatus(key, progress);

              return (
                <div
                  key={key}
                  className={`flex items-center space-x-2 p-1.5 rounded border transition-all ${
                    status === 'completed'
                      ? 'bg-green-50 border-green-200'
                      : status === 'active'
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex-shrink-0">
                    {status === 'completed' ? (
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      </div>
                    ) : status === 'active' ? (
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                        <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <span className="text-xs font-medium text-gray-500">{index + 1}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h5 className={`text-xs font-medium ${
                      status === 'completed'
                        ? 'text-green-900'
                        : status === 'active'
                        ? 'text-blue-900'
                        : 'text-gray-700'
                    }`}>
                      {label}
                    </h5>
                    <p className={`text-[10px] mt-0.5 ${
                      status === 'completed'
                        ? 'text-green-700'
                        : status === 'active'
                        ? 'text-blue-700'
                        : 'text-gray-500'
                    }`}>
                      {description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProgressStagesPopup;
