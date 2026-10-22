/**
 * Shared token quota error helpers — same pool across ChatModel, agentic-document,
 * citation-service, and agent-draft-service.
 */

import { getChatModelQuotaUserMessage } from './llmQuotaMessages';

export const QUOTA_ERROR_CODES = new Set([
  'MONTHLY_TOKEN_LIMIT_EXHAUSTED',
  'RATE_LIMIT_TOTAL_TOKENS_PER_DAY',
  'TOKEN_LIMIT_PER_DAY',
  'DAILY_GLOBAL_TOKEN_POOL_EXHAUSTED',
]);

function unwrapBody(body) {
  if (body && typeof body === 'object' && body.detail && typeof body.detail === 'object') {
    return body.detail;
  }
  return body && typeof body === 'object' ? body : {};
}

export function isQuotaErrorCode(code) {
  return QUOTA_ERROR_CODES.has(String(code || '').trim());
}

export function parseQuotaHttpError(status, body) {
  if (status !== 429 && status !== 503) return null;
  const data = unwrapBody(body);
  const code = data.code;
  if (!code) return null;
  // TOKEN_CHECK_UNAVAILABLE means the payment service is temporarily unreachable —
  // it is a service availability issue, NOT a quota exhaustion. Return null so the
  // caller treats it as a plain HTTP error instead of triggering the quota modal.
  if (code === 'TOKEN_CHECK_UNAVAILABLE') return null;
  if (status === 429 || isQuotaErrorCode(code)) {
    return {
      code,
      message: data.message || 'Token limit reached.',
      details: data.details || {},
    };
  }
  return null;
}

export function createQuotaError(quotaPayload, status = 429) {
  const err = new Error(quotaPayload.message || 'Token limit reached.');
  err.code = quotaPayload.code;
  err.details = quotaPayload.details || {};
  err.isQuotaError = true;
  err.status = status;
  err.response = { status, data: quotaPayload };
  return err;
}

export async function throwIfQuotaResponse(response, fallbackMessage = 'Request failed') {
  const body = await response.json().catch(() => ({}));
  const quota = parseQuotaHttpError(response.status, body);
  if (quota) {
    throw createQuotaError(quota, response.status);
  }
  if (!response.ok) {
    const data = unwrapBody(body);
    const msg =
      (typeof data.message === 'string' && data.message.trim()) ||
      (typeof data.error === 'string' && data.error.trim()) ||
      (typeof data.detail === 'string' && data.detail.trim()) ||
      fallbackMessage;
    const err = new Error(msg);
    err.status = response.status;
    err.response = { status: response.status, data: body };
    throw err;
  }
}

export function normalizeQuotaErrorForModal(error) {
  if (!error) return null;
  const display = getChatModelQuotaUserMessage(error);
  if (display) return display;
  if (error.isQuotaError || isQuotaErrorCode(error.code)) {
    return getChatModelQuotaUserMessage({
      code: error.code,
      details: error.details,
      response: { data: { code: error.code, message: error.message, details: error.details } },
    });
  }
  return null;
}

export function isQuotaError(error) {
  return !!(error?.isQuotaError || isQuotaErrorCode(error?.code) || normalizeQuotaErrorForModal(error));
}
