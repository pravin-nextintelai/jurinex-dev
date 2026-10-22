import React, { useState } from 'react';
import { Zap, CreditCard, X, AlertTriangle, Battery } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SUBSCRIPTION_PLANS_PATH } from '@/shared/utils/planUpgrade';
import TokenTopupModal from './TokenTopupModal';

/**
 * Rendered as a normal flex child inside MainLayout's column, so it naturally
 * pushes the sidebar+content row down without any position:fixed overlap.
 */
export default function TokenExhaustionBanner({ quotaStatus, onTopupSuccess }) {
  const navigate = useNavigate();
  const [showTopup, setShowTopup] = useState(false);
  const [exhaustionDismissed, setExhaustionDismissed] = useState(false);
  const [topupDismissed, setTopupDismissed] = useState(false);

  const [freeDismissed, setFreeDismissed]         = useState(false);
  const [freeWarnDismissed, setFreeWarnDismissed] = useState(false);

  if (!quotaStatus) return null;

  const handleTopupSuccess = (balance) => {
    setShowTopup(false);
    setExhaustionDismissed(false);
    setTopupDismissed(false);
    onTopupSuccess?.(balance);
  };

  const topupModal = showTopup && (
    <TokenTopupModal onClose={() => setShowTopup(false)} onSuccess={handleTopupSuccess} />
  );

  const btnBase = {
    border: 'none', borderRadius: 6, padding: '4px 11px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
  };

  const dismissBtn = (onClick) => (
    <button
      onClick={onClick}
      style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.75)', cursor: 'pointer', padding: '0 2px', display: 'flex', marginLeft: 4 }}
      aria-label="Dismiss"
    >
      <X size={14} />
    </button>
  );

  // ── Free tier exhaustion (highest priority) ────────────────────────────────
  const freeTier   = quotaStatus.free_tier;
  const isFreeTier = !!freeTier?.is_free_tier;
  const freePct    = freeTier?.percentage_used ?? 0;

  if (isFreeTier && freeTier.exhausted && !freeDismissed) {
    return (
      <>
        {topupModal}
        <div style={{
          background: 'linear-gradient(90deg,#7c3aed,#6d28d9)',
          color: '#fff', padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, flexShrink: 0,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            <strong>Free quota exhausted</strong> — you&apos;ve used your ₹150 free allowance.
            Upgrade to a plan to continue using all AI features.
          </span>
          <button onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
            style={{ ...btnBase, background: '#21C1B6', color: '#fff' }}>
            <CreditCard size={12} /> Upgrade Plan
          </button>
          {dismissBtn(() => setFreeDismissed(true))}
        </div>
      </>
    );
  }

  if (isFreeTier && freePct >= 80 && !freeTier.exhausted && !freeWarnDismissed) {
    return (
      <div style={{
        background: 'linear-gradient(90deg,#b45309,#d97706)',
        color: '#fff', padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, flexShrink: 0,
      }}>
        <Battery size={14} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, lineHeight: 1.4 }}>
          <strong>Free quota running low</strong> — {Math.round(freePct)}% used (₹{freeTier.used_inr.toFixed(2)} of ₹{freeTier.limit_inr}).
          Upgrade to avoid interruption.
        </span>
        <button onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
          style={{ ...btnBase, background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.35)' }}>
          <CreditCard size={12} /> Upgrade
        </button>
        {dismissBtn(() => setFreeWarnDismissed(true))}
      </div>
    );
  }

  const isMonthlyExhausted = !!quotaStatus.monthly_exhausted;
  const isBlocked = isMonthlyExhausted;

  const topupBalance = quotaStatus.topup_token_balance ?? 0;
  const isUsingTopup = !isBlocked && (
    quotaStatus.source === 'topup' ||
    (!!quotaStatus.plan_exhausted && topupBalance > 0)
  );

  // ── Red — truly blocked (no tokens at all) ──────────────────────────────
  if (isBlocked && !exhaustionDismissed) {
    const message = 'Monthly token allowance exhausted — all AI features are paused. Buy extra tokens or upgrade to continue.';

    return (
      <>
        {topupModal}
        <div style={{
          background: 'linear-gradient(90deg,#b91c1c,#dc2626)',
          color: '#fff', padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, flexShrink: 0,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
          <button onClick={() => setShowTopup(true)} style={{ ...btnBase, background: '#f59e0b', color: '#fff' }}>
            <Zap size={12} /> Buy Tokens
          </button>
          <button onClick={() => { setExhaustionDismissed(true); navigate(SUBSCRIPTION_PLANS_PATH); }} style={{ ...btnBase, background: '#21C1B6', color: '#fff' }}>
            <CreditCard size={12} /> Upgrade
          </button>
          {dismissBtn(() => setExhaustionDismissed(true))}
        </div>
      </>
    );
  }

  // ── Amber — plan exhausted, top-up is covering usage ───────────────────
  if (isUsingTopup && !topupDismissed) {
    const balanceStr = topupBalance.toLocaleString('en-IN');
    const isLow = topupBalance < 5000;

    return (
      <>
        {topupModal}
        <div style={{
          background: isLow ? 'linear-gradient(90deg,#92400e,#b45309)' : 'linear-gradient(90deg,#b45309,#d97706)',
          color: '#fff', padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, flexShrink: 0,
        }}>
          <Battery size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            Plan tokens exhausted — using top-up balance.{' '}
            <strong>{balanceStr} tokens</strong> remaining.
            {isLow ? ' Running low — buy more to avoid interruption.' : ''}
          </span>
          <button onClick={() => setShowTopup(true)} style={{ ...btnBase, background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.35)' }}>
            <Zap size={12} /> Buy More
          </button>
          {dismissBtn(() => setTopupDismissed(true))}
        </div>
      </>
    );
  }

  return null;
}
