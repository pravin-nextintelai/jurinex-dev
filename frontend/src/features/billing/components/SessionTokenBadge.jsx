import React, { useState, useRef, useEffect } from 'react';
import { Zap, X, Info } from 'lucide-react';

const MODEL_PRICING_USD = {
  'gemini-2.5-flash':      { input: 0.30,  output: 2.50  },
  'gemini-2.5-pro':        { input: 2.50,  output: 15.00 },
  'gemini-2.0-flash':      { input: 0.10,  output: 0.40  },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30  },
};

const INR_RATE = 95.42;
const MAX_CONTEXT = 1_048_576;

function getPricing(modelName = '') {
  const m = String(modelName).toLowerCase();
  for (const [key, rates] of Object.entries(MODEL_PRICING_USD)) {
    if (m.includes(key.replace('gemini-', ''))) return rates;
  }
  return MODEL_PRICING_USD['gemini-2.5-flash'];
}

const fmt = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const fmtUSD = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(v || 0);
const fmtINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 3, maximumFractionDigits: 5 }).format((v || 0) * INR_RATE);

/**
 * Google AI Studio-style token count chip for non-cached sessions.
 * Shows cumulative session tokens and estimated cost on click.
 */
const SessionTokenBadge = ({ usage, modelName = 'gemini-2.5-flash', promptTokens = 0 }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const { inputTokens = 0, outputTokens = 0, totalTokens = 0 } = usage || {};
  const pendingPromptTokens = Math.max(0, promptTokens);
  const displayTotal = totalTokens + pendingPromptTokens;

  const pricing = getPricing(modelName);

  const inputCost   = (inputTokens          / 1e6) * pricing.input;
  const outputCost  = (outputTokens         / 1e6) * pricing.output;
  const pendingCost = (pendingPromptTokens  / 1e6) * pricing.input;
  const totalCost   = inputCost + outputCost + pendingCost;

  const inputPct   = Math.min(100, (inputTokens         / MAX_CONTEXT) * 100);
  const outputPct  = Math.min(100, (outputTokens        / MAX_CONTEXT) * 100);
  const pendingPct = Math.min(100, (pendingPromptTokens / MAX_CONTEXT) * 100);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!totalTokens && !pendingPromptTokens) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((s) => !s)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all shadow-sm ${
          open
            ? 'bg-[#21C1B6] text-white border-[#1AA49B]'
            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
        }`}
        title="Token usage & cost"
      >
        <Zap className="h-3 w-3" />
        <span>{fmt(displayTotal)} tokens</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] bg-slate-900 text-slate-100 rounded-xl border border-slate-800 shadow-2xl z-50 overflow-hidden origin-top-right">
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800 bg-slate-950">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#21C1B6]" />
              <span className="text-sm font-bold tracking-wide uppercase">Token Usage</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Context window progress */}
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Context Window</span>
                <span className="text-xs font-semibold text-slate-200">
                  {fmt(displayTotal)}{' '}
                  <span className="text-slate-500">/ {fmt(MAX_CONTEXT)}</span>
                </span>
              </div>

              {/* Stacked progress bar: input (teal) + pending prompt (yellow) + output (violet) */}
              <div className="w-full h-2.5 bg-slate-800 rounded-full flex overflow-hidden mb-3">
                <div
                  className="bg-[#21C1B6] h-full rounded-l-full transition-all duration-300"
                  style={{ width: `${Math.max(inputTokens > 0 ? 2 : 0, inputPct)}%` }}
                  title={`Session input: ${fmt(inputTokens)} tokens`}
                />
                <div
                  className="bg-amber-400 h-full transition-all duration-150"
                  style={{ width: `${Math.max(pendingPromptTokens > 0 ? 2 : 0, pendingPct)}%` }}
                  title={`Current prompt: ${fmt(pendingPromptTokens)} tokens`}
                />
                <div
                  className="bg-violet-400 h-full rounded-r-full transition-all duration-300"
                  style={{ width: `${Math.max(outputTokens > 0 ? 2 : 0, outputPct)}%` }}
                  title={`Output: ${fmt(outputTokens)} tokens`}
                />
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 gap-2 text-[10px] bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-[#21C1B6] inline-block" />
                    <span className="font-semibold text-[#21C1B6]">Session Input</span>
                  </div>
                  <span className="pl-3 text-slate-300 font-semibold">{fmt(inputTokens)}</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-violet-400 inline-block" />
                    <span className="font-semibold text-violet-400">Output</span>
                  </div>
                  <span className="pl-3 text-slate-300 font-semibold">{fmt(outputTokens)}</span>
                </div>
                {pendingPromptTokens > 0 && (
                  <div className="col-span-2 flex flex-col">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-amber-400 inline-block" />
                      <span className="font-semibold text-amber-400">Current prompt (typing)</span>
                    </div>
                    <span className="pl-3 text-slate-300 font-semibold">{fmt(pendingPromptTokens)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* Cost breakdown */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost Estimate</span>
                <span className="text-[10px] text-slate-500 font-mono">in Indian Rupees (₹)</span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 px-2 rounded-lg bg-slate-800/40">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] inline-block"></span>
                    <span className="text-slate-300">Session Input</span>
                  </div>
                  <span className="font-mono font-bold text-white">{fmtINR(inputCost)}</span>
                </div>

                <div className="flex justify-between items-center py-1 px-2 rounded-lg bg-slate-800/40">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block"></span>
                    <span className="text-slate-300">Output</span>
                  </div>
                  <span className="font-mono font-bold text-white">{fmtINR(outputCost)}</span>
                </div>

                {pendingPromptTokens > 0 && (
                  <div className="flex justify-between items-center py-1 px-2 rounded-lg bg-amber-900/20 border border-amber-800/30">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                      <span className="text-amber-400">Typing ({fmt(pendingPromptTokens)} tokens)</span>
                    </div>
                    <span className="font-mono font-bold text-amber-300">{fmtINR(pendingCost)}</span>
                  </div>
                )}

                <div className="flex justify-between items-center py-3 mt-1 bg-gradient-to-r from-slate-950 to-slate-900 px-3 rounded-xl border border-slate-700">
                  <span className="text-sm font-bold text-[#21C1B6] uppercase tracking-wide">Total</span>
                  <span className="text-lg font-bold text-white font-mono">{fmtINR(totalCost)}</span>
                </div>
              </div>
            </div>

            {/* Model info */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Info className="h-3 w-3" />
              <span>Model: {modelName || 'gemini-2.5-flash'} · Cumulative session usage</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(SessionTokenBadge);
