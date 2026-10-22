const PLAN_INFO_KEY = 'userInfo';

export function getStoredUserId() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Read cached plan only when it belongs to the current logged-in user. */
export function readScopedPlanInfo(expectedUserId = getStoredUserId()) {
  try {
    const raw = localStorage.getItem(PLAN_INFO_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (expectedUserId == null) return null;
    if (data.userId == null || String(data.userId) !== String(expectedUserId)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeScopedPlanInfo(userId, planPayload) {
  if (userId == null) return;
  const payload = {
    ...planPayload,
    userId,
    lastFetched: new Date().toISOString(),
  };
  localStorage.setItem(PLAN_INFO_KEY, JSON.stringify(payload));
}

export function clearScopedPlanInfo() {
  localStorage.removeItem(PLAN_INFO_KEY);
}
