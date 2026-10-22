import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  fetchFirmAnalyticsSummary,
  fetchFirmAnalyticsUsers,
  fetchFirmAnalyticsUserDetail,
  updateFirmUserTokenLimit,
} from '../api/rbacApi';

const LIVE_WINDOW_MS = 45 * 1000;
const AUTO_REFRESH_MS = 5 * 1000;
const CHART_COLORS = ['#19B5AE', '#2563EB', '#0EA5E9', '#F59E0B', '#EF4444', '#10B981'];

const rangeOptions = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const sortOptions = [
  { value: 'tokens_desc', label: 'Highest tokens' },
  { value: 'cost_desc', label: 'Highest cost' },
  { value: 'documents_desc', label: 'Most case docs' },
  { value: 'cases_desc', label: 'Most cases' },
  { value: 'last_seen_desc', label: 'Recent activity' },
  { value: 'name_asc', label: 'Name A-Z' },
];

const formatNumber = (value) => new Intl.NumberFormat('en-IN').format(Number(value || 0));
const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const normalized = bytes / (1024 ** unitIndex);
  return `${normalized.toFixed(normalized >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (value) => {
  if (!value) return 'Not yet available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not yet available';

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const formatDayLabel = (value) => {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
  }).format(parsed);
};

const formatDurationMinutes = (value) => {
  const totalMinutes = Number(value || 0);
  if (!totalMinutes) return 'Not yet available';
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const formatRelativeTime = (value) => {
  if (!value) return 'No heartbeat yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No heartbeat yet';

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (deltaSeconds < 10) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getPlanLabel = (plan) => {
  if (!plan?.planName) return 'No active plan';
  return plan.isInheritedFromFirm ? `${plan.planName} (Inherited)` : `${plan.planName} (Direct)`;
};

const getInitials = (value) =>
  String(value || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

const getPresenceMeta = (lastSeenAt, firstLogin = false, isActive = true) => {
  if (isActive === false) {
    return {
      state: 'disabled',
      live: false,
      label: 'Disabled',
      helper: 'Account disabled',
      dotClass: 'bg-red-500',
      pillClass: 'border-red-200 bg-red-50 text-red-700',
    };
  }

  if (firstLogin) {
    return {
      state: 'pending',
      live: false,
      label: 'Invite pending',
      helper: 'Password not set',
      dotClass: 'bg-amber-500',
      pillClass: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  if (!lastSeenAt) {
    return {
      state: 'offline',
      live: false,
      label: 'Offline',
      helper: 'No heartbeat yet',
      dotClass: 'bg-slate-300',
      pillClass: 'border-slate-200 bg-slate-50 text-slate-600',
    };
  }

  const parsed = new Date(lastSeenAt);
  if (Number.isNaN(parsed.getTime())) {
    return {
      state: 'offline',
      live: false,
      label: 'Offline',
      helper: 'Invalid activity time',
      dotClass: 'bg-slate-300',
      pillClass: 'border-slate-200 bg-slate-50 text-slate-600',
    };
  }

  const diff = Date.now() - parsed.getTime();
  if (diff <= LIVE_WINDOW_MS) {
    return {
      state: 'live',
      live: true,
      label: 'Live now',
      helper: `Seen ${formatRelativeTime(lastSeenAt)}`,
      dotClass: 'bg-emerald-500',
      pillClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }

  return {
    state: 'recent',
    live: false,
    label: 'Recently active',
    helper: `Seen ${formatRelativeTime(lastSeenAt)}`,
    dotClass: 'bg-sky-500',
    pillClass: 'border-sky-200 bg-sky-50 text-sky-700',
  };
};

const buildSegments = (items = [], labelKey, valueKey) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: item?.[labelKey] || 'Unknown',
      value: Number(item?.[valueKey] || 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!normalized.length) {
    return { total: 0, segments: [] };
  }

  const topItems = normalized.slice(0, 5);
  const remaining = normalized.slice(5).reduce((sum, item) => sum + item.value, 0);
  const merged = remaining > 0 ? [...topItems, { label: 'Others', value: remaining }] : topItems;
  const total = merged.reduce((sum, item) => sum + item.value, 0);

  return {
    total,
    segments: merged.map((item, index) => ({
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length],
      percentage: total ? (item.value / total) * 100 : 0,
    })),
  };
};

const buildConicGradient = (segments) => {
  if (!segments.length) {
    return 'conic-gradient(#E2E8F0 0deg 360deg)';
  }

  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    const end = cursor + segment.percentage * 3.6;
    cursor = end;
    return `${segment.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
};

const getTrendPeak = (items = []) => {
  const values = items.map((item) => Number(item?.totalTokens || item?.requestCount || 0));
  return Math.max(...values, 1);
};

const SummaryCard = ({ eyebrow, value, helper, tone = 'teal' }) => {
  const toneMap = {
    teal: 'from-[#0F766E]/15 via-white to-[#14B8A6]/10 border-[#B8F1EC]',
    blue: 'from-[#2563EB]/15 via-white to-[#38BDF8]/10 border-[#CFE4FF]',
    amber: 'from-[#F59E0B]/18 via-white to-[#FDBA74]/10 border-[#FBE0B4]',
    rose: 'from-[#EF4444]/14 via-white to-[#F97316]/8 border-[#FFD4C6]',
  };

  return (
    <div className={`rounded-[26px] border bg-gradient-to-br px-5 py-4 shadow-[0_18px_46px_rgba(15,23,42,0.08)] ${toneMap[tone] || toneMap.teal}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-900">{value}</div>
      {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
    </div>
  );
};

const PresencePill = ({ presence }) => (
  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${presence.pillClass}`}>
    <span className={`h-2.5 w-2.5 rounded-full ${presence.dotClass}`} />
    {presence.label}
  </span>
);

const CapBadge = ({ tokenCap }) => {
  if (!tokenCap?.monthlyTokenLimit) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">No cap</span>;
  }

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        tokenCap.capStatus === 'exceeded'
          ? 'bg-red-50 text-red-600'
          : 'bg-[#EAF9F8] text-[#1B7C75]'
      }`}
    >
      {formatNumber(tokenCap.monthlyTokenLimit)} tokens
    </span>
  );
};

const MetricCard = ({ label, value, helper }) => (
  <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className="mt-3 text-2xl font-semibold text-slate-900">{value}</div>
    {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
  </div>
);

const RingChartCard = ({ title, subtitle, data, emptyMessage, valueFormatter = formatNumber, centerLabel = 'Total' }) => {
  const ring = buildSegments(data.items, data.labelKey, data.valueKey);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
        </div>
      </div>

      {ring.segments.length ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
          <div className="flex justify-center">
            <div
              className="relative flex h-44 w-44 items-center justify-center rounded-full"
              style={{ background: buildConicGradient(ring.segments) }}
            >
              <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{centerLabel}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{valueFormatter(ring.total)}</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {ring.segments.map((segment) => (
              <div key={segment.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
                    <span className="truncate text-sm font-semibold text-slate-800">{segment.label}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{valueFormatter(segment.value)}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.max(segment.percentage, 6)}%`, backgroundColor: segment.color }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-500">{segment.percentage.toFixed(1)}% share</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
    </div>
  );
};

const TokenCompositionCard = ({ inputTokens = 0, outputTokens = 0 }) => {
  const normalizedInputTokens = Number(inputTokens || 0);
  const normalizedOutputTokens = Number(outputTokens || 0);
  const totalTokens = normalizedInputTokens + normalizedOutputTokens;
  const segments = totalTokens
    ? [
        {
          label: 'Input tokens',
          value: normalizedInputTokens,
          color: '#19B5AE',
          percentage: totalTokens ? (normalizedInputTokens / totalTokens) * 100 : 0,
          helper: 'Prompt side',
        },
        {
          label: 'Output tokens',
          value: normalizedOutputTokens,
          color: '#2563EB',
          percentage: totalTokens ? (normalizedOutputTokens / totalTokens) * 100 : 0,
          helper: 'Response side',
        },
      ].filter((segment) => segment.value > 0)
    : [];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-semibold text-slate-900">Token composition</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dynamic donut split of input and output tokens. The center shows the total token usage for this selected range.
          </p>
        </div>
      </div>

      {segments.length ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)] xl:items-center">
          <div className="flex justify-center">
            <div
              className="relative flex h-44 w-44 items-center justify-center rounded-full"
              style={{ background: buildConicGradient(segments) }}
            >
              <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Total</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(totalTokens)}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Total tokens</div>
              <div className="mt-3 text-2xl font-semibold text-slate-900">{formatNumber(totalTokens)}</div>
              <div className="mt-2 text-sm text-slate-500">Input + output combined</div>
            </div>
            {segments.map((segment) => (
              <div key={segment.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
                    <span className="truncate text-sm font-semibold text-slate-800">{segment.label}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{formatNumber(segment.value)}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.max(segment.percentage, 6)}%`, backgroundColor: segment.color }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{segment.percentage.toFixed(1)}% share</span>
                  <span>{segment.helper}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
          No token usage found for this range.
        </div>
      )}
    </div>
  );
};

const TrendChart = ({ items = [] }) => {
  const trendItems = Array.isArray(items) ? items : [];
  const peak = getTrendPeak(trendItems);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-semibold text-slate-900">Usage trend</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Token activity over the selected date range. The tallest bar marks the busiest day.
          </p>
        </div>
      </div>

      {trendItems.length ? (
        <div className="mt-6 overflow-x-auto">
          <div className="flex min-w-[560px] items-end gap-3">
            {trendItems.map((item, index) => {
              const metric = Number(item?.totalTokens || item?.requestCount || 0);
              const normalizedHeight = Math.max(14, Math.round((metric / peak) * 180));
              const highlight = index === trendItems.length - 1;
              return (
                <div key={`${item.day}-${index}`} className="flex min-w-[56px] flex-1 flex-col items-center gap-3">
                  <div className="text-xs font-semibold text-slate-400">{formatNumber(metric)}</div>
                  <div className="flex h-48 w-full items-end rounded-[24px] bg-slate-100/80 px-2 pb-2">
                    <div
                      className={`w-full rounded-[18px] bg-gradient-to-t ${
                        highlight
                          ? 'from-[#0F766E] via-[#19B5AE] to-[#83F2E7]'
                          : 'from-[#1D4ED8] via-[#0EA5E9] to-[#7DD3FC]'
                      } shadow-[0_14px_28px_rgba(37,99,235,0.18)]`}
                      style={{ height: `${normalizedHeight}px` }}
                    />
                  </div>
                  <div className="text-center text-xs text-slate-500">{formatDayLabel(item.day)}</div>
                  <div className="text-center text-[11px] text-slate-400">
                    {formatNumber(item.requestCount)} req
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
          No usage trend found for this range.
        </div>
      )}
    </div>
  );
};

const LiveUsersPanel = ({ rows, onView }) => {
  const liveMembers = rows
    .filter((row) => getPresenceMeta(row.lastSeenAt, row.firstLogin, row.isActive !== false).live)
    .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-semibold text-slate-900">Live members</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Members whose last heartbeat landed in the last 45 seconds.
          </p>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          {formatNumber(liveMembers.length)} live
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {liveMembers.length ? liveMembers.slice(0, 6).map((member) => {
          const presence = getPresenceMeta(member.lastSeenAt, member.firstLogin, member.isActive !== false);
          return (
            <button
              key={member.userId}
              onClick={() => onView(member.userId)}
              className="flex w-full items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-left transition hover:border-[#A8E8E3] hover:bg-[#F3FFFD]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E7FAF7] text-sm font-semibold text-[#15736C]">
                  {getInitials(member.username || member.email)}
                  <span className={`absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${presence.dotClass}`} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{member.username}</div>
                  <div className="truncate text-xs text-slate-500">{member.email}</div>
                </div>
              </div>
              <div className="text-right">
                <PresencePill presence={presence} />
                <div className="mt-2 text-xs text-slate-500">{presence.helper}</div>
              </div>
            </button>
          );
        }) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
            No members are live right now.
          </div>
        )}
      </div>
    </div>
  );
};

const TopUsagePanel = ({ rows }) => {
  const topRows = [...rows]
    .sort((a, b) => Number(b?.usage?.totalTokens || 0) - Number(a?.usage?.totalTokens || 0))
    .slice(0, 5);
  const peak = Math.max(...topRows.map((row) => Number(row?.usage?.totalTokens || 0)), 1);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <h4 className="text-lg font-semibold text-slate-900">Highest usage members</h4>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Quick leaderboard for token-heavy accounts in the current range.
      </p>

      <div className="mt-5 space-y-4">
        {topRows.length ? topRows.map((row) => {
          const tokens = Number(row?.usage?.totalTokens || 0);
          const width = Math.max(8, Math.round((tokens / peak) * 100));
          const presence = getPresenceMeta(row.lastSeenAt, row.firstLogin, row.isActive !== false);
          return (
            <div key={row.userId} className="rounded-3xl border border-slate-200 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${presence.dotClass}`} />
                    <span className="truncate text-sm font-semibold text-slate-900">{row.username}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{row.email}</div>
                </div>
                <div className="text-right text-sm font-semibold text-slate-900">{formatNumber(tokens)}</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-gradient-to-r from-[#2563EB] via-[#0EA5E9] to-[#19B5AE]" style={{ width: `${width}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{formatCurrency(row?.usage?.totalCost || 0)}</span>
                <span>{formatNumber(row?.usage?.requestCount || 0)} req</span>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
            No usage found for this filter.
          </div>
        )}
      </div>
    </div>
  );
};

const DetailActivityCard = ({ label, value, helper, accentClass = 'from-[#0F766E]/15 to-white' }) => (
  <div className={`h-full rounded-[26px] border border-slate-200 bg-gradient-to-br ${accentClass} px-4 py-4 shadow-sm`}>
    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className="mt-3 text-[clamp(1.5rem,2vw,2.2rem)] font-semibold leading-tight text-slate-900">{value}</div>
    {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
  </div>
);

const DetailModal = ({
  detailLoading,
  detailRefreshing,
  selectedUser,
  onClose,
  capDraft,
  setCapDraft,
  hardStopEnabled,
  setHardStopEnabled,
  saveTokenCap,
  savingCap,
}) => {
  if (!detailLoading && !selectedUser) return null;

  const detailUser = selectedUser?.user || {};
  const presence = getPresenceMeta(detailUser.lastSeenAt, detailUser.firstLogin, detailUser.isActive !== false);
  const tokenCap = detailUser.tokenCap || {
    usedThisMonth: 0,
    remainingThisMonth: null,
    monthlyTokenLimit: null,
    hardStopEnabled: true,
  };

  return (
    <div className="overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,rgba(247,250,252,0.98),rgba(255,255,255,0.98))] shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
      <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(33,193,182,0.1),rgba(255,255,255,0.96),rgba(59,130,246,0.05))] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-[#A8E8E3] hover:text-[#1AA49B]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              Back to analytics dashboard
            </button>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1AA49B]">Member analytics</p>
              <h3 className="mt-2 text-3xl font-semibold text-slate-900">
                {detailLoading ? 'Loading details...' : `Usage details for ${detailUser.username}`}
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!detailLoading ? <PresencePill presence={presence} /> : null}
                <span className="text-sm text-slate-500">
                  Live view refreshes every 5 seconds while this tab is visible.
                </span>
                {detailRefreshing ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                    Refreshing…
                  </span>
                ) : null}
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white/90 p-2 text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
              aria-label="Close analytics detail"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 lg:px-5 lg:py-5">
        {detailLoading || !selectedUser ? (
          <div className="py-14 text-center text-slate-500">Loading user analytics...</div>
        ) : (
          <div className="space-y-5">
              <div className="rounded-[30px] border border-[#CFEFEB] bg-[linear-gradient(135deg,rgba(25,181,174,0.12),rgba(255,255,255,0.98),rgba(14,165,233,0.05))] p-5 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <div className="grid gap-4 xl:grid-cols-12">
                  <div className="xl:col-span-4">
                    <div className="flex h-full items-center gap-4 rounded-[28px] border border-white/70 bg-white/60 px-5 py-5 backdrop-blur-sm">
                      <div className="relative flex h-20 w-20 items-center justify-center rounded-[28px] bg-[#1AA49B] text-2xl font-semibold text-white shadow-[0_18px_38px_rgba(26,164,155,0.28)]">
                        {getInitials(detailUser.username || detailUser.email)}
                        <span className={`absolute -right-1 -top-1 h-4 w-4 rounded-full border-[3px] border-white ${presence.dotClass}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-2xl font-semibold text-slate-900">{detailUser.username}</div>
                        <div className="mt-1 truncate text-sm text-slate-500">{detailUser.email}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <PresencePill presence={presence} />
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                            {getPlanLabel(detailUser.effectivePlan)}
                          </span>
                          {detailUser.membershipRole === 'ADMIN' ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                              Firm admin
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:col-span-8 xl:grid-cols-4">
                    <MetricCard
                      label="Input tokens"
                      value={formatNumber(detailUser.usage?.inputTokens)}
                      helper="Prompt tokens in this range"
                    />
                    <MetricCard
                      label="Output tokens"
                      value={formatNumber(detailUser.usage?.outputTokens)}
                      helper="Response tokens in this range"
                    />
                    <MetricCard
                      label="Total tokens"
                      value={formatNumber(detailUser.usage?.totalTokens)}
                      helper={`${formatNumber(detailUser.usage?.requestCount)} requests`}
                    />
                    <MetricCard
                      label="Current cost"
                      value={formatCurrency(detailUser.usage?.totalCost)}
                      helper={`Across ${selectedUser.range}`}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                  <DetailActivityCard
                    label="Case docs / cases"
                    value={`${formatNumber(detailUser.documentsUploaded)} / ${formatNumber(detailUser.casesCreated)}`}
                    helper="Documents inside created cases / cases created"
                    accentClass="from-[#2563EB]/12 to-white"
                  />
                  <DetailActivityCard
                    label="Assigned cases"
                    value={formatNumber(detailUser.assignedCases)}
                    helper="Cases currently assigned to this member"
                    accentClass="from-[#F59E0B]/14 to-white"
                  />
                  <DetailActivityCard
                    label="Last login"
                    value={formatDateTime(detailUser.lastLoginAt)}
                    helper="Latest successful authentication"
                    accentClass="from-[#10B981]/12 to-white"
                  />
                  <DetailActivityCard
                    label="Last seen"
                    value={formatDateTime(detailUser.lastSeenAt)}
                    helper={presence.helper || 'Latest heartbeat from active session'}
                    accentClass="from-[#14B8A6]/12 to-white"
                  />
                  <DetailActivityCard
                    label="Average active time"
                    value={formatDurationMinutes(detailUser.activityMetrics?.averageActiveMinutes)}
                    helper={
                      detailUser.activityMetrics?.activeDays
                        ? `Average active window across ${formatNumber(detailUser.activityMetrics.activeDays)} usage day${detailUser.activityMetrics.activeDays === 1 ? '' : 's'}`
                        : 'Calculated from first and last token activity per active day'
                    }
                    accentClass="from-[#8B5CF6]/10 to-white"
                  />
                  <DetailActivityCard
                    label="Latest upload"
                    value={formatDateTime(detailUser.latestUploadAt)}
                    helper={`${formatBytes(detailUser.uploadedBytes)} stored in created cases`}
                    accentClass="from-[#EF4444]/10 to-white"
                  />
                </div>
              </div>

              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
                <TrendChart items={selectedUser.usageTrend || []} />

                <TokenCompositionCard
                  inputTokens={detailUser.usage?.inputTokens}
                  outputTokens={detailUser.usage?.outputTokens}
                />
              </div>

              <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
                  <h4 className="text-lg font-semibold text-slate-900">Monthly token cap</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Set an optional monthly cap for this member. The cap is enforced on total tokens, while input and output usage are shown separately for visibility.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <MetricCard
                      label="Input used"
                      value={formatNumber(tokenCap.usedThisMonthInputTokens)}
                      helper="Current month prompt tokens"
                    />
                    <MetricCard
                      label="Output used"
                      value={formatNumber(tokenCap.usedThisMonthOutputTokens)}
                      helper="Current month response tokens"
                    />
                    <MetricCard
                      label="Total used"
                      value={formatNumber(tokenCap.usedThisMonthTotalTokens ?? tokenCap.usedThisMonth)}
                      helper="Current month billable tokens"
                    />
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    This month: {formatNumber(tokenCap.usedThisMonthTotalTokens ?? tokenCap.usedThisMonth)} total used
                    {tokenCap.monthlyTokenLimit
                      ? ` • ${formatNumber(tokenCap.remainingThisMonth)} remaining`
                      : ' • Unlimited'}
                  </div>

                  <div className="mt-5 grid gap-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Monthly token limit</span>
                      <input
                        type="number"
                        min="0"
                        value={capDraft}
                        onChange={(event) => setCapDraft(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#6DD5CD] focus:ring-2 focus:ring-[#CFF6F2]"
                        placeholder="Leave blank for unlimited"
                        disabled={detailUser.membershipRole === 'ADMIN'}
                      />
                    </label>

                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={hardStopEnabled}
                        onChange={(event) => setHardStopEnabled(event.target.checked)}
                        disabled={detailUser.membershipRole === 'ADMIN'}
                      />
                      Stop requests when the cap is exceeded
                    </label>

                    <button
                      onClick={saveTokenCap}
                      disabled={savingCap || detailUser.membershipRole === 'ADMIN'}
                      className="inline-flex items-center justify-center rounded-2xl bg-[#1AA49B] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(26,164,155,0.22)] transition hover:bg-[#15867F] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingCap ? 'Saving...' : 'Save token cap'}
                    </button>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900">Created cases</h4>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Review cases created by this member and the document footprint inside each case folder.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
                      {formatNumber(detailUser.casesCreated)} case{detailUser.casesCreated === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {detailUser.createdCases?.length ? detailUser.createdCases.map((caseItem) => (
                      <div
                        key={caseItem.caseId}
                        className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-slate-50/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-base font-semibold text-slate-900">{caseItem.caseTitle || 'Untitled case'}</div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {caseItem.status || 'Unknown'}
                            </span>
                          </div>
                          <div className="mt-2 text-sm text-slate-500">
                            Created {formatDateTime(caseItem.createdAt)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Latest upload: {formatDateTime(caseItem.latestUploadAt)}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
                          <MetricCard
                            label="Documents"
                            value={formatNumber(caseItem.documentsCount)}
                            helper="Documents inside this case"
                          />
                          <MetricCard
                            label="Storage"
                            value={formatBytes(caseItem.uploadedBytes)}
                            helper="Uploaded file size"
                          />
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
                        No cases created by this member in the selected range.
                      </div>
                    )}
                  </div>
                </div>
              </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FirmAnalyticsTab = () => {
  const [range, setRange] = useState('30d');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('tokens_desc');
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [capDraft, setCapDraft] = useState('');
  const [hardStopEnabled, setHardStopEnabled] = useState(true);
  const [savingCap, setSavingCap] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const loadAnalytics = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [summaryResponse, usersResponse] = await Promise.all([
        fetchFirmAnalyticsSummary(range),
        fetchFirmAnalyticsUsers({ range, search: deferredSearch, sortBy }),
      ]);

      setSummary(summaryResponse.data || null);
      setRows(usersResponse.data?.users || []);
    } catch (error) {
      console.error('[FirmAnalyticsTab] Failed to load analytics:', {
        range,
        search: deferredSearch,
        sortBy,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        stack: error.stack,
      });

      if (!silent) {
        toast.error(error.response?.data?.message || 'Failed to load firm analytics.');
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const loadUserDetail = async (userId, { silent = false, preserveDraft = false } = {}) => {
    if (!userId) return;

    if (silent) {
      setDetailRefreshing(true);
    } else {
      setDetailLoading(true);
    }

    try {
      const response = await fetchFirmAnalyticsUserDetail(userId, range);
      const detail = response.data;
      setSelectedUser(detail);

      if (!preserveDraft) {
        setCapDraft(
          detail?.user?.tokenCap?.monthlyTokenLimit
            ? String(detail.user.tokenCap.monthlyTokenLimit)
            : ''
        );
        setHardStopEnabled(detail?.user?.tokenCap?.hardStopEnabled !== false);
      }
    } catch (error) {
      console.error('[FirmAnalyticsTab] Failed to load user detail:', {
        userId,
        range,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        stack: error.stack,
      });

      if (!silent) {
        toast.error(error.response?.data?.message || 'Failed to load user analytics detail.');
      }
    } finally {
      if (silent) {
        setDetailRefreshing(false);
      } else {
        setDetailLoading(false);
      }
    }
  };

  useEffect(() => {
    let disposed = false;

    const runInitialLoad = async () => {
      if (!disposed) {
        await loadAnalytics({ silent: false });
      }
    };

    runInitialLoad();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !disposed) {
        loadAnalytics({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !disposed) {
        loadAnalytics({ silent: true });
      }
    }, AUTO_REFRESH_MS);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [range, deferredSearch, sortBy]);

  useEffect(() => {
    const selectedUserId = selectedUser?.user?.userId;
    if (!selectedUserId) return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadUserDetail(selectedUserId, { silent: true, preserveDraft: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadUserDetail(selectedUserId, { silent: true, preserveDraft: true });
      }
    }, AUTO_REFRESH_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [selectedUser?.user?.userId, range]);

  const openUserDetail = async (userId) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadUserDetail(userId);
  };

  const closeUserDetail = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSelectedUser(null);
    setCapDraft('');
    setHardStopEnabled(true);
  };

  const saveTokenCap = async () => {
    if (!selectedUser?.user?.userId) return;

    setSavingCap(true);
    try {
      const monthlyTokenLimit = capDraft === '' ? null : Number(capDraft);
      const response = await updateFirmUserTokenLimit(selectedUser.user.userId, {
        monthlyTokenLimit,
        hardStopEnabled,
      });

      const updatedCap = response.data?.tokenCap || null;
      setSelectedUser((prev) => ({
        ...prev,
        user: {
          ...prev.user,
          tokenCap: updatedCap || prev.user.tokenCap,
        },
      }));

      toast.success('Token cap updated successfully.');
      await loadAnalytics({ silent: true });
    } catch (error) {
      console.error('[FirmAnalyticsTab] Failed to update token cap:', {
        userId: selectedUser?.user?.userId,
        capDraft,
        hardStopEnabled,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        stack: error.stack,
      });
      toast.error(error.response?.data?.message || 'Failed to update token cap.');
    } finally {
      setSavingCap(false);
    }
  };

  const summaryMetrics = summary?.summary || {};
  const liveUsers = useMemo(
    () => rows.filter((row) => getPresenceMeta(row.lastSeenAt, row.firstLogin, row.isActive !== false).live),
    [rows]
  );

  const presenceSegments = useMemo(() => {
    const counters = {
      live: 0,
      recent: 0,
      pending: 0,
      disabled: 0,
    };

    rows.forEach((row) => {
      const presence = getPresenceMeta(row.lastSeenAt, row.firstLogin, row.isActive !== false);
      counters[presence.state] = (counters[presence.state] || 0) + 1;
    });

    return [
      { label: 'Live now', totalUsers: counters.live },
      { label: 'Recently active', totalUsers: counters.recent },
      { label: 'Invite pending', totalUsers: counters.pending },
      { label: 'Disabled', totalUsers: counters.disabled },
    ];
  }, [rows]);

  if (detailLoading || selectedUser) {
    return (
      <DetailModal
        detailLoading={detailLoading}
        detailRefreshing={detailRefreshing}
        selectedUser={selectedUser}
        onClose={closeUserDetail}
        capDraft={capDraft}
        setCapDraft={setCapDraft}
        hardStopEnabled={hardStopEnabled}
        setHardStopEnabled={setHardStopEnabled}
        saveTokenCap={saveTokenCap}
        savingCap={savingCap}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(236,253,250,0.9),rgba(239,246,255,0.92))] shadow-[0_26px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 border-b border-slate-200/80 px-6 py-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1AA49B]">Firm analytics</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
              Live member insights, cost, and case activity
            </h2>
            <p className="mt-3 text-base leading-8 text-slate-600">
              Track who is online right now, how much token usage is building up, how many case documents exist, and keep each firm user inside a monthly budget cap.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {formatNumber(liveUsers.length)} live now
              </span>
                <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Refreshes every 5 seconds
                </span>
              {refreshing ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Syncing…
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={range}
              onChange={(event) => setRange(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none shadow-sm transition focus:border-[#6DD5CD] focus:ring-2 focus:ring-[#CFF6F2]"
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none shadow-sm transition focus:border-[#6DD5CD] focus:ring-2 focus:ring-[#CFF6F2]"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-9">
          <SummaryCard
            eyebrow="Team members"
            value={loading ? '...' : formatNumber(summaryMetrics.totalUsers)}
            helper="All firm accounts in this analytics view"
            tone="teal"
          />
          <SummaryCard
            eyebrow="Live now"
            value={loading ? '...' : formatNumber(liveUsers.length)}
            helper="Heartbeat seen in the last 45 seconds"
            tone="blue"
          />
          <SummaryCard
            eyebrow="Input tokens"
            value={loading ? '...' : formatNumber(summaryMetrics.totalInputTokens)}
            helper={`Prompt usage across ${summary?.range || range}`}
            tone="blue"
          />
          <SummaryCard
            eyebrow="Output tokens"
            value={loading ? '...' : formatNumber(summaryMetrics.totalOutputTokens)}
            helper={`Response usage across ${summary?.range || range}`}
            tone="blue"
          />
          <SummaryCard
            eyebrow="Total tokens"
            value={loading ? '...' : formatNumber(summaryMetrics.totalTokens)}
            helper="Input + output combined"
            tone="blue"
          />
          <SummaryCard
            eyebrow="Total cost"
            value={loading ? '...' : formatCurrency(summaryMetrics.totalCost)}
            helper="LLM usage cost from payment logs"
            tone="rose"
          />
          <SummaryCard
            eyebrow="Case documents"
            value={loading ? '...' : formatNumber(summaryMetrics.totalDocumentsUploaded)}
            helper="Documents found inside created cases"
            tone="teal"
          />
          <SummaryCard
            eyebrow="Cases created"
            value={loading ? '...' : formatNumber(summaryMetrics.totalCasesCreated)}
            helper="Cases created by firm members"
            tone="amber"
          />
          <SummaryCard
            eyebrow="Active caps"
            value={loading ? '...' : formatNumber(summaryMetrics.activeTokenCaps)}
            helper="Members with monthly token caps"
            tone="rose"
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr_1fr]">
        <LiveUsersPanel rows={rows} onView={openUserDetail} />

        <RingChartCard
          title="Presence overview"
          subtitle="A quick split of live users, recent activity, pending invites, and disabled accounts."
          data={{ items: presenceSegments, labelKey: 'label', valueKey: 'totalUsers' }}
          emptyMessage="No member presence data available yet."
          centerLabel="Members"
        />

        <TopUsagePanel rows={rows} />
      </div>

      <div className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:min-w-[420px]">
            <div className="text-slate-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="text-sm text-slate-500">
            {loading ? 'Loading analytics...' : `${rows.length} member${rows.length === 1 ? '' : 's'} in this view`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <th className="px-6 py-4">User</th>
                <th className="px-4 py-4">Plan</th>
                <th className="px-4 py-4">Input</th>
                <th className="px-4 py-4">Output</th>
                <th className="px-4 py-4">Total</th>
                <th className="px-4 py-4">Cost</th>
                <th className="px-4 py-4">Token cap</th>
                <th className="px-4 py-4">Case docs</th>
                <th className="px-4 py-4">Cases</th>
                <th className="px-4 py-4">Assigned</th>
                <th className="px-4 py-4">Last login</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-slate-500">
                    Loading analytics...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-slate-500">
                    No firm analytics found for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const presence = getPresenceMeta(row.lastSeenAt, row.firstLogin, row.isActive !== false);
                  return (
                    <tr key={row.userId} className="transition hover:bg-slate-50/70">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EAF9F8] text-sm font-semibold text-[#15736C]">
                            {getInitials(row.username || row.email)}
                            <span className={`absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${presence.dotClass}`} />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">{row.username}</span>
                              {row.membershipRole === 'ADMIN' ? (
                                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                                  Firm Admin
                                </span>
                              ) : null}
                              <PresencePill presence={presence} />
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{row.email}</div>
                            <div className="mt-1 text-[11px] text-slate-400">{presence.helper}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{getPlanLabel(row.effectivePlan)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatNumber(row.usage.inputTokens)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatNumber(row.usage.outputTokens)}</td>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">{formatNumber(row.usage.totalTokens)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatCurrency(row.usage.totalCost)}</td>
                      <td className="px-4 py-4"><CapBadge tokenCap={row.tokenCap} /></td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatNumber(row.documentsUploaded)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatNumber(row.casesCreated)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatNumber(row.assignedCases)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatDateTime(row.lastLoginAt)}</td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => openUserDetail(row.userId)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-[#A8E8E3] hover:text-[#1AA49B]"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FirmAnalyticsTab;
