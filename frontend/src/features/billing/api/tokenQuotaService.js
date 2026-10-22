import { PAYMENT_SERVICE_URL } from '@/config/apiConfig';

let cachedQuota = null;
let cacheTs = 0;
const CACHE_MS = 30_000;

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Fetch unified token quota (shared pool across all JuriNex AI services). */
export async function fetchTokenQuotaStatus({ token, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedQuota && now - cacheTs < CACHE_MS) {
    return cachedQuota;
  }

  const authToken = token || localStorage.getItem('token') || localStorage.getItem('authToken');
  const res = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/token-quota-status`, {
    headers: authHeaders(authToken),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.message || 'Failed to load token quota');
  }
  cachedQuota = json.data;
  cacheTs = now;
  return cachedQuota;
}

export function invalidateTokenQuotaCache() {
  cachedQuota = null;
  cacheTs = 0;
}
