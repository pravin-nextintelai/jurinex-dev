import { API_BASE_URL, CHAT_MODEL_BASE_URL, DOCS_BASE_URL } from '@/config/apiConfig';

let cache = null;
let inflight = null;

function getAuthToken() {
  const keys = [
    'authToken',
    'token',
    'accessToken',
    'jwt',
    'bearerToken',
    'auth_token',
    'access_token',
    'api_token',
    'userToken',
  ];
  for (const key of keys) {
    const t = localStorage.getItem(key);
    if (t) return t;
  }
  return null;
}

/**
 * Fetch effective upload cap from ChatModel `llm_chat_config` (same source as server enforcement).
 * Tries gateway `/chat/limits` then direct ChatModel `/api/chat/limits`.
 */
export async function fetchLlmChatLimits({ forceRefresh = false } = {}) {
  if (cache && !forceRefresh) return cache;
  if (inflight) return inflight;

  const token = getAuthToken();
  if (!token) {
    throw new Error('Authentication required to load upload limits');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  inflight = (async () => {
    const docs = String(DOCS_BASE_URL || '').replace(/\/$/, '');
    const urls = [
      `${String(API_BASE_URL || '').replace(/\/$/, '')}/chat/limits`,
      `${String(CHAT_MODEL_BASE_URL || '').replace(/\/$/, '')}/api/chat/limits`,
      ...(docs ? [`${docs}/llm-limits`] : []),
    ];

    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', headers });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastErr = new Error(json.message || json.error || `HTTP ${res.status}`);
          continue;
        }
        const data = json.data && typeof json.data === 'object' ? json.data : json;
        if (data && (data.max_upload_bytes != null || data.max_upload_mb != null)) {
          cache = data;
          return cache;
        }
        lastErr = new Error('Invalid limits response');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Failed to load LLM limits');
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function invalidateLlmChatLimitsCache() {
  cache = null;
}

/** @param {Record<string, unknown>} limits - from fetchLlmChatLimits */
export function getMaxUploadBytesFromLimits(limits) {
  if (!limits || typeof limits !== 'object') return null;
  const raw =
    limits.max_upload_bytes != null
      ? Number(limits.max_upload_bytes)
      : limits.max_upload_mb != null
        ? Number(limits.max_upload_mb) * 1024 * 1024
        : limits.max_document_size_mb != null
          ? Number(limits.max_document_size_mb) * 1024 * 1024
          : null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

export function getMaxUploadMbLabel(limits) {
  if (!limits || typeof limits !== 'object') return null;
  if (limits.max_upload_mb != null && Number.isFinite(Number(limits.max_upload_mb))) {
    return String(limits.max_upload_mb);
  }
  const b = getMaxUploadBytesFromLimits(limits);
  if (!b) return null;
  return (b / (1024 * 1024)).toFixed(2);
}

/**
 * Clear copy when a user picks a file larger than the server-configured limit.
 */
export function formatUploadLimitExceededMessage({ fileName, fileSizeFormatted, limitMbLabel }) {
  const limit =
    limitMbLabel != null && String(limitMbLabel).trim() !== ''
      ? `${String(limitMbLabel).trim()} MB`
      : 'the configured limit';
  const name = (fileName && String(fileName).trim()) || 'This file';
  const size = (fileSizeFormatted && String(fileSizeFormatted).trim()) || '';
  const sizePhrase = size ? ` (${size})` : '';
  return `${name}${sizePhrase} is too large. The maximum upload size is ${limit}. Choose a smaller file, or ask your administrator to increase the limit in LLM settings.`;
}
