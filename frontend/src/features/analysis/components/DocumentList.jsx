import React from 'react';
import { FileText, Music } from 'lucide-react';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.flac', '.ogg', '.opus', '.webm', '.m4a', '.aac', '.amr']);
const isAudioFile = (name = '') => {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  return AUDIO_EXTENSIONS.has(ext);
};

const DocumentList = ({
  uploadedDocuments,
  fileId,
  setFileId,
  setDocumentData,
  setProcessingStatus,
  setProgressPercentage,
  startProcessingStatusPolling,
  formatFileSize,
  getStatusDisplayText,
  getStageColor,
  onProgressBarClick,
}) => {
  if (!uploadedDocuments || uploadedDocuments.length === 0) {
    return null;
  }

  return (
    <div className="px-3 py-2 border-b border-gray-200 bg-[#E0F7F6]">
      <h3 className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center">
        <FileText className="h-3 w-3 mr-1" />
        Files ({uploadedDocuments.length})
      </h3>
      <div className="space-y-1.5 max-h-24 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
        {uploadedDocuments.map((doc) => (
          <div
            key={doc.id}
            onClick={() => {
              setFileId(doc.id);
              setDocumentData({
                id: doc.id,
                title: doc.fileName,
                originalName: doc.fileName,
                size: doc.fileSize,
                type: 'unknown',
                uploadedAt: doc.uploadedAt,
                status: doc.status,
                processingProgress: doc.processingProgress,
                currentOperation: doc.currentOperation,
              });
              setProcessingStatus({
                status: doc.status,
                processing_progress: doc.processingProgress,
                current_operation: doc.currentOperation,
                chunk_count: doc.chunkCount,
              });
              setProgressPercentage(doc.processingProgress || 0);
              if (doc.status !== 'processed') {
                startProcessingStatusPolling(doc.id);
              }
              if (onProgressBarClick) {
                onProgressBarClick();
              }
            }}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              fileId === doc.id ? 'bg-[#E0F7F6] border border-[#21C1B6]' : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 flex items-start gap-1.5">
                {isAudioFile(doc.fileName) ? (
                  <Music className="h-3 w-3 mt-0.5 text-[#21C1B6] flex-shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 mt-0.5 text-gray-400 flex-shrink-0" />
                )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{doc.fileName}</p>
                <p className="text-xs text-gray-500">{formatFileSize(doc.fileSize)}</p>
                {(doc.status === 'processing' || doc.status === 'batch_processing') && (
                  <>
                    <p className="text-xs text-[#21C1B6] mt-1 truncate font-medium">
                      {doc.currentOperation} ({Math.round(doc.processingProgress || 0)}%)
                    </p>
                    <div 
                      className="w-full bg-gray-200 rounded-full h-1 mt-1 relative overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onProgressBarClick) {
                          onProgressBarClick();
                        }
                      }}
                      title="Click to view detailed progress"
                    >
                      <div
                        className={`h-1 rounded-full transition-all duration-300 bg-gradient-to-r ${getStageColor(
                          doc.processingProgress || 0
                        )}`}
                        style={{ width: `${doc.processingProgress || 0}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              </div>
              <div
                className={`ml-1.5 px-1 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                  doc.status === 'processed' && (doc.processingProgress || 0) >= 100
                    ? 'bg-green-100 text-green-800'
                    : doc.status === 'processing' || doc.status === 'batch_processing'
                    ? 'bg-[#E0F7F6] text-[#21C1B6]'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {getStatusDisplayText(doc.status, doc.processingProgress || 0)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentList;






