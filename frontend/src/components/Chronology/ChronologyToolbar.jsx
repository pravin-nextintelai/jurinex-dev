import React from 'react';
import { Download, Printer } from 'lucide-react';

const ChronologyToolbar = ({
  eventCount = 0,
  dateCount = 0,
  onDownloadPdf,
  onPrint,
  downloading = false,
  disabled = false,
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50/80 print:hidden">
    <p className="text-xs text-gray-500">
      {dateCount} unique date{dateCount === 1 ? '' : 's'}
      <span className="mx-1.5 text-gray-300">·</span>
      {eventCount} event{eventCount === 1 ? '' : 's'}
    </p>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDownloadPdf}
        disabled={disabled || downloading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#21C1B6] hover:bg-[#1AA49B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        {downloading ? 'Preparing…' : 'Download PDF'}
      </button>
      <button
        type="button"
        onClick={onPrint}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Printer className="w-3.5 h-3.5" />
        Print
      </button>
    </div>
  </div>
);

export default ChronologyToolbar;
