import React, { useState } from 'react';
import type { OcrWord } from '../types/ocr';
import type { OcrConfidenceFilter } from '../hooks/useOcrDocumentViewer';

export interface OcrWordProps {
  word: OcrWord;
  confidenceFilter: OcrConfidenceFilter;
  style: React.CSSProperties;
}

const getConfidenceClass = (
  confidence: number,
  filter: OcrConfidenceFilter,
): string => {
  if (filter === 'none') {
    return 'text-gray-900';
  }
  const showBox =
    filter === 'all' ||
    (filter === 'high' && confidence >= 0.95) ||
    (filter === 'medium' && confidence >= 0.85 && confidence < 0.95) ||
    (filter === 'low' && confidence < 0.85);

  if (!showBox) {
    return 'text-gray-900';
  }
  if (confidence >= 0.95) {
    return 'border border-emerald-400 bg-transparent text-gray-900';
  }
  if (confidence >= 0.85) {
    return 'border border-amber-400 bg-transparent text-gray-900';
  }
  return 'border border-red-400 bg-transparent text-gray-900';
};

const OcrWordBox: React.FC<OcrWordProps> = ({
  word,
  confidenceFilter,
  style,
}) => {
  const [hovered, setHovered] = useState(false);
  const { bbox, confidence, text } = word;

  return (
    <div
      className={`relative flex items-center justify-center rounded-sm select-none cursor-pointer transition-colors duration-150 ${getConfidenceClass(
        confidence,
        confidenceFilter,
      )}`}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="leading-none whitespace-nowrap">{text}</span>

      {hovered && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 -top-2 -translate-y-full bg-gray-900 text-white text-[11px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
          <div className="font-semibold mb-0.5">
            Text: {text || '⟂'}
          </div>
          <div className="text-emerald-300">
            Confidence: {(confidence * 100).toFixed(1)}%
          </div>
          <div className="opacity-80">
            Position: ({bbox.x}, {bbox.y})
          </div>
          <div className="opacity-80">
            Size: {bbox.w} × {bbox.h}px
          </div>
          <div className="opacity-70">
            Language: en (1.00)
          </div>
        </div>
      )}
    </div>
  );
};

export default OcrWordBox;

