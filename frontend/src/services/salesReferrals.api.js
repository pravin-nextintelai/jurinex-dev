/**
 * Sales Referrals — customer-side API.
 * GET /api/public/referrals/{code}/status
 *   → 200 { code, status: 'ACTIVE' | 'INACTIVE' | 'NOT_FOUND' | 'INVALID_FORMAT', owner?: { name } }
 *
 * Resolves to { status, ownerName }. Rejects with { code: 'RATE_LIMITED' } on 429 and
 * { code: 'NETWORK' } when no usable answer came back; the field then shows
 * "We couldn't check this code right now."
 */
import { AUTH_SERVICE_URL } from '../config/apiConfig';

export const REFERRAL_STATUSES = ['ACTIVE', 'INACTIVE', 'NOT_FOUND', 'INVALID_FORMAT'];

export function referralCodeStatusUrl(code) {
  return `${AUTH_SERVICE_URL}/api/public/referrals/${encodeURIComponent(code)}/status`;
}

export async function checkReferralCode(code, { signal } = {}) {
  const url = referralCodeStatusUrl(code);
  let response;
  try {
    response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  } catch (err) {
    const e = new Error('Referral code check failed');
    e.code = err && err.name === 'AbortError' ? 'ABORTED' : 'NETWORK';
    throw e;
  }
  if (response.status === 429) {
    const e = new Error('Too many attempts. Try again in a minute.');
    e.code = 'RATE_LIMITED';
    throw e;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body || !REFERRAL_STATUSES.includes(body.status)) {
    const e = new Error('Referral code check failed');
    e.code = 'NETWORK';
    throw e;
  }
  return { status: body.status, ownerName: body.owner && body.owner.name ? String(body.owner.name) : '' };
}

export default { checkReferralCode };
