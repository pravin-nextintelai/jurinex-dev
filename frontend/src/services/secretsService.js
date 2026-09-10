import {
  SECRET_PROMPTS_API_BASE,
  CHAT_MODEL_BASE_URL,
  GATEWAY_BASE_URL,
  DOCS_BASE_URL,
} from '../config/apiConfig';

const CACHE_KEY = 'jurinex_secrets_list_v1';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let memoryCache = null;
let memoryCacheAt = 0;
let inflightListRequest = null;

function getAuthToken() {
  const tokenKeys = [
    'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
    'auth_token', 'access_token', 'api_token', 'userToken',
  ];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
}

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.at) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSessionCache(data) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, at: Date.now() })
    );
  } catch {
    /* ignore quota errors */
  }
}

/** Instant list for UI (memory → sessionStorage). Does not hit the network. */
export function peekSecretsList() {
  if (memoryCache?.length && Date.now() - memoryCacheAt < CACHE_TTL_MS) {
    return memoryCache;
  }
  const fromSession = readSessionCache();
  if (fromSession?.length) {
    memoryCache = fromSession;
    memoryCacheAt = Date.now();
    return fromSession;
  }
  return memoryCache?.length ? memoryCache : null;
}

export function invalidateSecretsListCache() {
  memoryCache = null;
  memoryCacheAt = 0;
  inflightListRequest = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function buildSecretsApiBases() {
  const seen = new Set();
  const bases = [];

  const add = (raw) => {
    const base = String(raw || '').trim().replace(/\/$/, '');
    if (!base || seen.has(base)) return;
    seen.add(base);
    bases.push(base);
  };

  add(SECRET_PROMPTS_API_BASE);
  add(`${GATEWAY_BASE_URL}/chat`);
  // agentic-chat-service direct. It resolves the caller's plan itself, so it is
  // tried before the document service, whose /secrets returns [] when the
  // gateway-injected x-user-plan-id header is absent (direct calls).
  const chatHost = String(CHAT_MODEL_BASE_URL || '').replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
  if (chatHost) add(`${chatHost}/api/chat`);
  add(DOCS_BASE_URL);

  return bases;
}

async function requestSecretsFromApi(includeValues) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const query = `fetch=${includeValues ? 'true' : 'false'}`;
  const bases = buildSecretsApiBases();
  let lastStatus = null;
  let lastError = null;
  let sawEmptyList = false;

  for (const base of bases) {
    const url = `${base}/secrets?${query}`;
    try {
      const response = await fetch(url, { method: 'GET', headers });
      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length) return data;
        // An empty list may just mean this host could not resolve the plan —
        // keep going; a later base may know better. Return [] only at the end.
        sawEmptyList = true;
        continue;
      }
      // 404/405: this host does not serve the secrets route (e.g. a gateway
      // whose CHAT_SERVICE_URL is unset) — fall through to the next base.
      // 502/503/504: upstream unavailable — same.
      if ([404, 405, 502, 503, 504].includes(response.status)) {
        continue;
      }
      throw new Error(`Failed to fetch secrets: ${response.status}`);
    } catch (err) {
      lastError = err;
      if (err instanceof TypeError) {
        continue;
      }
      if (String(err.message || '').includes('Failed to fetch secrets:')) {
        throw err;
      }
    }
  }

  if (sawEmptyList) {
    return [];
  }
  if (lastStatus != null) {
    throw new Error(`Failed to fetch secrets: ${lastStatus}`);
  }
  throw lastError || new Error('Failed to fetch secrets: network error');
}

/**
 * Load analysis prompt metadata (names/ids). Values are fetched on-demand when a prompt runs.
 * Uses in-memory + sessionStorage cache and dedupes concurrent requests.
 */
export async function fetchSecretsList({ includeValues = false, forceRefresh = false } = {}) {
  const canUseCache = !includeValues && !forceRefresh;

  if (canUseCache) {
    const cached = peekSecretsList();
    if (cached?.length) {
      void fetchSecretsList({ includeValues: false, forceRefresh: true }).catch(() => {});
      return cached;
    }
  }

  if (inflightListRequest) {
    return inflightListRequest;
  }

  inflightListRequest = (async () => {
    const rows = await requestSecretsFromApi(includeValues);
    if (!includeValues && rows.length) {
      memoryCache = rows;
      memoryCacheAt = Date.now();
      writeSessionCache(rows);
    }
    return rows;
  })();

  try {
    return await inflightListRequest;
  } finally {
    inflightListRequest = null;
  }
}

/** Full prompt body for a single secret (used when backend needs client-side value). */
export async function fetchSecretById(secretId) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastStatus = null;
  for (const base of buildSecretsApiBases()) {
    const response = await fetch(`${base}/secrets/${secretId}`, { method: 'GET', headers });
    lastStatus = response.status;
    if (response.ok) {
      return response.json();
    }
    if ([404, 405, 502, 503, 504].includes(response.status)) {
      continue;
    }
    throw new Error(`Failed to fetch secret value: ${response.status}`);
  }
  throw new Error(`Failed to fetch secret value: ${lastStatus ?? 'network error'}`);
}
