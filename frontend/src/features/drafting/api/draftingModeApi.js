// Drafting Mode API — talks to agentic-chat-service /api/chat/draft/* routes.
// Session lifecycle: create → upload template (async analysis, polled) →
// upload supporting docs → SSE section-by-section generation.
import { CHAT_MODEL_BASE_URL } from '@/config/apiConfig';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

const BASE = `${CHAT_MODEL_BASE_URL}/api/chat/draft`;

const getAuthToken = () =>
  localStorage.getItem('token') ||
  localStorage.getItem('authToken') ||
  localStorage.getItem('access_token') ||
  localStorage.getItem('jwt') ||
  localStorage.getItem('auth_token');

const authHeaders = (json = false) => {
  const headers = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};

const parseError = async (res) => {
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    detail = body.detail || body.message || detail;
  } catch { /* non-JSON error body */ }
  const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  err.status = res.status;
  return err;
};

const friendlyFetchError = (err) => {
  if (err?.name === 'TypeError' && /fetch/i.test(String(err.message))) {
    return (
      'Cannot reach the drafting service. Ensure agentic-chat-service is running '
      `(expected ${CHAT_MODEL_BASE_URL || 'http://localhost:8096'}).`
    );
  }
  return err?.message || 'Request failed';
};

export const createDraftingSession = async (llmName) => {
  try {
    const res = await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ llm_name: llmName || undefined }),
    });
    if (!res.ok) throw await parseError(res);
    return res.json();
  } catch (err) {
    throw new Error(friendlyFetchError(err));
  }
};

export const uploadDraftTemplate = async (sessionId, file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/${sessionId}/template`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) await throwIfQuotaResponse(res);
  if (!res.ok) throw await parseError(res);
  return res.json();
};

export const retryTemplateAnalysis = async (sessionId) => {
  const res = await fetch(`${BASE}/${sessionId}/template/retry`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

export const uploadSupportingDocuments = async (sessionId, files) => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await fetch(`${BASE}/${sessionId}/documents`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

export const getDraftingSession = async (sessionId) => {
  try {
    const res = await fetch(`${BASE}/${sessionId}`, { headers: authHeaders() });
    if (!res.ok) throw await parseError(res);
    return res.json();
  } catch (err) {
    throw new Error(friendlyFetchError(err));
  }
};

/**
 * Poll template analysis until it leaves the 'analyzing' state.
 * Resolves with the session payload once status is 'ready' (or throws on failure).
 */
export const waitForTemplateAnalysis = async (sessionId, { signal, onTick, intervalMs = 1000, timeoutMs = 600000 } = {}) => {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const session = await getDraftingSession(sessionId);
    onTick?.(session);
    if (session.status === 'ready') return session;
    if (session.status === 'analysis_failed') {
      throw new Error(session.error || 'Template analysis failed');
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error('Template analysis timed out — please retry the upload.');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

/**
 * Start SSE generation. Calls onEvent(parsedEvent) for every typed event
 * (status/section_start/chunk/section_end/section_error/usage/done/error).
 * Returns when the stream ends. Abort via the provided AbortController signal.
 */
export const streamDraftGeneration = async (
  sessionId,
  { llmName, draftingStrategy, sectionIds, userInstructions, confirmedFacts, maxOutputTokensPerSection } = {},
  onEvent,
  signal,
) => {
  const res = await fetch(`${BASE}/${sessionId}/generate/stream`, {
    method: 'POST',
    headers: { ...authHeaders(true), Accept: 'text/event-stream' },
    body: JSON.stringify({
      llm_name: llmName || undefined,
      drafting_strategy: draftingStrategy || 'sectionwise',
      section_ids: sectionIds || undefined,
      user_instructions: userInstructions || undefined,
      confirmed_facts: confirmedFacts || undefined,
      ...(maxOutputTokensPerSection ? { max_output_tokens_per_section: maxOutputTokensPerSection } : {}),
    }),
    signal,
  });
  if (!res.ok) await throwIfQuotaResponse(res);
  if (!res.ok || !res.body) throw await parseError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;
          if (payload === '[PING]') continue;
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // Malformed frame — surface as raw text rather than dropping silently.
            onEvent({ type: 'chunk', text: payload });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export const downloadDraftUrl = (sessionId, format = 'markdown') =>
  `${BASE}/${sessionId}/download?format=${format}`;

export const fetchCompiledDraft = async (sessionId, format = 'markdown') => {
  const res = await fetch(downloadDraftUrl(sessionId, format), { headers: authHeaders() });
  if (!res.ok) throw await parseError(res);
  return res.text();
};

export const deleteDraftingSession = async (sessionId) => {
  const res = await fetch(`${BASE}/${sessionId}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw await parseError(res);
  return res.json();
};
