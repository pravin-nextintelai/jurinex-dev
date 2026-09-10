import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTokenQuota } from '../context/TokenQuotaContext';
import {
  CreditCard, TrendingUp, Download, Settings, AlertCircle,
  RefreshCw, Cpu, CheckCircle, Zap, HardDrive, FileText,
  FileOutput, ArrowUpRight, Calendar, Coins, ChevronRight,
  BarChart3, Receipt, Clock, Database, Activity, Layers,
  Shield, Star, AlertTriangle, Package, Plus,
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { USER_RESOURCES_SERVICE_URL, PAYMENT_SERVICE_URL, CHAT_MODEL_BASE_URL } from '../config/apiConfig';
import LLMUsageComponent from '../components/LLMUsageComponent';
import TokenTopupModal from '../components/TokenTopupModal';
import StorageAddonModal from '../components/StorageAddonModal';
import { getPlanDisplayName } from '../utils/planUtils';
import { SUBSCRIPTION_PLANS_PATH } from '../utils/planUpgrade';
import jurinexLogoUrl from '../assets/jurinex-wordmark.png';
import {
  buildProformaBillingHtml,
  getDefaultCompanyLines,
  getCustomerLinesFromUserInfo,
} from '../utils/billingProformaTemplate';

// ─── API ─────────────────────────────────────────────────────────────────────

const apiFetch = async (url) => {
  const token = localStorage.getItem('token');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtCurrency = (amount, currency = 'INR') => {
  if (amount == null || isNaN(amount)) return '—';
  let n = parseFloat(amount);
  if (n > 1000 && !String(amount).includes('.')) n /= 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
};

const fmtNum = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-IN') : '—';

const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};

const fmtBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0)} ${u[i]}`;
};

const fmtGb = (gb) => fmtBytes((gb || 0) * 1024 ** 3);

const clampPct = (used, limit) => {
  if (!limit || limit <= 0) return 0;
  return Math.min((Number(used) / Number(limit)) * 100, 100);
};

const overflowPct = (used, limit) => {
  if (!limit || limit <= 0) return 0;
  return (Number(used) / Number(limit)) * 100;
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const getBarTheme = (pctValue) => {
  if (pctValue >= 100) return { bar: '#ef4444', bg: '#fee2e2', text: 'text-red-600',   label: 'Exceeded'   };
  if (pctValue >= 90)  return { bar: '#f97316', bg: '#ffedd5', text: 'text-orange-600', label: 'Critical'   };
  if (pctValue >= 70)  return { bar: '#f59e0b', bg: '#fef3c7', text: 'text-amber-600',  label: 'High'       };
  return                      { bar: '#14b8a6', bg: '#f0fdfa', text: 'text-teal-600',   label: 'Healthy'    };
};

const statusColor = (status) => {
  if (status === 'active') return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (status === 'inactive' || status === 'expired') return 'text-red-600 bg-red-50 border-red-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
};

const txStatusTheme = (s) => {
  if (s === 'captured' || s === 'completed' || s === 'paid') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (s === 'pending') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
};

// ─── Micro UI ─────────────────────────────────────────────────────────────────

function Pill({ children, theme }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${theme}`}>
      {children}
    </span>
  );
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, title, subtitle, right, color = 'teal' }) {
  const iconBg = {
    teal:   'bg-teal-50   text-teal-600',
    indigo: 'bg-teal-50 text-[#21C1B6]',
    amber:  'bg-amber-50  text-amber-600',
    green:  'bg-green-50  text-green-600',
  }[color] || 'bg-gray-50 text-gray-500';

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          {Icon && <Icon size={16} />}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

function MetricCell({ label, value, sub, valueClass = 'text-slate-900', dimLabel = false }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`text-xs font-medium uppercase tracking-wide ${dimLabel ? 'text-slate-300' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-xl font-bold leading-tight ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 leading-tight">{sub}</p>}
    </div>
  );
}

/** Visual usage gauge — circular arc + stats grid + mini bar */
function UsageMeter({ label, used, limit, showOverflow = true }) {
  if (!limit || limit <= 0) {
    return (
      <div className="flex items-center gap-4 px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
        <div className="relative flex-shrink-0" style={{ width: 68, height: 68 }}>
          <svg viewBox="0 0 36 36" width="68" height="68" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-extrabold text-slate-300">∞</span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-1">{label}</p>
          <p className="text-sm font-bold text-slate-800">
            {fmtNum(used)}<span className="text-xs font-normal text-slate-400 ml-1">tokens used</span>
          </p>
          <p className="text-xs text-teal-600 font-medium mt-0.5">Unlimited</p>
        </div>
      </div>
    );
  }

  const rawPct    = overflowPct(used, limit);
  const cappedPct = Math.min(rawPct, 100);
  const exceeded  = rawPct > 100;
  const theme     = getBarTheme(rawPct);

  const r    = 14;
  const circ = 2 * Math.PI * r;
  const dash = (cappedPct / 100) * circ;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: exceeded ? '#fecaca' : '#e2e8f0' }}>
      <div className="flex items-center gap-5 px-4 py-4" style={{ background: exceeded ? '#fff5f5' : '#f8fafc' }}>

        {/* Circular arc gauge */}
        <div className="relative flex-shrink-0" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 36 36" width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
            <circle
              cx="18" cy="18" r={r} fill="none"
              stroke={theme.bar} strokeWidth="3.5"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.7s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs font-extrabold leading-none" style={{ color: theme.bar }}>
              {cappedPct < 1 ? '<1' : Math.round(cappedPct)}%
            </span>
            {exceeded && <span className="text-[8px] font-bold mt-0.5" style={{ color: theme.bar }}>OVER</span>}
          </div>
        </div>

        {/* Label + stats + mini bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-700">{label}</span>
            {exceeded && showOverflow && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                {Math.round(rawPct).toLocaleString()}% over limit
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-x-3 mb-3">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-medium">Used</p>
              <p className="text-sm font-bold text-slate-800">{fmtNum(used)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-medium">Limit</p>
              <p className="text-sm font-bold text-slate-800">{fmtNum(limit)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-medium">{exceeded ? 'Overage' : 'Left'}</p>
              <p className={`text-sm font-bold ${exceeded ? 'text-red-500' : 'text-teal-600'}`}>
                {exceeded ? `+${fmtNum(used - limit)}` : fmtNum(Math.max(0, limit - used))}
              </p>
            </div>
          </div>
          {/* Mini accent bar */}
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: theme.bg }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${cappedPct}%`, background: theme.bar }}
            />
          </div>
        </div>
      </div>

      {/* Exceeded footer */}
      {exceeded && (
        <div className="px-4 py-2.5 border-t border-red-100 bg-red-50 flex items-center gap-2">
          <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-500 font-medium">
            {fmtNum(used - limit)} over limit · upgrade or buy credits
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Storage Tab ─────────────────────────────────────────────────────────────

/** SVG donut ring gauge. */
function StorageRing({ pct = 0, color = '#14b8a6', size = 88 }) {
  const r    = 15;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#f1f5f9" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black leading-none" style={{ color }}>
          {pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%
        </span>
        <span className="text-[9px] text-slate-400 mt-0.5">used</span>
      </div>
    </div>
  );
}

/** Friendly storage category row — plain English, no jargon. */
function StorageRow({ icon: Icon, label, desc, bytes, color, badge, subRows = [] }) {
  const isEmpty = bytes === 0;
  return (
    <div className={`rounded-xl border transition-colors ${isEmpty ? 'border-slate-100 bg-slate-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-4 px-4 py-3.5">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isEmpty ? '#f8fafc' : `${color}12`, border: `1.5px solid ${isEmpty ? '#e2e8f0' : color}22` }}>
          <Icon size={18} style={{ color: isEmpty ? '#94a3b8' : color }} />
        </div>

        {/* Label + desc */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-sm font-semibold ${isEmpty ? 'text-slate-400' : 'text-slate-800'}`}>{label}</span>
            {badge && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{badge}</span>}
          </div>
          <p className="text-xs text-slate-400 leading-none">{desc}</p>
        </div>

        {/* Size */}
        <div className="text-right flex-shrink-0">
          <p className={`text-base font-bold ${isEmpty ? 'text-slate-300' : 'text-slate-800'}`}>{fmtBytes(bytes)}</p>
          {isEmpty && <p className="text-[10px] text-slate-300">Nothing yet</p>}
        </div>
      </div>

      {/* Progress bar — only when non-zero */}
      {!isEmpty && (
        <div className="mx-4 mb-3">
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(subRows.sharePct ?? 0, 4)}%`, backgroundColor: color }} />
          </div>
        </div>
      )}

      {/* Sub-rows (file source breakdown) */}
      {subRows.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg overflow-hidden border border-slate-100 divide-y divide-slate-50">
          {subRows.map(s => (
            <div key={s.label} className="flex items-center gap-3 px-3 py-2 bg-slate-50/60">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-slate-600 flex-1">{s.label}</span>
              <span className="text-[11px] text-slate-400">{fmtNum(s.count)} files</span>
              <span className="text-xs font-semibold text-slate-700 ml-4">{fmtBytes(s.bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Professional, non-technical Storage tab. */
function StorageTab({ data, onRefresh, onUpgrade }) {
  const {
    filesBytes      = 0,
    chatBytes       = 0,
    embeddingBytes  = 0,
    draftBytes      = 0,
    citationBytes   = 0,
    totalBytes      = 0,
    counts          = {},
    limitBytes      = null,
    usagePct        = null,
    filesByService  = null,
  } = data;

  const limitBytesNum = limitBytes ? Number(limitBytes) : null;
  const planPct       = usagePct ?? (limitBytesNum > 0 ? (totalBytes / limitBytesNum) * 100 : null);
  const isExceeded    = planPct !== null && planPct >= 100;
  const isWarning     = planPct !== null && planPct >= 80 && !isExceeded;
  const availBytes    = limitBytesNum > 0 ? Math.max(0, limitBytesNum - totalBytes) : null;
  const ringColor     = isExceeded ? '#ef4444' : isWarning ? '#f97316' : '#14b8a6';

  // % of total for each category bar
  const totalAll = totalBytes || 1;
  const pctOf    = (b) => (b / totalAll) * 100;

  // Friendly per-service source labels
  const fileSources = filesByService ? [
    { label: 'Chat uploads',      color: '#14b8a6', bytes: filesByService.chatModel?.bytes    ?? 0, count: filesByService.chatModel?.count    ?? 0 },
    { label: 'Case documents',    color: '#6366f1', bytes: filesByService.docService?.bytes   ?? 0, count: filesByService.docService?.count   ?? 0 },
    { label: 'Draft attachments', color: '#8b5cf6', bytes: filesByService.draftService?.bytes ?? 0, count: filesByService.draftService?.count ?? 0 },
    { label: 'Other uploads',     color: '#94a3b8', bytes: filesByService.other?.bytes        ?? 0, count: filesByService.other?.count        ?? 0 },
  ].filter(s => s.bytes > 0 || s.count > 0) : [];

  // Status label
  const statusLabel = isExceeded ? 'Storage Full'
    : isWarning      ? 'Almost Full'
    : planPct !== null ? 'Healthy'
    : 'Active';
  const statusTheme = isExceeded ? 'bg-red-50 text-red-600 border-red-200'
    : isWarning      ? 'bg-amber-50 text-amber-600 border-amber-200'
    : 'bg-emerald-50 text-emerald-600 border-emerald-200';

  const categories = [
    {
      icon: FileText, label: 'Documents', color: '#14b8a6',
      desc: `${fmtNum(counts.files ?? 0)} file${(counts.files ?? 0) !== 1 ? 's' : ''} uploaded for analysis`,
      bytes: filesBytes, subRows: fileSources,
      sharePct: pctOf(filesBytes),
    },
    {
      icon: Layers, label: 'Conversations', color: '#6366f1',
      desc: `${fmtNum(counts.chats ?? 0)} chat session${(counts.chats ?? 0) !== 1 ? 's' : ''} saved`,
      bytes: chatBytes, subRows: [],
      sharePct: pctOf(chatBytes),
    },
    {
      icon: Database, label: 'Smart Search Index', color: '#f59e0b',
      desc: `AI search data for ${fmtNum(counts.embeddings ?? 0)} document section${(counts.embeddings ?? 0) !== 1 ? 's' : ''}`,
      bytes: embeddingBytes, subRows: [],
      sharePct: pctOf(embeddingBytes),
    },
    {
      icon: FileOutput, label: 'Generated Drafts', color: '#8b5cf6',
      desc: `${fmtNum(counts.drafts ?? 0)} legal document${(counts.drafts ?? 0) !== 1 ? 's' : ''} created`,
      bytes: draftBytes, subRows: [],
      sharePct: pctOf(draftBytes),
    },
    {
      icon: Star, label: 'Legal Research', color: '#0ea5e9',
      desc: `${fmtNum(counts.citations ?? 0)} citation report${(counts.citations ?? 0) !== 1 ? 's' : ''} saved`,
      bytes: citationBytes, subRows: [],
      sharePct: pctOf(citationBytes),
    },
  ];

  return (
    <div className="space-y-4">

      {/* ── Blocked banner ──────────────────────────────────── */}
      {isExceeded && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-700">You've run out of storage space</p>
            <p className="text-xs text-red-500 mt-1">
              Your plan allows {fmtBytes(limitBytesNum)} of storage and you've used it all.
              You won't be able to upload new files until you free up space or upgrade.
            </p>
          </div>
          <button onClick={onUpgrade}
            className="flex-shrink-0 flex items-center gap-1.5 h-8 px-4 text-xs font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors">
            Upgrade Plan <ArrowUpRight size={12} />
          </button>
        </div>
      )}
      {isWarning && !isExceeded && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3.5">
          <AlertTriangle size={15} className="text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-700">Storage is getting full</p>
            <p className="text-xs text-amber-600 mt-0.5">You've used {Math.round(planPct)}% of your plan. Only {fmtBytes(availBytes)} remaining.</p>
          </div>
          <button onClick={onUpgrade}
            className="flex-shrink-0 text-xs font-bold text-amber-700 border border-amber-300 bg-white rounded-xl px-3 h-8 hover:bg-amber-50 transition-colors">
            Upgrade
          </button>
        </div>
      )}

      {/* ── Header card: summary + plan bar ─────────────────── */}
      <Card>
        <div className="p-5">
          <div className="flex items-start gap-5">

            {/* Donut */}
            <StorageRing pct={planPct ?? 0} color={ringColor} size={88} />

            {/* Centre: total + free */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-2xl font-black text-slate-900 leading-none">{fmtBytes(totalBytes)}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusTheme}`}>{statusLabel}</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                {limitBytesNum
                  ? <>of <strong className="text-slate-600">{fmtBytes(limitBytesNum)}</strong> plan limit used</>
                  : 'total storage across all features'}
              </p>

              {/* Plan bar */}
              {limitBytesNum > 0 && (
                <div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(planPct ?? 0, 100)}%`, background: ringColor }} />
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-400">{fmtBytes(totalBytes)} used</span>
                    <span className={isExceeded ? 'text-red-500 font-semibold' : 'text-teal-600 font-medium'}>
                      {isExceeded ? 'No space left' : `${fmtBytes(availBytes)} free`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: refresh + upgrade */}
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button onClick={onRefresh}
                className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
                <RefreshCw size={11} /> Refresh
              </button>
              {!isExceeded && limitBytesNum > 0 && (
                <button onClick={onUpgrade}
                  className="flex items-center gap-1 h-8 px-3 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-xl hover:bg-teal-100 transition-colors">
                  <ArrowUpRight size={11} /> Upgrade
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ── "What's using space?" section ───────────────────── */}
      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">
          What's using your storage?
        </h3>
        <div className="space-y-2">
          {categories.map((cat) => (
            <StorageRow key={cat.label} {...cat} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview',      icon: BarChart3 },
  { id: 'addons',   label: 'Plans & Add-Ons', icon: Package  },
  { id: 'history',  label: 'Payments',      icon: Receipt   },
];

// ─── Usage + Storage simple panel ────────────────────────────────────────────

function UsageStorageCard({ tokenData, monthlyUsed, monthlyLimit, planLeft, topupBal, storageData, onBuyTokens, onUpgrade, onRefreshStorage }) {
  // ── Token calc ───────────────────────────────────────────────────────────────
  // Shared traffic-light scale: green while low, yellow above half, red near full.
  const usageBarColor = (pct) => (pct < 50 ? '#22c55e' : pct < 85 ? '#eab308' : '#ef4444');
  // Remaining (unfilled) portion: light tint of the same color.
  const usageTrackColor = (pct) => (pct < 50 ? '#dcfce7' : pct < 85 ? '#fef9c3' : '#fee2e2');

  const tokRawPct    = monthlyLimit > 0 ? (monthlyUsed / monthlyLimit) * 100 : 0;
  const tokCappedPct = Math.min(tokRawPct, 100);
  const tokExhausted = planLeft + topupBal === 0;
  const tokBarColor  = usageBarColor(tokRawPct);

  // ── Storage calc ─────────────────────────────────────────────────────────────
  const {
    totalBytes    = 0,
    limitBytes    = null,
    usagePct      = null,
    filesBytes    = 0,
    chatBytes     = 0,
    embeddingBytes= 0,
    draftBytes    = 0,
    citationBytes = 0,
  } = storageData || {};
  const limitBytesNum = limitBytes ? Number(limitBytes) : null;
  const storagePct    = usagePct ?? (limitBytesNum > 0 ? (totalBytes / limitBytesNum) * 100 : null);
  const storExceeded  = storagePct !== null && storagePct >= 100;
  const storBarColor  = usageBarColor(storagePct ?? 0);
  const availBytes    = limitBytesNum > 0 ? Math.max(0, limitBytesNum - totalBytes) : null;

  return (
    <Card className="px-6 py-5 space-y-4">

      {/* ── Section heading ─────────────────────────────────────────────────── */}
      <p className="text-sm font-bold text-slate-800">Plan usage limits</p>

      {/* ── Token Usage ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* Label */}
        <div className="w-48 shrink-0">
          <p className="text-sm font-semibold text-slate-800">Token usage</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {fmtNum(monthlyUsed)} of {monthlyLimit > 0 ? fmtNum(monthlyLimit) : '∞'} used
          </p>
        </div>
        {/* Bar */}
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: usageTrackColor(tokRawPct) }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${tokCappedPct}%`, backgroundColor: tokBarColor }} />
        </div>
        {/* Stats */}
        <div className="flex items-center shrink-0">
          <span className={`text-sm font-semibold ${tokExhausted ? 'text-red-500' : 'text-slate-600'}`}>
            {tokCappedPct < 1 ? '<1' : Math.round(tokCappedPct)}% used
          </span>
        </div>
      </div>

      {/* ── Storage ─────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex items-center gap-4">
          {/* Label */}
          <div className="w-48 shrink-0">
            <p className="text-sm font-semibold text-slate-800">Storage</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {fmtBytes(totalBytes)}{limitBytesNum ? ` of ${fmtBytes(limitBytesNum)}` : ''}
              {!storExceeded && availBytes != null && ` · ${fmtBytes(availBytes)} free`}
            </p>
          </div>
          {/* Bar */}
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: usageTrackColor(storagePct ?? 0) }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(storagePct ?? 0, 100)}%`, backgroundColor: storBarColor }} />
          </div>
          {/* Stats */}
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-sm font-semibold ${storExceeded ? 'text-red-500' : 'text-slate-600'}`}>
              {storagePct != null ? (storagePct < 1 ? '<1' : Math.round(storagePct)) : '—'}% used
            </span>
            <div className="flex items-center gap-2">
              {storExceeded && (
                <button onClick={onUpgrade}
                  className="text-xs font-semibold text-teal-600 hover:text-teal-700 underline underline-offset-2">
                  Upgrade
                </button>
              )}
              <button onClick={onRefreshStorage} className="text-slate-400 hover:text-slate-600 transition-colors">
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
        </div>
        {storExceeded && (
          <p className="text-xs text-red-500 pl-52">Storage full — upgrade or free up space to upload files.</p>
        )}
      </div>

    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingAndUsagePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { quotaStatus, refreshQuota } = useTokenQuota();

  const [tab, setTab]             = useState('overview');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [banner, setBanner]       = useState(
    location.state?.planActivated ? `${location.state.planActivated} plan activated!` : null
  );
  const [planData, setPlanData]   = useState(null);
  const [sub, setSub]             = useState(null);
  const [transactions, setTx]       = useState([]);
  const [latestPay, setLatestPay]   = useState(null);
  const [loadingTx, setLoadingTx]   = useState(false);
  const [topupHistory, setTopupHistory] = useState([]);
  const [loadingTopupHist, setLoadingTopupHist] = useState(false);
  const [tokenData, setTokenData]       = useState(null);
  const [loadingTok, setLoadingTok]     = useState(false);
  const [storageData, setStorageData]   = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [refresh, setRefresh]           = useState(0);
  const [showTopup, setShowTopup]                 = useState(false);
  const [showStorageAddon, setShowStorageAddon]   = useState(false);
  const [storageAddonHistory, setStorageAddonHistory] = useState([]);
  const [loadingStorageAddonHist, setLoadingStorageAddonHist] = useState(false);
  const prevTopupRef              = useRef(null);

  useEffect(() => {
    if (!quotaStatus) return;
    const bal = quotaStatus.topup_token_balance ?? 0;
    if (prevTopupRef.current !== null && prevTopupRef.current !== bal) {
      setTokenData(p => p ? { ...p, ...quotaStatus } : quotaStatus);
      setRefresh(p => p + 1);
    }
    prevTopupRef.current = bal;
  }, [quotaStatus]);

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchPlan = async () => {
    setError(null);
    const data = await apiFetch(`${USER_RESOURCES_SERVICE_URL}/plan-details`);
    setPlanData(data);
    const ap = data.activePlan || data.userSubscription;
    if (ap) {
      const s = { ...ap,
        plan_name: ap.plan_name || ap.planName || ap.name,
        status: ap.subscription_status || ap.status,
      };
      setSub(s);
      try {
        const ui = JSON.parse(localStorage.getItem('userInfo') || '{}');
        ui.plan = getPlanDisplayName(s) || s.plan_name;
        localStorage.setItem('userInfo', JSON.stringify(ui));
        window.dispatchEvent(new CustomEvent('userInfoUpdated'));
      } catch (_) {}
    }
    const pay = data.latestPayment;
    if (pay) setLatestPay(pay);
  };

  const fetchTx = async () => {
    setLoadingTx(true);
    try {
      const data = await apiFetch(`${PAYMENT_SERVICE_URL}/api/payments/history`);
      const arr = data.data || data.payments || (Array.isArray(data) ? data : []);
      setTx(arr.map((t, i) => ({ id: t.id || `tx-${i}`, ...t,
        payment_status: t.payment_status || t.status,
        payment_date: t.payment_date || t.created_at,
        plan_name: t.plan_name || t.description || 'Subscription',
      })));
    } catch (_) { setTx([]); }
    finally { setLoadingTx(false); }
  };

  const fetchTopupHistory = async () => {
    setLoadingTopupHist(true);
    try {
      const data = await apiFetch(`${PAYMENT_SERVICE_URL}/api/payments/topup/history`);
      setTopupHistory(data.data || []);
    } catch (_) { setTopupHistory([]); }
    finally { setLoadingTopupHist(false); }
  };

  const fetchStorageAddonHistory = async () => {
    setLoadingStorageAddonHist(true);
    try {
      const data = await apiFetch(`${PAYMENT_SERVICE_URL}/api/payments/storage-addon/history`);
      setStorageAddonHistory(data.data || []);
    } catch (_) { setStorageAddonHistory([]); }
    finally { setLoadingStorageAddonHist(false); }
  };

  const fetchToken = async () => {
    setLoadingTok(true);
    try {
      const res = await apiFetch(`${PAYMENT_SERVICE_URL}/api/payments/token-quota-status`);
      const d = res?.data || res;
      setTokenData(d?.tokens_used_today !== undefined ? d : null);
    } catch (_) { setTokenData(null); }
    finally { setLoadingTok(false); }
  };

  const fetchStorage = async () => {
    setLoadingStorage(true);
    try {
      // Primary: payment-service (Document_DB + Payment_DB quota)
      let data = null;
      try {
        const res = await apiFetch(`${PAYMENT_SERVICE_URL}/api/storage/usage`);
        if (res?.success && (res.totalBytes > 0 || res.counts?.files >= 0)) {
          data = res;
        }
      } catch (_) {}

      // Fallback: ChatModel's own storage endpoint (directly queries Document_DB)
      if (!data) {
        try {
          const chatBase = String(CHAT_MODEL_BASE_URL || '').replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
          const res = await apiFetch(`${chatBase}/api/chat/storage/usage`);
          const d = res?.data || res;
          if (d?.totalBytes !== undefined || d?.storage_used_bytes !== undefined) {
            // Normalise ChatModel response shape → StorageTab format
            data = {
              success:        true,
              filesBytes:     d.filesBytes     ?? d.storage_used_bytes ?? 0,
              chatBytes:      d.chatBytes      ?? 0,
              questionBytes:  d.questionBytes  ?? 0,
              embeddingBytes: d.embeddingBytes ?? 0,
              totalBytes:     d.totalBytes     ?? (d.storage_used_bytes ?? 0),
              totalMB:        d.totalMB        ?? 0,
              totalGB:        d.totalGB        ?? d.storage_used_gb ?? 0,
              counts: {
                files:      d.counts?.files      ?? d.documents_used ?? 0,
                chats:      d.counts?.chats      ?? 0,
                embeddings: d.counts?.embeddings ?? 0,
              },
              limitBytes:     null,
              limitGB:        null,
              usagePct:       null,
              filesByService: null,
              draftBytes:     0,
              citationBytes:  0,
            };
          }
        } catch (_) {}
      }

      setStorageData(data);
    } finally {
      setLoadingStorage(false);
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([fetchPlan(), fetchTx(), fetchTopupHistory(), fetchStorageAddonHistory(), fetchToken(), fetchStorage()]); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll, refresh]);

  // ── PDF ─────────────────────────────────────────────────────────────────────

  const getBillingParty = () => {
    try {
      const ui = JSON.parse(localStorage.getItem('userInfo') || '{}');
      return { name: ui.name || (ui.email?.split('@')[0]) || 'Customer', lines: getCustomerLinesFromUserInfo(ui) };
    } catch { return { name: 'Customer', lines: [] }; }
  };

  const downloadPdf = (kind, tx) => {
    let amount = parseFloat(tx.amount || 0);
    if (amount > 1000 && !String(tx.amount).includes('.')) amount /= 100;
    const html = buildProformaBillingHtml({
      logoUrl: jurinexLogoUrl, kind, transaction: tx, amountRupees: amount,
      company: { name: 'JuriNex', lines: getDefaultCompanyLines() },
      customer: getBillingParty(),
    });
    html2pdf().set({
      margin: [8,8,8,8], filename: `${kind}_${tx.id}_${Date.now()}.pdf`,
      image: { type:'jpeg', quality:0.98 },
      html2canvas: { scale:2, useCORS:true }, jsPDF: { unit:'mm', format:'a4' },
    }).from(html, 'string').save();
  };

  const exportCSV = () => {
    if (!transactions.length) return;
    const rows = transactions.map(t => [
      fmtDate(t.payment_date), t.plan_name,
      fmtCurrency(t.amount, t.currency), t.payment_status || '',
      t.payment_method || '', t.razorpay_payment_id || t.id,
    ]);
    const csv = [['Date','Description','Amount','Status','Method','ID'], ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `payments_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const storage  = planData?.resourceUtilization?.storage;
  const stBrk    = storage?.storage_breakdown;

  const monthlyUsed  = tokenData?.tokens_used_this_period    ?? 0;
  const monthlyLimit = tokenData?.monthly_token_limit        ?? 0;
  const topupBal     = tokenData?.topup_token_balance        ?? 0;
  const planLeft     = Math.max(0, tokenData?.remaining?.plan ?? 0);
  const isBlocked    = tokenData?.monthly_exhausted;
  const isTopup      = tokenData?.source === 'topup';

  // Free tier
  const freeTier          = quotaStatus?.free_tier ?? tokenData?.free_tier ?? null;
  const isFreeTierUser    = !!freeTier?.is_free_tier;
  const freeTierUsedInr   = freeTier?.used_inr ?? 0;
  const freeTierLimitInr  = freeTier?.limit_inr ?? 150;
  const freeTierRemainInr = freeTier?.remaining_inr ?? freeTierLimitInr;
  const freeTierPct       = freeTier?.percentage_used ?? 0;
  const freeTierExhausted = !!freeTier?.exhausted;

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-[3px] border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400 font-medium">Loading billing dashboard…</p>
      </div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Sticky top bar ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-screen-2xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
                <CreditCard size={15} className="text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900">Billing &amp; Usage</h1>
                <p className="text-[11px] text-slate-400 leading-none">Monitor your plan, tokens &amp; payments</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRefresh(p => p + 1)}
                className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <RefreshCw size={12} /> Refresh
              </button>
              <button
                onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
                className="h-8 px-4 flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
              >
                <ArrowUpRight size={12} /> Upgrade Plan
              </button>
            </div>
          </div>

          {/* Tab strip */}
          <div className="flex">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                  tab === id
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                <Icon size={13} />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-7 space-y-5">

        {/* System banners */}
        {banner && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle size={15} className="text-emerald-500 shrink-0" />
            <p className="text-sm font-medium text-emerald-800 flex-1">{banner}</p>
            <button onClick={() => setBanner(null)} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none">×</button>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <button onClick={() => setRefresh(p => p + 1)} className="text-xs font-semibold text-red-600 underline">Retry</button>
          </div>
        )}

        {/* ─── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-5">

            {/* ── Free tier quota card (only for free users) ─────────────── */}
            {isFreeTierUser && (
              <Card>
                <div className="px-6 py-5">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${freeTierExhausted ? 'bg-red-50' : 'bg-violet-50'}`}>
                        <Zap size={16} className={freeTierExhausted ? 'text-red-500' : 'text-violet-500'} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Free Tier Quota</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {freeTierExhausted
                            ? 'Your free quota is exhausted — upgrade to continue'
                            : `₹${freeTierRemainInr.toFixed(2)} remaining of your ₹${freeTierLimitInr} free allowance`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
                      className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold text-white rounded-xl transition-colors shrink-0"
                      style={{ background: freeTierExhausted ? '#7c3aed' : '#21C1B6' }}
                    >
                      <ArrowUpRight size={11} /> Upgrade Plan
                    </button>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {[
                      { label: 'Free Limit',   value: `₹${freeTierLimitInr}`,                    color: 'text-slate-900' },
                      { label: 'Used',          value: `₹${freeTierUsedInr.toFixed(2)}`,           color: freeTierExhausted ? 'text-red-600' : 'text-slate-900' },
                      { label: 'Remaining',     value: `₹${freeTierRemainInr.toFixed(2)}`,         color: freeTierExhausted ? 'text-red-400' : 'text-emerald-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
                        <p className={`text-base font-black ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5 max-w-lg">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Free quota usage</span>
                      <span className="font-semibold" style={{ color: freeTierPct >= 100 ? '#ef4444' : freeTierPct >= 80 ? '#f97316' : '#7c3aed' }}>
                        {Math.round(freeTierPct)}% used
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(freeTierPct, 100)}%`,
                          background: freeTierPct >= 100 ? '#ef4444' : freeTierPct >= 80 ? '#f97316' : 'linear-gradient(90deg,#7c3aed,#21C1B6)',
                        }}
                      />
                    </div>
                    {freeTierExhausted && (
                      <p className="text-xs text-red-500 font-medium pt-1">
                        All AI features are paused. Subscribe to a plan to resume.
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Row 1: Plan + Payment */}
            <div className="grid lg:grid-cols-2 gap-5 items-stretch">

              {/* Plan card */}
              <div>
                <Card>
                  {/* Teal gradient header */}
                  <div className="relative overflow-hidden rounded-t-2xl px-6 py-5"
                    style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 60%, #134e4a 100%)' }}>
                    {/* Decorative circle */}
                    <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-10 bg-white" />
                    <div className="absolute -right-2 -bottom-6 w-24 h-24 rounded-full opacity-10 bg-white" />

                    <div className="relative flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Star size={12} className="text-teal-200" />
                          <span className="text-teal-200 text-xs font-semibold uppercase tracking-wider">Active Plan</span>
                        </div>
                        <h2 className="text-white text-2xl font-bold mb-2">
                          {sub?.plan_name || getPlanDisplayName(sub) || 'Free'}
                        </h2>
                        {sub?.status && (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                            sub.status === 'active'
                              ? 'bg-emerald-400/20 text-emerald-100 border-emerald-400/30'
                              : 'bg-red-400/20 text-red-100 border-red-400/30'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sub.status === 'active' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Settings size={12} /> Manage
                      </button>
                    </div>
                  </div>

                  {/* Plan stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4">
                    {[
                      { label: 'Monthly Tokens',
                        value: sub?.monthly_tokens ? fmtNum(sub.monthly_tokens)
                             : sub?.token_limit    ? fmtNum(sub.token_limit) : '—' },
                      { label: 'Price',
                        value: sub?.price ? fmtCurrency(sub.price, sub.currency) : '—',
                        sub: sub?.billing_interval_months > 1 ? `/ ${sub.billing_interval_months} months` : '/ month' },
                      { label: 'Renews',
                        value: fmtDate(sub?.end_date) },
                    ].map(({ label, value, sub: s }, idx, arr) => (
                      <div
                        key={label}
                        className={`px-5 py-4 ${idx < arr.length - 1 ? 'border-r border-slate-100' : ''} ${idx >= 2 ? 'border-t border-slate-100' : ''}`}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
                        <p className="text-base font-bold text-slate-900">{value}</p>
                        {s && <p className="text-xs text-slate-400 mt-0.5">{s}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Credit balance strip — always visible */}
                  <div className={`mx-5 mb-4 flex items-center justify-between rounded-xl px-4 py-2.5 border ${
                    topupBal > 0
                      ? 'bg-amber-50 border-amber-100'
                      : 'bg-slate-50 border-slate-100'
                  }`}>
                    <div className="flex items-center gap-2">
                      <Coins size={13} className={topupBal > 0 ? 'text-amber-500' : 'text-slate-400'} />
                      <span className={`text-xs font-semibold ${topupBal > 0 ? 'text-amber-800' : 'text-slate-500'}`}>Credit Balance</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${topupBal > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{fmtNum(topupBal)}</span>
                      <span className={`text-xs ${topupBal > 0 ? 'text-amber-500' : 'text-slate-400'}`}>credits</span>
                      <button
                        onClick={() => setShowTopup(true)}
                        className="ml-2 flex items-center gap-1 text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-200 rounded-lg px-2 py-0.5 hover:bg-teal-100 transition-colors"
                      >
                        <Zap size={10} /> Buy Credits
                      </button>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Latest payment */}
              <div>
                <Card className="h-full flex flex-col">
                  <CardHeader icon={Receipt} title="Latest Payment" color="teal" />
                  {latestPay ? (
                    <div className="p-5 flex flex-col gap-4 flex-1">
                      {/* Amount */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Amount</p>
                          <p className="text-2xl font-bold text-slate-900">{fmtCurrency(latestPay.amount, latestPay.currency)}</p>
                        </div>
                        <Pill theme={txStatusTheme(latestPay.status)}>
                          {latestPay.status || 'pending'}
                        </Pill>
                      </div>

                      {/* Details list */}
                      <div className="space-y-2.5 bg-slate-50 rounded-xl p-3.5">
                        {[
                          { l: 'Plan',   v: latestPay.plan_name || '—' },
                          { l: 'Method', v: latestPay.payment_method || '—' },
                          { l: 'Date',   v: fmtDate(latestPay.payment_date) },
                        ].map(({ l, v }) => (
                          <div key={l} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{l}</span>
                            <span className="font-semibold text-slate-700">{v}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 mt-auto">
                        {[['Invoice', 'invoice'], ['Receipt', 'receipt']].map(([label, kind]) => (
                          <button
                            key={kind}
                            onClick={() => downloadPdf(kind, latestPay)}
                            className="flex-1 flex items-center justify-center gap-1.5 h-8 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors"
                          >
                            <Download size={11} /> {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                        <Receipt size={20} className="text-slate-300" />
                      </div>
                      <p className="text-sm font-medium text-slate-400">No payments yet</p>
                      <p className="text-xs text-slate-300 mt-1">Payments will appear here</p>
                    </div>
                  )}
                </Card>
              </div>
            </div>

            {/* Row 2: Alerts */}
            {showTopup && (
              <TokenTopupModal
                onClose={() => setShowTopup(false)}
                onSuccess={() => { setShowTopup(false); setRefresh(p => p + 1); refreshQuota(); }}
              />
            )}
            {showStorageAddon && (
              <StorageAddonModal
                onClose={() => setShowStorageAddon(false)}
                onSuccess={() => { setShowStorageAddon(false); setRefresh(p => p + 1); fetchStorage(); }}
              />
            )}

            {isBlocked && (
              <AlertStrip
                icon={AlertTriangle} color="red"
                title="Monthly allowance exhausted"
                body="All monthly tokens used and no credits. Buy credits to resume AI features."
                actions={[
                  { label: 'Buy Credits', icon: Zap, color: 'amber', fn: () => setShowTopup(true) },
                ]}
              />
            )}

            {/* Token Usage + Storage inline */}
            <UsageStorageCard
              tokenData={tokenData}
              monthlyUsed={monthlyUsed}
              monthlyLimit={monthlyLimit}
              planLeft={planLeft}
              topupBal={topupBal}
              storageData={storageData}
              onBuyTokens={() => setShowTopup(true)}
              onUpgrade={() => navigate(SUBSCRIPTION_PLANS_PATH)}
              onRefreshStorage={fetchStorage}
            />

          </div>
        )}




        {/* ─── PLANS & ADD-ONS TAB ──────────────────────────────────────────── */}
        {tab === 'addons' && (
          <div className="space-y-4">

            {showTopup && (
              <TokenTopupModal
                onClose={() => setShowTopup(false)}
                onSuccess={() => { setShowTopup(false); setRefresh(p => p + 1); refreshQuota(); }}
              />
            )}
            {showStorageAddon && (
              <StorageAddonModal
                onClose={() => setShowStorageAddon(false)}
                onSuccess={() => { setShowStorageAddon(false); setRefresh(p => p + 1); fetchStorage(); }}
              />
            )}

            {/* ── Credits add-on ───────────────────────────────────────── */}
            <Card>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center">
                    <Zap size={16} className="text-[#21C1B6]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Extra Credits</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Purchased credit top-ups — used when your monthly plan runs out</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTopup(true)}
                  className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold text-white rounded-xl transition-colors"
                  style={{ background: '#21C1B6' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1AA49B'}
                  onMouseLeave={e => e.currentTarget.style.background = '#21C1B6'}
                >
                  <Plus size={11} /> Buy Credits
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                {(() => {
                  const totalPurchased = topupHistory
                    .filter(t => t.status === 'completed')
                    .reduce((s, t) => s + Number(t.tokens_credited || 0), 0);
                  const creditsUsed = Math.max(0, totalPurchased - topupBal);
                  const usedPct     = totalPurchased > 0 ? Math.min((creditsUsed / totalPurchased) * 100, 100) : 0;
                  const barColor    = usedPct >= 90 ? '#ef4444' : usedPct >= 70 ? '#f97316' : '#21C1B6';
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-teal-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-500 mb-1">Total Purchased</p>
                          <p className="text-lg font-black text-teal-700">{fmtNum(totalPurchased)}</p>
                          <p className="text-[11px] text-teal-400 mt-0.5">credits bought</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Credits Used</p>
                          <p className="text-lg font-black text-slate-700">{fmtNum(creditsUsed)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">consumed</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Balance Left</p>
                          <p className={`text-lg font-black ${topupBal > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{fmtNum(topupBal)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">remaining</p>
                        </div>
                      </div>
                      {totalPurchased > 0 && (
                        <div className="space-y-1.5 max-w-lg">
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Credits consumed</span>
                            <span className="font-semibold" style={{ color: barColor }}>{Math.round(usedPct)}% used</span>
                          </div>
                          <div className="h-2 bg-teal-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${usedPct}%`, backgroundColor: barColor }} />
                          </div>
                          <p className="text-[11px] text-slate-400">{fmtNum(topupBal)} credits left</p>
                        </div>
                      )}
                      {totalPurchased === 0 && (
                        <div className="flex items-center gap-3 bg-teal-50/60 border border-teal-100 rounded-xl px-4 py-3">
                          <Zap size={14} className="text-[#21C1B6] shrink-0" />
                          <p className="text-xs text-teal-700">No credits purchased yet. Buy credits to continue using AI features when your plan runs out.</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* ── Storage add-on ───────────────────────────────────────── */}
            <Card>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center">
                    <HardDrive size={16} className="text-[#21C1B6]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Extra Storage</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Purchased storage add-ons — stacks on top of your plan's included storage</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStorageAddon(true)}
                  className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold text-white bg-[#21C1B6] rounded-xl hover:bg-[#1AA49B] transition-colors"
                >
                  <Plus size={11} /> Buy Storage
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                {(() => {
                  const completedPurchases = storageAddonHistory.filter(h => h.status === 'completed');
                  const extraBytes  = completedPurchases.reduce((s, h) => s + Number(h.storage_bytes_granted || 0), 0);
                  const purchaseCount = completedPurchases.length;

                  // How much of the extra storage is consumed: total used minus plan base limit
                  const sd          = storageData || {};
                  const totalUsed   = sd.totalBytes || 0;
                  const limitBytesN = sd.limitBytes ? Number(sd.limitBytes) : null;
                  const planBaseBytes = limitBytesN ? Math.max(0, limitBytesN - extraBytes) : 0;
                  const extraUsed   = extraBytes > 0 ? Math.min(extraBytes, Math.max(0, totalUsed - planBaseBytes)) : 0;
                  const usedPct     = extraBytes > 0 ? Math.min((extraUsed / extraBytes) * 100, 100) : 0;
                  const barColor    = usedPct >= 90 ? '#ef4444' : usedPct >= 70 ? '#f97316' : '#6366f1';

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-teal-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-500 mb-1">Total Purchased</p>
                          <p className="text-lg font-black text-teal-700">{extraBytes > 0 ? fmtBytes(extraBytes) : '0 B'}</p>
                          <p className="text-[11px] text-teal-400 mt-0.5">{purchaseCount} purchase{purchaseCount !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Storage Used</p>
                          <p className="text-lg font-black text-slate-700">{fmtBytes(extraUsed)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">from add-on</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Add-On Free</p>
                          <p className={`text-lg font-black ${extraBytes - extraUsed > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                            {extraBytes > 0 ? fmtBytes(Math.max(0, extraBytes - extraUsed)) : '—'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">available</p>
                        </div>
                      </div>
                      {extraBytes > 0 && (
                        <div className="space-y-1.5 max-w-lg">
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Add-on storage consumed</span>
                            <span className="font-semibold" style={{ color: barColor }}>{Math.round(usedPct)}% used</span>
                          </div>
                          <div className="h-2 bg-teal-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${usedPct}%`, backgroundColor: barColor }} />
                          </div>
                          <p className="text-[11px] text-slate-400">{fmtBytes(Math.max(0, extraBytes - extraUsed))} free</p>
                        </div>
                      )}
                      {extraBytes === 0 && (
                        <div className="flex items-center gap-3 bg-teal-50/60 border border-teal-100 rounded-xl px-4 py-3">
                          <HardDrive size={14} className="text-[#21C1B6] shrink-0" />
                          <p className="text-xs text-teal-700">No extra storage purchased yet. Buy a storage add-on to expand beyond your plan's limit.</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>

          </div>
        )}

        {/* ─── PAYMENTS TAB ─────────────────────────────────────────────────── */}
        {tab === 'history' && (() => {
          // Merge all three sources into one list, sorted by date desc
          // Every row gets a normalized _tx so Invoice/Receipt works for all types
          const allRows = [
            ...transactions.map(t => ({
              _key:     `plan-${t.id}`,
              _cat:     'plan',
              date:     t.payment_date || t.created_at,
              name:     t.plan_name || '—',
              detail:   t.payment_method || '—',
              amount:   t.amount,
              currency: t.currency,
              status:   t.payment_status || t.status,
              _tx:      t,
            })),
            ...topupHistory.map(t => ({
              _key:     `credit-${t.id}`,
              _cat:     'credit',
              date:     t.created_at,
              name:     t.plan_name || '—',
              detail:   `+${fmtNum(t.tokens_credited)} credits`,
              amount:   t.amount,
              currency: t.currency,
              status:   t.status,
              expires:  t.expires_at,
              _tx: {
                id:                   t.id,
                plan_name:            `${t.plan_name || 'Credit Pack'} (+${fmtNum(t.tokens_credited)} credits)`,
                payment_date:         t.created_at,
                payment_method:       t.razorpay_payment_id ? 'Razorpay' : '—',
                razorpay_payment_id:  t.razorpay_payment_id,
                razorpay_order_id:    t.razorpay_order_id,
                payment_status:       t.status,
                amount:               t.amount,
                currency:             t.currency,
              },
            })),
            ...storageAddonHistory.map(t => ({
              _key:     `storage-${t.id}`,
              _cat:     'storage',
              date:     t.created_at,
              name:     t.plan_name || '—',
              detail:   `+${t.plan_storage_gb ? `${t.plan_storage_gb} GB` : fmtBytes(t.storage_bytes_granted)}`,
              amount:   t.amount,
              currency: t.currency,
              status:   t.status,
              expires:  t.expires_at,
              _tx: {
                id:                   t.id,
                plan_name:            `${t.plan_name || 'Storage Add-On'} (+${t.plan_storage_gb ? `${t.plan_storage_gb} GB` : fmtBytes(t.storage_bytes_granted)})`,
                payment_date:         t.created_at,
                payment_method:       t.razorpay_payment_id ? 'Razorpay' : '—',
                razorpay_payment_id:  t.razorpay_payment_id,
                razorpay_order_id:    t.razorpay_order_id,
                payment_status:       t.status,
                amount:               t.amount,
                currency:             t.currency,
              },
            })),
          ].sort((a, b) => new Date(b.date) - new Date(a.date));

          const CAT_META = {
            plan:    { label: 'Plan',    color: 'bg-teal-50   text-teal-700   border-teal-200',   dot: 'bg-teal-500'   },
            credit:  { label: 'Credits', color: 'bg-amber-50  text-amber-700  border-amber-200',  dot: 'bg-amber-500'  },
            storage: { label: 'Storage', color: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-[#21C1B6]' },
          };

          return (
            <UnifiedPaymentHistory
              allRows={allRows}
              catMeta={CAT_META}
              loadingAny={loadingTx || loadingTopupHist || loadingStorageAddonHist}
              onBuyCredits={() => setShowTopup(true)}
              onBuyStorage={() => setShowStorageAddon(true)}
              downloadPdf={downloadPdf}
              showTopup={showTopup}
              showStorageAddon={showStorageAddon}
              setShowTopup={setShowTopup}
              setShowStorageAddon={setShowStorageAddon}
              onTopupSuccess={() => { setShowTopup(false); setRefresh(p => p + 1); refreshQuota(); }}
              onStorageSuccess={() => { setShowStorageAddon(false); setRefresh(p => p + 1); fetchStorage(); }}
            />
          );
        })()}

      </div>
    </div>
  );
}

// ─── Unified payment history ─────────────────────────────────────────────────

const PAGE_SIZE = 10;

function UnifiedPaymentHistory({
  allRows, catMeta, loadingAny,
  onBuyCredits, onBuyStorage, downloadPdf,
  showTopup, showStorageAddon, setShowTopup, setShowStorageAddon,
  onTopupSuccess, onStorageSuccess,
}) {
  const [filterCat, setFilterCat] = React.useState('all');
  const [page, setPage]           = React.useState(1);

  const filtered   = filterCat === 'all' ? allRows : allRows.filter(r => r._cat === filterCat);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  React.useEffect(() => { setPage(1); }, [filterCat]);

  const counts = {
    all:     allRows.length,
    plan:    allRows.filter(r => r._cat === 'plan').length,
    credit:  allRows.filter(r => r._cat === 'credit').length,
    storage: allRows.filter(r => r._cat === 'storage').length,
  };

  const FILTERS = [
    { key: 'all',     label: 'All',     count: counts.all },
    { key: 'plan',    label: 'Plans',   count: counts.plan },
    { key: 'credit',  label: 'Credits', count: counts.credit },
    { key: 'storage', label: 'Storage', count: counts.storage },
  ];

  // Export filtered rows as CSV
  const handleExport = () => {
    const rows = filtered.map(r => [
      r.date ? new Date(r.date).toLocaleDateString('en-IN') : '',
      catMeta[r._cat]?.label || r._cat,
      r.name,
      r.detail,
      r.amount != null ? r.amount : '',
      r.currency || 'INR',
      r.status || '',
      r._tx?.razorpay_payment_id || '',
    ]);
    const csv = [['Date', 'Category', 'Description', 'Detail', 'Amount', 'Currency', 'Status', 'Payment ID'], ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `payment_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const fmtRowAmount = (amount, currency) => {
    if (amount == null) return '—';
    const n = parseFloat(amount);
    const v = n > 1000 && !String(amount).includes('.') ? n / 100 : n;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(v);
  };

  const statusTheme = (s) => {
    if (!s) return 'text-slate-500 bg-slate-50 border-slate-200';
    if (['captured', 'completed', 'paid'].includes(s)) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (s === 'pending') return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  return (
    <>
      {showTopup && <TokenTopupModal onClose={() => setShowTopup(false)} onSuccess={onTopupSuccess} />}
      {showStorageAddon && <StorageAddonModal onClose={() => setShowStorageAddon(false)} onSuccess={onStorageSuccess} />}

      <Card>
        {/* ── Header ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <Receipt size={16} className="text-slate-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Complete Payment History</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {counts.all} transaction{counts.all !== 1 ? 's' : ''} · plans, credits &amp; storage
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button onClick={onBuyCredits}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors">
              <Zap size={11} /> Buy Credits
            </button>
            <button onClick={onBuyStorage}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B] transition-colors">
              <HardDrive size={11} /> Buy Storage
            </button>
            <button onClick={handleExport} disabled={filtered.length === 0}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors">
              <Download size={11} /> Export CSV
            </button>
          </div>
        </div>

        {/* ── Filter tabs ──────────────────────────────────── */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-100">
          {FILTERS.map(({ key, label, count }) => {
            const active = filterCat === key;
            const activeColors = {
              all:     'border-slate-800 text-slate-900',
              plan:    'border-teal-600  text-teal-700',
              credit:  'border-amber-500 text-amber-700',
              storage: 'border-[#21C1B6] text-teal-700',
            };
            return (
              <button
                key={key}
                onClick={() => setFilterCat(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                  active
                    ? `${activeColors[key] || 'border-slate-800 text-slate-900'}`
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {key !== 'all' && catMeta[key] && (
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? catMeta[key].dot : 'bg-slate-300'}`} />
                )}
                {label}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-slate-900/10 text-current' : 'bg-slate-100 text-slate-400'
                }`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ── Table ────────────────────────────────────────── */}
        {loadingAny ? <CenteredSpinner /> : filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No transactions" body="No payments match the selected filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    {['Date', 'Category', 'Description', 'Detail', 'Amount', 'Status', 'Actions'].map(h => (
                      <th key={h} className={`px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${
                        h === 'Amount' || h === 'Actions' ? 'text-right' : 'text-left'
                      }`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pageRows.map((row) => {
                    const meta = catMeta[row._cat] || {};
                    return (
                      <tr key={row._key} className="hover:bg-slate-50/70 transition-colors group">

                        {/* Date */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="text-xs font-medium text-slate-700">
                            {row.date ? new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {row.date ? new Date(row.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </p>
                        </td>

                        {/* Category badge */}
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${meta.color || ''}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot || ''}`} />
                            {meta.label || row._cat}
                          </span>
                        </td>

                        {/* Description */}
                        <td className="px-5 py-4 max-w-[180px]">
                          <p className="text-sm font-semibold text-slate-800 truncate">{row.name}</p>
                        </td>

                        {/* Detail */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className={`text-xs font-medium ${
                            row._cat === 'credit'  ? 'text-amber-600' :

                            

                            
                            'text-slate-500'
                          }`}>{row.detail}</span>
                        </td>

                        {/* Amount */}
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <span className="text-sm font-bold text-slate-900">{fmtRowAmount(row.amount, row.currency)}</span>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusTheme(row.status)}`}>
                            <span className={`w-1 h-1 rounded-full ${
                              ['captured','completed','paid'].includes(row.status) ? 'bg-emerald-500' :
                              row.status === 'pending' ? 'bg-amber-500' : 'bg-red-400'
                            }`} />
                            {row.status || '—'}
                          </span>
                        </td>

                        {/* Actions — Invoice + Receipt for ALL rows that have _tx */}
                        <td className="px-5 py-4 text-right">
                          {row._tx ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {['invoice', 'receipt'].map(kind => (
                                <button
                                  key={kind}
                                  onClick={() => downloadPdf(kind, row._tx)}
                                  className="h-7 px-3 text-[11px] font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-all capitalize"
                                >
                                  {kind}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-200">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ───────────────────────────────── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/40">
              {/* Info */}
              <p className="text-xs text-slate-400">
                Showing <span className="font-semibold text-slate-600">{(safePage - 1) * PAGE_SIZE + 1}</span>
                {' '}–{' '}
                <span className="font-semibold text-slate-600">{Math.min(safePage * PAGE_SIZE, filtered.length)}</span>
                {' '}of{' '}
                <span className="font-semibold text-slate-600">{filtered.length}</span> transactions
              </p>

              {/* Controls */}
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  {/* Prev */}
                  <button
                    disabled={safePage === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="flex items-center gap-1 h-8 px-3 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ‹ Prev
                  </button>

                  {/* Page numbers */}
                  <div className="flex items-center gap-1 mx-1">
                    {(() => {
                      const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
                      const visible = pages.filter(n =>
                        n === 1 || n === totalPages || Math.abs(n - safePage) <= 1
                      );
                      const withEllipsis = [];
                      visible.forEach((n, idx) => {
                        if (idx > 0 && n - visible[idx - 1] > 1) {
                          withEllipsis.push('…');
                        }
                        withEllipsis.push(n);
                      });
                      return withEllipsis.map((n, idx) =>
                        n === '…' ? (
                          <span key={`e${idx}`} className="w-8 h-8 flex items-center justify-center text-xs text-slate-300 select-none">…</span>
                        ) : (
                          <button
                            key={n}
                            onClick={() => setPage(n)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold border transition-all ${
                              safePage === n
                                ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                                : 'border-slate-200 text-slate-500 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                          >{n}</button>
                        )
                      );
                    })()}
                  </div>

                  {/* Next */}
                  <button
                    disabled={safePage === totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="flex items-center gap-1 h-8 px-3 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function AlertStrip({ icon: Icon, color, title, body, actions = [] }) {
  const c = {
    red:   { wrap:'bg-red-50   border-red-200',   icon:'text-red-400',   title:'text-red-800',   body:'text-red-600' },
    amber: { wrap:'bg-amber-50 border-amber-200', icon:'text-amber-400', title:'text-amber-800', body:'text-amber-600' },
  }[color] || {};
  return (
    <div className={`flex items-start gap-4 border rounded-xl px-5 py-4 ${c.wrap}`}>
      <Icon size={16} className={`${c.icon} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold mb-0.5 ${c.title}`}>{title}</p>
        <p className={`text-xs leading-relaxed ${c.body}`}>{body}</p>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {actions.map(({ label, icon: AI, color: ac, fn }) => (
              <SmallBtn key={label} icon={AI} color={ac} onClick={fn}>{label}</SmallBtn>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SmallBtn({ icon: Icon, color, onClick, children }) {
  const c = {
    amber: 'bg-amber-500 hover:bg-amber-600 text-white',
    teal:  'bg-teal-600  hover:bg-teal-700  text-white',
    gray:  'bg-slate-700 hover:bg-slate-800  text-white',
  }[color] || 'bg-slate-700 text-white';
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 h-7 px-3 text-xs font-semibold rounded-lg transition-colors ${c}`}>
      {Icon && <Icon size={11} />}{children}
    </button>
  );
}

function InfoNote({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
      {Icon && <Icon size={12} className="text-teal-500 mt-0.5 shrink-0" />}
      <p className="text-xs text-teal-700 leading-relaxed">{children}</p>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="py-16 flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-[3px] border-teal-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-slate-400">Loading…</p>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Icon size={22} className="text-slate-300" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">{body}</p>
      </div>
    </div>
  );
}

