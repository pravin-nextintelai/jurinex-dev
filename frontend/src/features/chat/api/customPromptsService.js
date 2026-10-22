/**
 * User custom prompt groups — API client.
 *
 * Both backends expose the same endpoints over the same shared tables:
 *   agentic-document-service → /api/files/custom-prompts/*
 *   agentic-chat-service     → /api/chat/custom-prompts/*
 * Like secretsService, we try gateway bases first and fall back to the direct
 * service hosts, so the feature works from any page.
 */
import {
  SECRET_PROMPTS_API_BASE,
  CHAT_MODEL_BASE_URL,
  GATEWAY_BASE_URL,
  DOCS_BASE_URL,
} from '@/config/apiConfig';

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

function buildApiBases() {
  const seen = new Set();
  const bases = [];
  const add = (raw) => {
    const base = String(raw || '').trim().replace(/\/$/, '');
    if (!base || seen.has(base)) return;
    seen.add(base);
    bases.push(`${base}/custom-prompts`);
  };

  add(SECRET_PROMPTS_API_BASE);
  add(`${GATEWAY_BASE_URL}/chat`);
  add(DOCS_BASE_URL);
  const chatHost = String(CHAT_MODEL_BASE_URL || '').replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
  if (chatHost) add(`${chatHost}/api/chat`);

  return bases;
}

// Statuses that mean "this base can't serve the route" — try the next base.
const FALLBACK_STATUSES = new Set([404, 405, 502, 503, 504]);

async function request(path, { method = 'GET', body = null } = {}) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastStatus = null;
  let lastDetail = null;
  let lastError = null;

  for (const base of buildApiBases()) {
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
      lastStatus = response.status;
      if (response.ok) {
        return response.json();
      }
      try {
        const errBody = await response.json();
        lastDetail = errBody?.detail || errBody?.message || null;
      } catch {
        /* non-JSON error body */
      }
      if (FALLBACK_STATUSES.has(response.status)) {
        continue;
      }
      throw new Error(lastDetail || `Request failed: ${response.status}`);
    } catch (err) {
      if (err instanceof TypeError) {
        lastError = err;
        continue; // network error — try next base
      }
      throw err;
    }
  }

  if (lastStatus != null) {
    throw new Error(lastDetail || `Request failed: ${lastStatus}`);
  }
  throw lastError || new Error('Request failed: network error');
}

/** All of the user's prompt groups, each with a `prompts` array. */
export function fetchCustomPromptGroups() {
  return request('/groups');
}

export function createCustomPromptGroup(name, description = null) {
  return request('/groups', { method: 'POST', body: { name, description } });
}

export function deleteCustomPromptGroup(groupId) {
  return request(`/groups/${groupId}`, { method: 'DELETE' });
}

/**
 * Save a prompt into a group. Pass either groupId (existing) or groupName
 * (created on the backend if the user doesn't have it yet).
 */
export function addCustomPrompt({ groupId = null, groupName = null, name, promptText, description = null }) {
  return request('/prompts', {
    method: 'POST',
    body: {
      group_id: groupId,
      group_name: groupName,
      name,
      prompt_text: promptText,
      description,
    },
  });
}

export function deleteCustomPrompt(promptId) {
  return request(`/prompts/${promptId}`, { method: 'DELETE' });
}

/**
 * AI-generate (or revise) a prompt → {name, description, prompt_text}.
 *
 * Pass a plain string for a one-shot generation, or the builder-chat history
 * [{role:'user'|'assistant', content}] to refine the previous draft — assistant
 * turns must carry the prompt text produced in that turn.
 */
export function generateCustomPrompt(descriptionOrMessages, currentPrompt = null) {
  const body = Array.isArray(descriptionOrMessages)
    ? { messages: descriptionOrMessages }
    : { description: descriptionOrMessages };
  // The draft on screen, so a refinement edits exactly that text.
  if (currentPrompt) body.current_prompt = currentPrompt;
  return request('/generate', { method: 'POST', body });
}
