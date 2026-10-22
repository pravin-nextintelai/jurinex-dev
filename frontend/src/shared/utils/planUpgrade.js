/** Route for in-app plan comparison / checkout */
export const SUBSCRIPTION_PLANS_PATH = '/subscription-plans';

export const UPGRADE_LIMIT_HINT =
  'Upgrade your plan for higher limits, more chats, and more tokens.';

export const UPGRADE_LIMIT_SHORT = 'Upgrade your plan for higher limits.';

/**
 * True when user has no paid subscription (free / default tier).
 */
export function userShouldSeeUpgradeCta(planInfo) {
  const planId = planInfo?.planId;
  return planId == null || Number(planId) <= 0;
}
