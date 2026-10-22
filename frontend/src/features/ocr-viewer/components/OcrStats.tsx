import React from 'react';
import type { OcrJson, OcrMetadata } from '../types/ocr';

export interface OcrStatsProps {
  ocrData: OcrJson | null;
  metadata: OcrMetadata | null;
  currentPage: number;
  /** Smaller cards for toolbar placement */
  variant?: 'default' | 'compact';
}

const StatCard: React.FC<{
  label: string;
  value: string;
  compact?: boolean;
}> = ({ label, value, compact }) =>
  compact ? (
    <div className="px-1.5 py-1 bg-white border border-gray-200 rounded-md shadow-sm">
      <p className="text-[8px] uppercase tracking-wide text-gray-400 leading-tight">
        {label}
      </p>
      <p className="text-[11px] font-semibold text-gray-900 leading-tight">
        {value}
      </p>
    </div>
  ) : (
    <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );

const OcrStats: React.FC<OcrStatsProps> = ({
  ocrData,
  metadata,
  currentPage,
  variant = 'default',
}) => {
  const totalPages =
    metadata?.pageCount ?? ocrData?.pageCount ?? ocrData?.pages?.length ?? 0;

  const page =
    ocrData?.pages?.find((p) => p.page === currentPage) ??
    ocrData?.pages?.[currentPage - 1];

  const avgConfidencePage =
    page?.avgConfidence ??
    metadata?.pages?.find((p) => p.page === currentPage)?.avgConfidence ??
    metadata?.avgConfidence;

  const compact = variant === 'compact';
  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <StatCard
        label="Total Pages"
        value={totalPages ? String(totalPages) : '—'}
        compact={compact}
      />
      <StatCard
        label="Current Page"
        value={String(currentPage || 1)}
        compact={compact}
      />
      <StatCard
        label="Avg Confidence"
        value={
          typeof avgConfidencePage === 'number'
            ? `${(avgConfidencePage * 100).toFixed(1)}%`
            : '—'
        }
        compact={compact}
      />
    </div>
  );
};

export default OcrStats;

