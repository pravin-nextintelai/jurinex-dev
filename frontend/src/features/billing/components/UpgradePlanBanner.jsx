import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/shared/context';
import {
  SUBSCRIPTION_PLANS_PATH,
  UPGRADE_LIMIT_HINT,
  userShouldSeeUpgradeCta,
} from '@/shared/utils/planUpgrade';

/**
 * Persistent upgrade strip for free-tier users (Gemini-style), shown above chat inputs.
 */
export default function UpgradePlanBanner({ className = '' }) {
  const navigate = useNavigate();
  const { planInfo } = useAuth();

  if (!userShouldSeeUpgradeCta(planInfo)) return null;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 rounded-xl border border-[#21C1B6]/30 bg-gradient-to-r from-[#eef9f8] to-[#e8f4f1] ${className}`}
      role="status"
    >
      <div className="flex items-start sm:items-center gap-2 min-w-0">
        <Sparkles className="h-4 w-4 text-[#21C1B6] shrink-0 mt-0.5 sm:mt-0" aria-hidden />
        <p className="text-xs sm:text-sm text-[#2b3528] leading-snug">
          <span className="font-semibold text-[#1f6b5f]">Free plan</span>
          <span className="text-[#2b3528]/85"> — {UPGRADE_LIMIT_HINT}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
        className="shrink-0 self-start sm:self-center px-3 py-1.5 bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm"
      >
        Upgrade plan
      </button>
    </div>
  );
}
