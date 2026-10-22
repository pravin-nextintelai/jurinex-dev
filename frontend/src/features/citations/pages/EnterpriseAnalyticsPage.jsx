import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Users, FileSearch, Clock, TrendingUp, RefreshCw, AlertCircle, DollarSign } from 'lucide-react';
import citationApi from '../api/citationApi';
import { useAuth } from '@/shared/context';
import { useNavigate } from 'react-router-dom';

const TEAL = '#21C1B6';
const NAVY = '#1B2A4A';

/** Matches backend utils/usage_analytics.COST_STORE_KEYS — admin cost breakdown only */
const COST_STORE_KEYS = ['gemini', 'claude', 'document_ai', 'indian_kanoon', 'serper'];
const COST_STORE_SHORT = {
  gemini: 'Gemini',
  claude: 'Claude',
  document_ai: 'Doc AI',
  indian_kanoon: 'IK',
  serper: 'Serper',
};

function StatCard({ icon: Icon, label, value, sub, color = TEAL }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '20px 24px',
      border: '1px solid #EEF0F4', display: 'flex', alignItems: 'flex-start', gap: 16,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ background: color + '18', borderRadius: 10, padding: 10 }}>
        <Icon size={22} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#0F1A30', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 13, color: '#556275', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: '#8690A2', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function AreaLineChartWithPoints({ data, labelKey, series }) {
  if (!data?.length) return <div style={{ color: '#8690A2', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data yet</div>;
  const maxRaw = Math.max(...data.flatMap(d => series.map(s => d[s.valueKey] || 0)), 1);
  const step = maxRaw <= 200 ? 50 : maxRaw <= 1200 ? 200 : Math.ceil(maxRaw / 6 / 100) * 100;
  const max = Math.ceil(maxRaw / step) * step || step;

  const vbW = 560; const vbH = 260;
  const ml = 52; const mr = 16; const mt = 16; const mb = 32;
  const iW = vbW - ml - mr; const iH = vbH - mt - mb;
  const baseY = mt + iH;
  const yTicks = 6;

  const xFor = (idx) => ml + (iW * (data.length <= 1 ? 0.5 : idx / (data.length - 1)));
  const yFor = (v) => baseY - (iH * Math.min(v, max) / max);

  const smoothPath = (coords) => {
    if (!coords.length) return '';
    if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;
    let d = `M ${coords[0].x},${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const cp1x = (coords[i - 1].x + coords[i].x) / 2;
      d += ` C ${cp1x},${coords[i - 1].y} ${cp1x},${coords[i].y} ${coords[i].x},${coords[i].y}`;
    }
    return d;
  };

  const areaPath = (coords) => {
    if (!coords.length) return null;
    const line = smoothPath(coords);
    const last = coords[coords.length - 1];
    const first = coords[0];
    return `${line} L ${last.x},${baseY} L ${first.x},${baseY} Z`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${vbW} ${vbH}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.valueKey} id={`enterpriseG${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
          </linearGradient>
        ))}
      </defs>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const fraction = i / yTicks;
        const yVal = Math.round(max * fraction);
        const yPos = baseY - iH * fraction;
        return (
          <g key={i}>
            <line x1={ml} y1={yPos} x2={ml + iW} y2={yPos} stroke={i === 0 ? '#E0E4E8' : '#EEF0F4'} strokeWidth={1} />
            <text x={ml - 8} y={yPos + 4} fontSize={10} fill="#8690A2" textAnchor="end" fontFamily="inherit">
              {yVal >= 1000 ? `${Math.round(yVal / 100) / 10}k` : yVal}
            </text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const coords = data.map((d, j) => ({ x: xFor(j), y: yFor(d[s.valueKey] || 0), v: d[s.valueKey] || 0 }));
        const ap = areaPath(coords);
        const lineD = smoothPath(coords);
        return (
          <g key={s.valueKey}>
            {ap && <path d={ap} fill={`url(#enterpriseG${i})`} />}
            {data.length > 1 && <path d={lineD} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
            {coords.map((p, j) => (
              <circle key={j} cx={p.x} cy={p.y} r={4} fill={s.color} stroke="#fff" strokeWidth={2}>
                <title>{data[j][labelKey]}: {p.v} {s.label}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {data.map((d, i) => (
        <text key={i} x={xFor(i)} y={baseY + 18} fontSize={11} fill="#8690A2" textAnchor="middle" fontFamily="inherit">
          {d[labelKey]}
        </text>
      ))}
    </svg>
  );
}

function formatMemberDisplay(r) {
  const username = r.username || r.display_name || r.user_id || 'Unknown';
  const authType = r.auth_type && r.auth_type !== '—' ? r.auth_type : null;
  const role = r.role && r.role !== '—' ? r.role : null;
  const parts = [username];
  if (authType) parts.push(`(${authType})`);
  if (role) parts.push(role);
  return parts.join(' · ');
}

function TeamTable({ rows }) {
  if (!rows?.length) return <div style={{ color: '#8690A2', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No team activity yet</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #EEF0F4' }}>
          {['Member', 'Queries', 'Citations', 'Time Saved'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#556275', fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #F8F9FB' }}>
            <td style={{ padding: '10px 12px', color: '#263040', fontWeight: 500 }} title={r.user_id}>{formatMemberDisplay(r)}</td>
            <td style={{ padding: '10px 12px', color: '#3D4A5C' }}>{r.queries}</td>
            <td style={{ padding: '10px 12px', color: '#3D4A5C' }}>{r.citations}</td>
            <td style={{ padding: '10px 12px', color: '#3D4A5C' }}>{r.time_saved_minutes} min</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EnterpriseAnalyticsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [usageData, setUsageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usageError, setUsageError] = useState(null);
  const [days, setDays] = useState(30);
  const [months, setMonths] = useState(6);
  const [scope, setScope] = useState('firm');

  // Redirect non-admin users (FIRM_ADMIN or SUPER_ADMIN)
  const accountType = (user?.account_type || '').toUpperCase();
  useEffect(() => {
    if (user && accountType !== 'FIRM_ADMIN' && accountType !== 'SUPER_ADMIN') {
      navigate('/dashboard', { replace: true });
    }
  }, [user, accountType, navigate]);

  // Usage & Costs section: FIRM_ADMIN only (super admins do not see it here)
  const showUsageCosts = accountType === 'FIRM_ADMIN';
  useEffect(() => {
    if (accountType === 'FIRM_ADMIN') setScope('firm');
  }, [accountType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await citationApi.getEnterpriseAnalytics(days, months);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [days, months]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const res = await citationApi.getUsageAnalytics(days, scope);
      setUsageData(res);
    } catch (e) {
      setUsageError(e.message || 'Failed to load usage analytics');
    } finally {
      setUsageLoading(false);
    }
  }, [days, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (showUsageCosts) loadUsage();
  }, [loadUsage, showUsageCosts]);

  const summary = data?.summary || {};
  const volumeTrend = data?.volume_trend || [];
  const teamActivity = data?.team_activity || [];

  const timeSavedHrs = Math.round((summary.total_time_saved_minutes || 0) / 60);

  if (accountType && accountType !== 'FIRM_ADMIN' && accountType !== 'SUPER_ADMIN') return null;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart3 size={24} color={TEAL} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F1A30', margin: 0 }}>Enterprise Analytics</h1>
          </div>
          <p style={{ color: '#556275', fontSize: 13, margin: '4px 0 0 34px' }}>Citation usage across your firm</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showUsageCosts && (
            <span style={{ fontSize: 11, color: '#556275' }}>API costs: firm users only</span>
          )}
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            style={{ border: '1px solid #DDE1E8', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#3D4A5C' }}>
            {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button onClick={() => { load(); if (showUsageCosts) loadUsage(); }} disabled={loading || (showUsageCosts && usageLoading)}
            style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} color='#DC2626' />
          <span style={{ color: '#991B1B', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
        <StatCard icon={FileSearch} label="Total Queries" value={loading ? '—' : (summary.total_queries ?? 0)} sub={`Last ${days} days`} />
        <StatCard icon={TrendingUp} label="Citations Generated" value={loading ? '—' : (summary.total_citations ?? 0)} sub={`Last ${days} days`} color="#0D47A1" />
        <StatCard icon={Clock} label="Time Saved" value={loading ? '—' : `${timeSavedHrs} hrs`} sub="~5 min per citation" color="#1B5E20" />
        <StatCard icon={Users} label="Active Users" value={loading ? '—' : (summary.active_users ?? 0)} sub={`Last ${days} days`} color="#E65100" />
      </div>

      {/* Charts row - smooth line chart with points */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, marginBottom: 28 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #EEF0F4', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 600, color: '#1B2A4A', fontSize: 14, marginBottom: 8 }}>Research Volume Trend (Monthly)</div>
          <div style={{ fontSize: 11, color: '#8690A2', marginBottom: 16, display: 'flex', gap: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 24, height: 4, background: '#1B2A4A', borderRadius: 2, display: 'inline-block' }} /> Queries
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 24, height: 4, background: '#1B5E20', borderRadius: 2, display: 'inline-block' }} /> Citations
            </span>
          </div>
          <AreaLineChartWithPoints
            data={volumeTrend}
            labelKey="label"
            series={[
              { valueKey: 'queries', label: 'queries', color: '#1B2A4A' },
              { valueKey: 'citations', label: 'citations', color: '#1B5E20' },
            ]}
          />
        </div>
      </div>

      {/* Team Activity Table */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #EEF0F4', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 28 }}>
        <div style={{ fontWeight: 600, color: '#1B2A4A', fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} color={TEAL} />
          Team Activity
        </div>
        {loading ? (
          <div style={{ color: '#8690A2', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading...</div>
        ) : (
          <TeamTable rows={teamActivity} />
        )}
      </div>

      {/* Usage & Costs — FIRM_ADMIN only; complete data stored per user in DB (not shown to regular users) */}
      {showUsageCosts && (
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #EEF0F4', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 600, color: '#1B2A4A', fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DollarSign size={16} color="#1B5E20" />
          API costs by provider (firm admin only)
          <span style={{ fontSize: 11, fontWeight: 600, background: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 6 }}>Your firm users only</span>
        </div>
        <p style={{ fontSize: 11, color: '#8690A2', margin: '0 0 16px 28px', maxWidth: 720 }}>
          Complete usage data is stored per user in the database. Gemini, Claude, Document AI, Indian Kanoon, and Serper costs are tracked separately for each firm user.
        </p>
        {usageError && (
          <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{usageError}</div>
        )}
        {usageLoading ? (
          <div style={{ color: '#8690A2', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading usage...</div>
        ) : (
          <>
            {usageData?.summary && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1B5E20' }}>
                      ₹{Number(usageData.summary.total_cost_inr || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: 12, color: '#556275' }}>Total (INR)</div>
                  </div>
                  <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1B5E20' }}>
                      ${Number(usageData.summary.total_cost_usd || 0).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12, color: '#556275' }}>Total (USD)</div>
                  </div>
                  <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1B2A4A' }}>{usageData.summary.total_queries ?? 0}</div>
                    <div style={{ fontSize: 12, color: '#556275' }}>Pipeline runs</div>
                  </div>
                  <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#E65100' }}>{usageData.summary.active_users ?? 0}</div>
                    <div style={{ fontSize: 12, color: '#556275' }}>Users with usage</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#556275', marginBottom: 8 }}>Cost by provider (separate)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                  {COST_STORE_KEYS.map((key) => {
                    const cs = usageData.summary.cost_stores?.[key];
                    const label = cs?.label || COST_STORE_SHORT[key];
                    const inr = Number(cs?.cost_inr ?? usageData.summary.by_service?.[key]?.cost_inr ?? 0);
                    return (
                      <div key={key} style={{ background: '#FAFBFC', border: '1px solid #EEF0F4', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, color: '#556275', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0F1A30' }}>₹{inr.toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: '#8690A2' }}>${Number(cs?.cost_usd ?? 0).toFixed(4)}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {usageData?.by_user?.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#556275', marginBottom: 8 }}>Per-user cost by provider (INR)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #EEF0F4' }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: '#556275', fontWeight: 600 }}>User</th>
                      {COST_STORE_KEYS.map((k) => (
                        <th key={k} style={{ textAlign: 'right', padding: '8px 6px', color: '#556275', fontWeight: 600, whiteSpace: 'nowrap' }}>{COST_STORE_SHORT[k]}</th>
                      ))}
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: '#556275', fontWeight: 600 }}>Total</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: '#556275', fontWeight: 600 }}>Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.by_user.map((u, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F8F9FB' }}>
                        <td style={{ padding: '10px 10px', color: '#263040', fontWeight: 500 }}>{u.display_name || u.user_id}</td>
                        {COST_STORE_KEYS.map((k) => {
                          const v = Number(u.cost_stores?.[k]?.cost_inr ?? u.by_service?.[k]?.cost_inr ?? 0);
                          return (
                            <td key={k} style={{ padding: '10px 6px', textAlign: 'right', color: '#3D4A5C' }}>₹{v.toFixed(2)}</td>
                          );
                        })}
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#1B5E20', fontWeight: 600 }}>₹{Number(u.total_cost_inr || 0).toFixed(2)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#3D4A5C' }}>{u.runs ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
