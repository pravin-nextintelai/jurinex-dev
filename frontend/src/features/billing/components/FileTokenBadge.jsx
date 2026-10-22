import React, { useState, useRef, useEffect } from 'react';
import { FileText, X, Loader2, Zap, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

const MAX_CONTEXT = 1_048_576;
const INR_RATE    = 95.42;

const PRICING = {
  'gemini-2.5-flash': { input: 0.30,  output: 2.50  },
  'gemini-2.5-pro':   { input: 2.50,  output: 15.00 },
  'gemini-2.0-flash': { input: 0.10,  output: 0.40  },
};

const MODALITY_NOTES = [
  { icon: '📄', label: 'Text / Code / CSV',  desc: '~4 characters = 1 token' },
  { icon: '📋', label: 'PDF',                desc: 'Each page = visual tile(s)' },
  { icon: '🖼️', label: 'Image',             desc: '258 tokens per tile' },
  { icon: '🎵', label: 'Audio',              desc: '32 tokens per second' },
  { icon: '🎬', label: 'Video',              desc: '263 tokens per second' },
];

function getPricing(model = '') {
  const m = String(model).toLowerCase();
  if (m.includes('pro'))       return PRICING['gemini-2.5-pro'];
  if (m.includes('2.0-flash')) return PRICING['gemini-2.0-flash'];
  return PRICING['gemini-2.5-flash'];
}

const fmt    = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const fmtINR = (v) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 4, maximumFractionDigits: 5,
  }).format((v || 0) * INR_RATE);

const pct = (n) => ((n / MAX_CONTEXT) * 100).toFixed(2);

const FileTokenBadge = ({ tokenData = null, isLoading = false, promptTokens = 0 }) => {
  const [open,      setOpen]      = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const docTokens   = tokenData?.totalTokens || 0;
  const totalTokens = docTokens + (promptTokens || 0);
  const modelName   = tokenData?.modelName || 'gemini-2.5-flash';
  const pricing     = getPricing(modelName);

  const docPct    = Math.min(100, (docTokens    / MAX_CONTEXT) * 100);
  const promptPct = Math.min(100, (promptTokens / MAX_CONTEXT) * 100);
  const usedPct   = Math.min(100, (totalTokens  / MAX_CONTEXT) * 100).toFixed(1);

  const docCost   = (docTokens    / 1e6) * pricing.input;
  const promptCost = (promptTokens / 1e6) * pricing.input;
  const totalCost  = docCost + promptCost;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-white text-gray-500 border-gray-200 shadow-sm">
        <Loader2 className="h-3 w-3 animate-spin text-[#21C1B6]" />
        <span>Counting tokens…</span>
      </div>
    );
  }

  if (!tokenData || !docTokens) return null;

  return (
    <div className="relative inline-block" ref={ref}>

      {/* ── Trigger chip ── */}
      <button
        onClick={() => setOpen(s => !s)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 shadow-sm ${
          open
            ? 'bg-[#21C1B6] text-white border-[#1AA49B] shadow-[0_0_12px_rgba(33,193,182,0.25)]'
            : 'bg-white text-gray-600 border-gray-300 hover:border-[#21C1B6]/60 hover:text-[#21C1B6] hover:shadow-md'
        }`}
        title="Document token count & cost estimate"
      >
        <FileText className="h-3 w-3" />
        <span>{fmt(totalTokens)} tokens</span>
      </button>

      {/* ── Popover ── */}
      {open && (
        <div className="absolute right-0 mt-2 w-[340px] rounded-2xl border border-gray-200 shadow-2xl z-50 overflow-hidden origin-top-right bg-white">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#21C1B6]/10 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-[#21C1B6]" />
              </div>
              <span className="text-sm font-bold text-gray-800 tracking-wide">Token Usage</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-4">

            {/* ── Context Window ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Context Window
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-xs font-bold text-gray-800 font-mono">{fmt(totalTokens)}</span>
                  <span className="text-[10px] text-gray-400 font-mono">/ {fmt(MAX_CONTEXT)}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                <div
                  className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                  style={{ width: `${Math.max(docTokens > 0 ? 2 : 0, docPct)}%`, borderRadius: promptTokens > 0 ? '0' : '9999px' }}
                />
                {promptTokens > 0 && (
                  <div
                    className="absolute top-0 h-full bg-[#21C1B6] rounded-r-full transition-all duration-300"
                    style={{ left: `${docPct}%`, width: `${Math.max(1.5, promptPct)}%` }}
                  />
                )}
              </div>
              <p className="text-right text-[10px] text-gray-400 font-mono">{usedPct}% used</p>
            </div>

            {/* ── Token stat cards ── */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Document */}
              <div className="rounded-xl p-3 border border-blue-100 bg-blue-50/60">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wide">Document</span>
                </div>
                <p className="text-2xl font-bold text-gray-900 font-mono leading-none">{fmt(docTokens)}</p>
                <p className="text-[10px] text-gray-400 mt-1">{pct(docTokens)}% of limit</p>
              </div>

              {/* Prompt */}
              <div className={`rounded-xl p-3 border transition-all ${
                promptTokens > 0
                  ? 'border-[#21C1B6]/30 bg-[#21C1B6]/5'
                  : 'border-gray-100 bg-gray-50'
              }`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`w-2 h-2 rounded-full inline-block ${promptTokens > 0 ? 'bg-[#21C1B6]' : 'bg-gray-300'}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${promptTokens > 0 ? 'text-[#17A89F]' : 'text-gray-400'}`}>
                    {promptTokens > 0 ? 'Your Prompt' : 'Prompt'}
                  </span>
                </div>
                <p className={`text-2xl font-bold font-mono leading-none ${promptTokens > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                  {fmt(promptTokens)}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {promptTokens > 0 ? `${pct(promptTokens)}% of limit` : 'Start typing…'}
                </p>
              </div>
            </div>

            {/* Total row */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-xs font-medium text-gray-500">Total tokens</span>
              <span className="text-sm font-bold text-gray-900 font-mono">{fmt(totalTokens)}</span>
            </div>

            {/* ── Divider ── */}
            <div className="border-t border-gray-100" />

            {/* ── Cost Estimate ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Input Cost Estimate
                </span>
                <span className="text-[10px] text-gray-400">in Indian Rupees (₹)</span>
              </div>

              <div className="space-y-2">
                {/* Document cost */}
                <div className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                    <span className="text-xs text-gray-600">
                      Document
                      <span className="text-gray-400 ml-1">({fmt(docTokens)} tokens)</span>
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-gray-800 font-mono">{fmtINR(docCost)}</span>
                </div>

                {/* Prompt cost */}
                {promptTokens > 0 && (
                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] inline-block" />
                      <span className="text-xs text-gray-600">
                        Prompt
                        <span className="text-gray-400 ml-1">({fmt(promptTokens)} tokens)</span>
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-[#17A89F] font-mono">{fmtINR(promptCost)}</span>
                  </div>
                )}

                {/* Total cost */}
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-gray-100">
                  <div>
                    <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Input Total</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">per request, before output</p>
                  </div>
                  <span className="text-2xl font-bold text-gray-900 font-mono">{fmtINR(totalCost)}</span>
                </div>
              </div>
            </div>

            {/* ── Divider ── */}
            <div className="border-t border-gray-100" />

            {/* ── How tokens are counted ── */}
            <div>
              <button
                onClick={() => setShowGuide(s => !s)}
                className="flex items-center gap-2 w-full text-[10px] text-gray-400 hover:text-gray-700 transition-colors group"
              >
                <Sparkles className="h-3 w-3 group-hover:text-[#21C1B6] transition-colors" />
                <span className="font-semibold uppercase tracking-wider">How tokens are counted</span>
                {showGuide
                  ? <ChevronUp   className="h-3 w-3 ml-auto" />
                  : <ChevronDown className="h-3 w-3 ml-auto" />
                }
              </button>

              {showGuide && (
                <div className="mt-2.5 rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-2">
                  {MODALITY_NOTES.map(({ icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-2.5">
                      <span className="text-sm leading-none mt-0.5">{icon}</span>
                      <div>
                        <span className="text-[11px] font-semibold text-gray-700">{label}</span>
                        <span className="text-[10px] text-gray-400"> — {desc}</span>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Token counting is{' '}
                      <span className="text-emerald-600 font-semibold">free</span>
                      {' '}— uses the{' '}
                      <code className="text-[9px] bg-gray-200 px-1.5 py-0.5 rounded text-gray-600">countTokens</code>
                      {' '}API with no billing quota.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <Zap className="h-2.5 w-2.5" />
                <span>{modelName}</span>
              </div>
              <span className="text-[10px] text-gray-400">{fmt(MAX_CONTEXT)} token limit</span>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default FileTokenBadge;
