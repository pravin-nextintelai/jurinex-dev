/**
 * LLM quota copy. Per-user chat limits use a rolling 24-hour window (all sessions combined).
 */

import { UPGRADE_LIMIT_SHORT } from './planUpgrade';

const IST_TZ = 'Asia/Kolkata';

function withUpgradeHint(body) {
  const b = String(body || '').trim();
  if (!b) return UPGRADE_LIMIT_SHORT;
  if (b.toLowerCase().includes('upgrade')) return b;
  return `${b} ${UPGRADE_LIMIT_SHORT}`;
}

export function formatUtcIsoInIST(isoUtc) {
  if (!isoUtc) return '';
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function buildDailyTokenPoolExceededMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const used = details?.used_tokens_last_24h ?? details?.used_tokens_today;
  const limit = details?.limit;

  let body = "You've used all available tokens for the last 24 hours.";
  if (Number.isFinite(Number(used)) && Number.isFinite(Number(limit))) {
    body += ` Usage: ${Number(used).toLocaleString()} / ${Number(limit).toLocaleString()} tokens.`;
  }
  if (
    details?.reset_basis === 'rolling_24h_global_tokens' ||
    details?.reset_basis === 'rolling_24h_per_user_tokens'
  ) {
    body += ' This is a rolling 24-hour window.';
    if (ist) body += ` Quota frees up by ${ist} IST.`;
  } else if (ist) {
    body += ` Resets at ${ist} IST.`;
  } else {
    body += ' Resets at midnight IST.';
  }
  return {
    title: 'Token Limit Reached',
    body: withUpgradeHint(body),
    isLimit: true,
    limitType: 'tokens',
    showUpgrade: true,
  };
}

export function buildDailyChatQuotaMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const lim = details?.limit_per_24h ?? details?.limit_per_day;
  const used = details?.used_last_24h ?? details?.used_today;

  let body = "You've reached your daily chat quota.";
  if (Number.isFinite(Number(lim)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${lim} chats used.)`;
  }
  if (details?.reset_basis === 'rolling_24h_per_user') {
    body += ' This is a rolling 24-hour window.';
    if (ist) body += ` Quota frees up by ${ist} IST.`;
  } else if (ist) {
    body += ` Resets at ${ist} IST.`;
  } else {
    body += ' Resets at midnight IST.';
  }
  return {
    title: 'Daily Chat Limit Reached',
    body: withUpgradeHint(body),
    isLimit: true,
    limitType: 'daily',
    showUpgrade: true,
  };
}

export function buildPerMinuteQuotaMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const limit = details?.limit_per_minute;
  const used = details?.used_last_minute;

  let body = "You've sent too many chats in a short time.";
  if (Number.isFinite(Number(limit)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${limit} per minute.)`;
  }
  if (ist) {
    body += ` Try again after ${ist} IST.`;
  } else {
    body += ' Please wait a moment and try again.';
  }
  return {
    title: 'Slow Down a Bit',
    body: withUpgradeHint(body),
    isLimit: true,
    limitType: 'minute',
    showUpgrade: true,
  };
}

export function buildPerHourQuotaMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const limit = details?.limit_per_hour;
  const used = details?.used_last_hour;

  let body = "You've reached the hourly message limit for your account.";
  if (Number.isFinite(Number(limit)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${limit} messages this hour.)`;
  }
  if (ist) {
    body += ` Try again after ${ist} IST.`;
  } else {
    body += ' Please try again in an hour.';
  }
  return {
    title: 'Hourly Limit Reached',
    body: withUpgradeHint(body),
    isLimit: true,
    limitType: 'hour',
    showUpgrade: true,
  };
}

/**
 * Map ChatModel API errors to a user-facing { title, body, isLimit } object, or null if not a quota error.
 * @param {Error & { code?: string, details?: object, response?: { data?: object } }} error
 * @returns {{ title: string, body: string, isLimit: true, limitType: string } | null}
 */
export function getChatModelQuotaUserMessage(error) {
  const raw = error?.response?.data || {};
  const data = (raw && typeof raw === 'object' && raw.detail && typeof raw.detail === 'object')
    ? raw.detail
    : raw;
  const code = error?.code || data.code;
  const details = error?.details ?? data.details;

  if (code === 'MONTHLY_TOKEN_LIMIT_EXHAUSTED') {
    const used = details?.tokens_used_this_month;
    const limit = details?.monthly_token_limit;
    let body = "You've used all your monthly token allowance across Chat, Documents, Citations, and Drafting.";
    if (Number.isFinite(Number(used)) && Number.isFinite(Number(limit))) {
      body += ` (${Number(used).toLocaleString()} / ${Number(limit).toLocaleString()} tokens used this billing period.)`;
    }
    body += ' Purchase a token top-up to continue now, upgrade your plan, or wait until your next billing date.';
    return {
      title: 'Monthly Token Limit Reached',
      body,
      isLimit: true,
      limitType: 'tokens',
      showUpgrade: true,
    };
  }
  if (code === 'DAILY_GLOBAL_TOKEN_POOL_EXHAUSTED' || code === 'RATE_LIMIT_TOTAL_TOKENS_PER_DAY') {
    return buildDailyTokenPoolExceededMessage(details);
  }
  if (code === 'RATE_LIMIT_CHATS_PER_DAY') {
    return buildDailyChatQuotaMessage(details);
  }
  if (code === 'RATE_LIMIT_PER_MINUTE') {
    return buildPerMinuteQuotaMessage(details);
  }
  if (code === 'RATE_LIMIT_MESSAGES_PER_HOUR') {
    return buildPerHourQuotaMessage(details);
  }
  if (code === 'POLICY_CHECK_UNAVAILABLE') {
    return {
      title: 'Please try again',
      body:
        (typeof data.message === 'string' && data.message.trim()) ||
        "We couldn't verify usage limits right now. Please try again in a moment.",
      isLimit: false,
      limitType: 'unknown',
    };
  }
  return null;
}

/**
 * Plain string for folder intelligent-chat / agentic policy errors (429/503 JSON body).
 * Matches ChatModel-style { code, message, details } from LLMChatPolicyMiddleware.
 * @param {number} status - HTTP status
 * @param {object} [body] - Parsed JSON response body
 * @returns {string}
 */
export function getLlmPolicyErrorUserText(status, body) {
  const data = (body && typeof body === 'object' && body.detail && typeof body.detail === 'object')
    ? body.detail
    : body;
  if (data && typeof data === 'object') {
    const quota = getChatModelQuotaUserMessage({
      response: { data },
      code: data.code,
      details: data.details,
    });
    if (quota?.body) return quota.body;
    // Check for upload-policy error codes and return a plan-context message
    if (data.code) {
      const uploadMsg = formatUploadPolicyError(data.code, data.details || {});
      if (uploadMsg) return uploadMsg;
    }
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  }
  if (status === 429) {
    return "You've reached a usage limit (too many messages or chats in this period). Please wait a bit and try again.";
  }
  if (status === 503) {
    return "The service couldn't verify your usage limits. Please try again shortly.";
  }
  return '';
}

/** Extract a plain string from an error value (handles both string and { title, body } objects). */
export function errorToString(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err.body) return err.body;
  return String(err);
}

/** Generic non-quota error card (same shape as quota messages for shared UI). */
export function stringToChatErrorDisplay(body, title = 'Something went wrong') {
  const b = typeof body === 'string' ? body : String(body ?? '');
  return { title, body: b || 'An error occurred', isLimit: false, limitType: 'unknown' };
}

/**
 * Normalize folder-chat / policy HTTP errors to the same { title, body, isLimit, limitType } shape as ChatModel.
 * @param {number} status
 * @param {object} [body] - Parsed JSON response body
 * @returns {{ title: string, body: string, isLimit: boolean, limitType: string }}
 */
export function parseLlmPolicyErrorForUi(status, body) {
  const data = (body && typeof body === 'object' && body.detail && typeof body.detail === 'object')
    ? body.detail
    : body;
  if (data && typeof data === 'object') {
    const quota = getChatModelQuotaUserMessage({
      response: { data },
      code: data.code,
      details: data.details,
    });
    if (quota) return quota;
  }
  let text = getLlmPolicyErrorUserText(status, data);
  if (!text && data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message.trim()) text = data.message.trim();
    else if (typeof data.error === 'string' && data.error.trim()) text = data.error.trim();
  }
  if (!text) text = `Something went wrong (${status}).`;

  if (status === 429) {
    return {
      title: 'Usage limit',
      body: withUpgradeHint(text),
      isLimit: true,
      limitType: 'minute',
      showUpgrade: true,
    };
  }
  return stringToChatErrorDisplay(text);
}

/**
 * Accept string or display object (for backward compatibility).
 * @returns {{ title: string, body: string, isLimit: boolean, limitType: string } | null}
 */
export function coerceChatErrorDisplay(input) {
  if (input == null) return null;
  if (typeof input === 'object' && input.body != null && input.title != null) {
    const isLimit = !!input.isLimit;
    return {
      title: String(input.title),
      body: String(input.body),
      isLimit,
      limitType: input.limitType || 'unknown',
      showUpgrade: input.showUpgrade ?? isLimit,
    };
  }
  if (typeof input === 'string') {
    return stringToChatErrorDisplay(input);
  }
  const quota = getChatModelQuotaUserMessage(input);
  if (quota) return quota;
  if (typeof input === 'object' && typeof input.message === 'string' && input.message.trim()) {
    return stringToChatErrorDisplay(input.message.trim());
  }
  return stringToChatErrorDisplay(String(input));
}

function _unwrapErrorBody(body) {
  if (body && typeof body === 'object' && body.detail && typeof body.detail === 'object') {
    return body.detail;
  }
  return body || {};
}

/**
 * Translate upload-policy error codes into a user-friendly message that explains
 * the plan limit.
 *
 * @param {string} code   - e.g. "DOCUMENT_TOO_MANY_PAGES"
 * @param {object} details - the `details` object from the policy error payload
 * @param {string} [planName] - optional plan display name (e.g. "Free", "Pro")
 * @returns {string|null} formatted string, or null if code is unknown
 */
export function formatUploadPolicyError(code, details = {}, planName) {
  const name = planName || details?.plan_name || null;
  const plan = name ? `Your ${name} plan allows` : 'Your plan allows';

  switch (code) {
    case 'DOCUMENT_TOO_MANY_PAGES': {
      const pages = details?.pages;
      const max = details?.max_pages;
      if (max != null && pages != null) {
        return `${plan} a maximum of ${max} pages per document. This document has ${pages} pages — please upload a shorter file or upgrade your plan.`;
      }
      if (max != null) {
        return `${plan} a maximum of ${max} pages per document. Please upload a shorter file.`;
      }
      return 'This document exceeds the page limit for your plan. Please upload a shorter file.';
    }
    case 'FILE_TOO_LARGE': {
      const maxMb = details?.max_mb;
      const sizeBytes = details?.size_bytes;
      const sizeMb = sizeBytes ? (sizeBytes / (1024 * 1024)).toFixed(1) : null;
      if (maxMb != null && sizeMb != null) {
        return `${plan} a maximum file size of ${maxMb} MB. This file is ${sizeMb} MB — please upload a smaller file.`;
      }
      if (maxMb != null) {
        return `${plan} a maximum file size of ${maxMb} MB. Please upload a smaller file.`;
      }
      return 'This file exceeds the size limit for your plan. Please upload a smaller file.';
    }
    case 'DAILY_UPLOAD_LIMIT': {
      const limit = details?.limit_per_24h;
      const used = details?.used_last_24h;
      if (limit != null && used != null) {
        return `${plan} ${limit} file uploads per day. You have used ${used} of ${limit} today — please try again tomorrow or upgrade your plan.`;
      }
      if (limit != null) {
        return `${plan} ${limit} file uploads per day. Daily limit reached — please try again tomorrow.`;
      }
      return 'You have reached your daily upload limit. Please try again tomorrow or upgrade your plan.';
    }
    case 'MAX_UPLOAD_FILES_EXCEEDED': {
      const max = details?.max_upload_files;
      if (max != null) {
        return `${plan} a maximum of ${max} file(s) per upload request. Please upload fewer files at a time.`;
      }
      return 'Too many files in one upload. Please upload fewer files at a time.';
    }
    case 'PDF_INVALID':
      return 'This PDF could not be read. Please check the file and try again.';
    case 'AUDIO_FILE_TOO_LARGE': {
      const maxMb = details?.max_mb;
      if (maxMb != null) {
        return `${plan} a maximum audio file size of ${maxMb} MB. Please upload a smaller audio file.`;
      }
      return 'This audio file exceeds the size limit for your plan.';
    }
    default:
      return null;
  }
}

/**
 * Extract and format an upload policy error from an axios error response.
 * Returns a user-friendly string, or null if the error is not an upload policy error.
 *
 * @param {object} err - axios error (err.response.data contains the payload)
 * @param {string} [planName] - optional plan display name
 * @returns {string|null}
 */
export function extractUploadPolicyErrorMessage(err, planName) {
  const data = err?.response?.data;
  const detail = (data?.detail && typeof data.detail === 'object') ? data.detail : data;
  if (!detail || typeof detail !== 'object') return null;

  const code = detail?.code;
  const details = detail?.details;

  if (!code) return null;

  const formatted = formatUploadPolicyError(code, details || {}, planName);
  if (formatted) return formatted;

  // Fallback: return the raw server message if code is unrecognised but present
  if (typeof detail?.message === 'string' && detail.message.trim()) {
    return detail.message.trim();
  }
  return null;
}

/**
 * Generic user-friendly message for API/network errors.
 * Distinguishes quota/token failures from file/upload failures.
 */
export function getUserFriendlyApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const status = Number(error?.response?.status || error?.status || 0);
  const body = _unwrapErrorBody(error?.response?.data || {});
  const rawMessage = String(
    body?.message ||
    body?.error ||
    error?.message ||
    ''
  ).trim();

  if (status === 429 || /status code 429/i.test(rawMessage)) {
    return getLlmPolicyErrorUserText(429, body) ||
      "You've reached a usage limit. Please wait a bit and try again.";
  }

  if (status === 413) {
    return 'The file is too large for your current upload limits. Please upload a smaller file.';
  }
  if (status === 415) {
    return 'This file type is not supported. Please upload a supported document format.';
  }
  if (status === 404) {
    return 'The requested file or resource was not found.';
  }

  const m = rawMessage.toLowerCase();
  if (m.includes('token') && (m.includes('limit') || m.includes('quota') || m.includes('exhaust'))) {
    return "Your token limit has been reached. Please try again later or upgrade your plan.";
  }
  if (m.includes('file') || m.includes('upload') || m.includes('document')) {
    return rawMessage || 'There was a problem with the file. Please check the file and try again.';
  }

  return rawMessage || fallback;
}
