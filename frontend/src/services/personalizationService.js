/**
 * Personalization — API client.
 *
 * Backend: agentic-document-service, /api/files/personalization/*
 *   status               → counters, latest profile summary, active instruction
 *   profile              → the learned profile JSON (or the default for a new user)
 *   profile/rebuild      → run the profile builder now
 *   instructions/generate → profile + this session's prompts → instruction markdown
 *   instructions/activate → "Add to system" (mode: 'replace' | 'append')
 *   instructions/deactivate → turn personalization off
 */
import { DOCS_BASE_URL } from '../config/apiConfig';

const BASE = `${String(DOCS_BASE_URL || '').replace(/\/$/, '')}/personalization`;

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

async function request(path, { method = 'GET', body = null } = {}) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the personalization service. Is the document service running?');
  }
  if (response.ok) return response.json();

  let detail = null;
  try {
    const errBody = await response.json();
    detail = errBody?.detail || errBody?.message || null;
    if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    /* non-JSON error body */
  }
  throw new Error(detail || `Request failed: ${response.status}`);
}

/** With folderName: case prompt count + the instruction that applies to that case. */
export function fetchPersonalizationStatus(folderName = null) {
  const qs = folderName ? `?folder_name=${encodeURIComponent(folderName)}` : '';
  return request(`/status${qs}`);
}

export function fetchPersonalizationProfile() {
  return request('/profile');
}

export function rebuildPersonalizationProfile(allowPartial = true) {
  return request('/profile/rebuild', { method: 'POST', body: { allow_partial: allowPartial } });
}

/**
 * → { instruction_text, profile_version, profile_is_default, history_source,
 *     history_prompt_count, imported_prompts, model }
 * scope: 'auto' (session if given) | 'session' | 'history' (the user's past prompts
 * across chats). importHistory: with 'history', first run every old chat through
 * the memory flow (prompt log → counter → background profile build).
 */
export function generatePersonalInstruction(
  sessionId = null,
  { scope = 'auto', importHistory = false, folderName = null } = {},
) {
  // folderName keeps the generation to THAT case's prompts (cases stay separate).
  return request('/instructions/generate', {
    method: 'POST',
    body: { session_id: sessionId || null, scope, import_history: importHistory, folder_name: folderName || null },
  });
}

/** Rewrite a hand-written draft into the standard format → { instruction_text, model, ... } */
export function polishPersonalInstruction(instructionText) {
  return request('/instructions/polish', { method: 'POST', body: { instruction_text: instructionText } });
}

/**
 * mode: 'replace' (default) swaps the active instruction; 'append' merges with it.
 * origin: 'manual' | 'generated' | 'polished' — shown as a badge on the active card.
 */
export function activatePersonalInstruction({
  instructionText,
  mode = 'replace',
  origin = 'manual',
  sourceProfileVersion = null,
  sourceSessionId = null,
  behaviourAnalysis = null,
  folderName = null,
}) {
  // folderName → the instruction applies only to that case; null → all the user's cases.
  return request('/instructions/activate', {
    method: 'POST',
    body: {
      instruction_text: instructionText,
      mode,
      origin,
      source_profile_version: sourceProfileVersion,
      source_session_id: sourceSessionId,
      behaviour_analysis: behaviourAnalysis || null,
      folder_name: folderName || null,
    },
  });
}

/**
 * Run old chats through the normal flow (prompt log → counter → profile builder in
 * the background). No args = the user's whole chat history; or one session / one case.
 * → { imported, prompt_count, batches_completed, rebuild_scheduled }
 */
export function importPersonalizationHistory({ sessionId = null, folderName = null } = {}) {
  return request('/import-history', {
    method: 'POST',
    body: { session_id: sessionId || null, folder_name: folderName || null },
  });
}

/** Logged prompts — this session's, else this case's (folderName), else the most recent ones. */
export function fetchPersonalizationPrompts(sessionId = null, limit = 40, folderName = null) {
  const qs = new URLSearchParams();
  if (sessionId) qs.set('session_id', sessionId);
  else if (folderName) qs.set('folder_name', folderName);
  qs.set('limit', String(limit));
  return request(`/prompts?${qs.toString()}`);
}

/** Turns off the instruction that applies to the case (its own, else the global one). */
export function deactivatePersonalInstruction(folderName = null) {
  return request('/instructions/deactivate', { method: 'POST', body: { folder_name: folderName || null } });
}

export function listPersonalInstructions() {
  return request('/instructions');
}

export function deletePersonalInstruction(instructionId) {
  return request(`/instructions/${encodeURIComponent(instructionId)}`, { method: 'DELETE' });
}

// ── Claude-style memory (topic notes) ────────────────────────────────────────

export function fetchMemorySettings() {
  return request('/memory/settings');
}

export function updateMemorySettings({ enabled, generateFromChats, searchPastChats, sensitiveData } = {}) {
  const body = {};
  if (enabled !== undefined) body.enabled = enabled;
  if (generateFromChats !== undefined) body.generate_from_chats = generateFromChats;
  if (searchPastChats !== undefined) body.search_past_chats = searchPastChats;
  if (sensitiveData !== undefined) body.sensitive_data = sensitiveData;
  return request('/memory/settings', { method: 'PUT', body });
}

export function fetchMemoryTopics(folderName = null) {
  const qs = folderName ? `?folder_name=${encodeURIComponent(folderName)}` : '';
  return request(`/memory/topics${qs}`);
}

export function rememberMemory({ text, title = null, folderName = null }) {
  return request('/memory/remember', {
    method: 'POST',
    body: { text, title: title || null, folder_name: folderName || null },
  });
}

export function forgetMemory({ query, folderName = null }) {
  return request('/memory/forget', {
    method: 'POST',
    body: { query, folder_name: folderName || null },
  });
}

export function updateMemoryTopic(topicId, { title, content, pinned } = {}) {
  const body = {};
  if (title !== undefined) body.title = title;
  if (content !== undefined) body.content = content;
  if (pinned !== undefined) body.pinned = pinned;
  return request(`/memory/topics/${encodeURIComponent(topicId)}`, { method: 'PATCH', body });
}

export function deleteMemoryTopic(topicId) {
  return request(`/memory/topics/${encodeURIComponent(topicId)}`, { method: 'DELETE' });
}

// Searches MEMORY FILES only. Memory holds no conversations.
export function searchMemory(query, folderName = null) {
  const qs = new URLSearchParams();
  qs.set('q', query);
  if (folderName) qs.set('folder_name', folderName);
  return request(`/memory/search?${qs.toString()}`);
}
