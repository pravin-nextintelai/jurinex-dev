import React, { useState } from 'react';
import { X, Clock, AlertCircle, Zap, CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { coerceChatErrorDisplay, formatUtcIsoInIST } from '@/shared/utils/llmQuotaMessages';
import { normalizeQuotaErrorForModal } from '@/shared/utils/quotaError';
import { SUBSCRIPTION_PLANS_PATH } from '@/shared/utils/planUpgrade';
import TokenTopupModal from './TokenTopupModal';

/**
 * Claude-style quota modal — shown when any service hits the shared token pool limit.
 * Offers Upgrade Plan and/or Buy Tokens depending on daily vs monthly exhaustion.
 */
export default function ChatQuotaErrorModal({ error, onDismiss, onTopupSuccess }) {
  const navigate = useNavigate();
  const [showTopup, setShowTopup] = useState(false);

  const display = normalizeQuotaErrorForModal(error) || coerceChatErrorDisplay(error);
  if (!display) return null;

  const { isLimit, title, body, limitType } = display;
  const resetUtc =
    error?.details?.next_reset_utc
    ?? error?.details?.reset_at_utc
    ?? error?.details?.reset_utc
    ?? error?.response?.data?.details?.next_reset_utc
    ?? error?.response?.data?.details?.reset_at_utc;
  const resetIst = formatUtcIsoInIST(resetUtc);
  const limitIcons = { minute: '⏱️', hour: '🕐', daily: '📅', tokens: '🔋' };
  const limitEmoji = isLimit ? limitIcons[limitType] || '🚫' : null;

  const errorCode =
    error?.code ||
    error?.response?.data?.code ||
    error?.response?.rawData?.code ||
    error?.details?.code ||
    '';
  const isMonthlyExhausted = errorCode === 'MONTHLY_TOKEN_LIMIT_EXHAUSTED';

  const showTopupCta = isMonthlyExhausted || (isLimit && limitType === 'tokens');
  const showUpgradeCta = isLimit;

  if (isLimit) {
    return (
      <>
        {showTopup && (
          <TokenTopupModal
            onClose={() => setShowTopup(false)}
            onSuccess={(balance) => {
              setShowTopup(false);
              onTopupSuccess?.(balance);
              onDismiss?.();
            }}
          />
        )}
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[92vw] max-w-md pointer-events-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#cfe1db] overflow-hidden">
            <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <span className="text-xl leading-none">{limitEmoji}</span>
                <h3 className="text-white font-semibold text-sm tracking-wide">{title}</h3>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="text-white/70 hover:text-white transition-colors ml-3"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-[#eef5f2] px-5 py-4">
              <p className="text-sm text-[#2b3528] leading-relaxed">{body}</p>
              <p className="mt-2 text-xs text-[#1f6b5f]/80">
                Your token allowance is shared across Chat, Documents, Citations, and Drafting.
              </p>
              <div className="mt-3 flex items-center space-x-1.5 text-xs text-[#1f6b5f]/70">
                <Clock className="h-3 w-3 shrink-0" />
                <span>
                  {isMonthlyExhausted
                    ? 'Monthly allowance resets on your next billing date'
                    : resetIst
                      ? `Daily allowance resets at ${resetIst} IST`
                      : 'Limits reset automatically'}
                </span>
              </div>
              <div className="mt-4 pt-3 border-t border-[#cfe1db] flex flex-wrap items-center gap-2">
                {showTopupCta && (
                  <button
                    type="button"
                    onClick={() => setShowTopup(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-all duration-150 shadow-sm hover:shadow-md hover:-translate-y-px"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Buy tokens
                  </button>
                )}
                {showUpgradeCta && (
                  <button
                    type="button"
                    onClick={() => {
                      onDismiss?.();
                      navigate(SUBSCRIPTION_PLANS_PATH);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#21C1B6] hover:bg-[#1AA49B] active:bg-[#168a82] text-white text-xs font-semibold rounded-lg transition-all duration-150 shadow-sm hover:shadow-md hover:-translate-y-px"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Upgrade plan
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDismiss}
                  className="ml-auto px-4 py-2 text-[#1f6b5f] hover:text-white hover:bg-[#1f6b5f] text-xs font-medium rounded-lg border border-[#cfe1db] bg-white transition-all duration-150"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[92vw] max-w-md pointer-events-auto">
      <div className="bg-white rounded-xl shadow-xl border border-[#cfe1db] overflow-hidden">
        <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-white flex-shrink-0" />
            <h3 className="text-white font-semibold text-sm">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-white/70 hover:text-white transition-colors ml-3"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="bg-[#eef5f2] px-4 py-3">
          <p className="text-sm text-[#2b3528] leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}
