import React from 'react';
import { Loader2, X, Upload } from 'lucide-react';

const UploadProgressPanel = ({ batchUploads, isUploading, onClose }) => {
  if (!isUploading && (!batchUploads || batchUploads.length === 0)) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md bg-white border border-gray-200 rounded-lg shadow-lg">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Upload className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Uploading {batchUploads?.length || 0} file{batchUploads?.length !== 1 ? 's' : ''}
            </h3>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {batchUploads?.map((upload) => (
            <div key={upload.id} className="p-2 bg-gray-50 rounded-md">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-700 truncate flex-1 mr-2" title={upload.fileName}>
                  {upload.fileName}
                </span>
                <span className="text-xs font-semibold text-blue-700 min-w-[3rem] text-right">
                  {upload.progress || 0}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    upload.status === 'failed'
                      ? 'bg-red-600'
                      : upload.status === 'batch_processing' || upload.status === 'processing'
                      ? 'bg-green-600'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${upload.progress || 0}%` }}
                ></div>
              </div>
              {upload.status === 'uploading' && (
                <p className="text-xs text-gray-500 mt-1">
                  {upload.progress || 0}% uploaded
                </p>
              )}
              {upload.status === 'batch_processing' && (
                <p className="text-xs text-green-600 mt-1">
                  Processing... ({Math.round(upload.processingProgress || 0)}%)
                </p>
              )}
              {upload.status === 'failed' && upload.error && (
                <p className="text-xs text-red-600 mt-1">{upload.error}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UploadProgressPanel;






