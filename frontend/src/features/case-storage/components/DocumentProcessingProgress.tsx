import React from 'react';
import { Loader2, CheckCircle2, Upload, FileText, Grid3x3, Database } from 'lucide-react';

interface ProcessingStage {
  name: string;
  weight: number;
  statusKeyword: string[];
  icon: React.ComponentType<{ className?: string }>;
}

interface DocumentProcessingProgressProps {
  document: {
    id: string;
    name: string;
  };
  status: string;
  progress: number;
  currentOperation: string;
}

const PROCESSING_STAGES: ProcessingStage[] = [
  {
    name: 'Initializing & Uploading Document',
    weight: 15,
    statusKeyword: [
      'batch_queued', 'starting batch document processing', 'processing job created',
      'uploading document to cloud storage', 'document uploaded successfully',
      'queued for batch processing', 'pending'
    ],
    icon: Upload
  },
  {
    name: 'Extracting Text (OCR)',
    weight: 30,
    statusKeyword: [
      'batch_processing', 'initializing batch document ai operation', 'batch processing initiated',
      'batch ocr processing in progress', 'fetching batch results from storage',
      'validating extracted text quality', 'batch ocr near completion'
    ],
    icon: FileText
  },
  {
    name: 'Chunking Content',
    weight: 13,
    statusKeyword: [
      'processing', 'fetching chunking configuration', 'configuration loaded',
      'initializing chunking', 'chunking completed', 'chunking document',
      'batch ocr completed. starting post-processing', 'fetching chunking configuration', 'chunking document'
    ],
    icon: Grid3x3
  },
  {
    name: 'Generating Embeddings & Storing Data',
    weight: 30,
    statusKeyword: [
      'processing', 'preparing chunks for embedding generation', 'all embeddings generated successfully',
      'preparing data for database storage', 'chunks saved successfully',
      'preparing vector embeddings for storage', 'vector embeddings stored successfully',
      'generating embeddings', 'storing data in database'
    ],
    icon: Database
  },
  {
    name: 'Generating Summary & Finalizing',
    weight: 12,
    statusKeyword: [
      'processing', 'processed', 'preparing document content for summarization',
      'generating ai-powered document summary', 'summary generated and saved successfully',
      'summary generation skipped', 'updating document metadata',
      'document processing completed successfully', 'finalizing document processing', 'completed'
    ],
    icon: CheckCircle2
  }
];

const DocumentProcessingProgress: React.FC<DocumentProcessingProgressProps> = ({
  document,
  status,
  progress,
  currentOperation,
}) => {

  const getCurrentStageIndex = (currentStatus: string, currentOperation: string): number => {
    const lowerCaseStatus = currentStatus.toLowerCase();
    const lowerCaseOperation = currentOperation.toLowerCase();

    if (lowerCaseStatus === 'processed' || lowerCaseOperation === 'completed') {
      return PROCESSING_STAGES.length;
    }
    if (lowerCaseStatus === 'error' || lowerCaseOperation === 'failed') {
      return -2;
    }

    if (['pending', 'queued', 'unknown'].some(s => lowerCaseStatus.includes(s)) || lowerCaseOperation === 'queued' || lowerCaseOperation === 'pending') {
      return -1;
    }

    for (let i = 0; i < PROCESSING_STAGES.length; i++) {
      const stage = PROCESSING_STAGES[i];
      const isCurrentStage = stage.statusKeyword.some(keyword =>
        lowerCaseStatus.includes(keyword.toLowerCase()) || lowerCaseOperation.includes(keyword.toLowerCase())
      );

      if (isCurrentStage) {
        return i;
      }
    }
    
    return -1;
  };

  const currentStageIndex = getCurrentStageIndex(status, currentOperation);
  const isComplete = currentStageIndex === PROCESSING_STAGES.length;
  const isError = currentStageIndex === -2;

  const overallProgress = isError ? 0 : progress;

  const getStageStatus = (stageIndex: number): 'complete' | 'active' | 'pending' | 'error' => {
    if (isError) return 'error';
    if (stageIndex < currentStageIndex) return 'complete';
    if (stageIndex === currentStageIndex) return 'active';
    return 'pending';
  };

  const getActiveStageProgress = (): number => {
    if (isComplete || isError || currentStageIndex === -1) return 0;

    let completedWeight = 0;
    for (let i = 0; i < currentStageIndex; i++) {
      completedWeight += PROCESSING_STAGES[i].weight;
    }

    const currentStageWeight = PROCESSING_STAGES[currentStageIndex]?.weight || 0;
    if (currentStageWeight === 0) return 0;

    const progressInCurrentStage = overallProgress - completedWeight;
    return Math.min(100, Math.max(0, (progressInCurrentStage / currentStageWeight) * 100));
  };

  const activeStageProgress = getActiveStageProgress();

  return (
    <div className="flex flex-col space-y-2 py-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : isError ? (
            <span className="text-red-500 text-lg leading-none flex-shrink-0">❌</span>
          ) : (
            <Loader2 className="w-4 h-4 text-[#21C1B6] animate-spin flex-shrink-0" />
          )}
          <span className="text-xs text-gray-500 truncate">
            {isComplete ? 'Processing complete' : isError ? `Failed: ${currentOperation}` : currentOperation}
          </span>
        </div>
        <span className="text-xs font-semibold text-[#21C1B6] whitespace-nowrap ml-2">
          {Math.round(overallProgress)}%
        </span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${isError ? 'bg-red-500' : 'bg-gradient-to-r from-[#21C1B6] to-[#1AA49B]'} transition-all duration-300 ease-out`}
          style={{ width: `${overallProgress}%` }}
        />
      </div>
    </div>
  );
};

export default DocumentProcessingProgress;