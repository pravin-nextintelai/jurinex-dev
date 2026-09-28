/**
 * Client for the controlled memory API on the agentic document service
 * (Backend/agentic-document-service/app/api/routes/memory.py).
 *
 * Every call carries the signed-in user's bearer token. The memory routes verify
 * it and resolve the case from the folder name, so a folder this user cannot see
 * returns 404 rather than someone else's memory.
 */
import axios from 'axios';
import { MEMORY_API_BASE, getUserIdForDrafting } from '../config/apiConfig';

const TOKEN_KEYS = ['token', 'authToken', 'access_token', 'jwt', 'auth_token'];

// Same headers the document API sends (services/documentApi.js getAuthHeader),
// read on every call so a refreshed token is always used.
const authHeaders = () => {
  const token = TOKEN_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  const userId = getUserIdForDrafting();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
};

const request = async ({ method = 'get', url, params, data }) => {
  const response = await axios.request({
    method,
    url: `${MEMORY_API_BASE}${url}`,
    params,
    data,
    headers: authHeaders(),
  });
  return response.data;
};

const casePath = (folderName) => `/cases/${encodeURIComponent(folderName)}`;

const instructionParams = (scope, folderName, extra = {}) => ({
  scope,
  ...(folderName ? { folder_name: folderName } : {}),
  ...extra,
});

/**
 * Turn a failed call into something the UI can act on.
 *
 * kind: 'conflict' (409, stale version; `current` holds the latest content),
 *       'rejected' (422 from a memory rule; `problems` lists why),
 *       'invalid', 'not_found', 'forbidden', 'network' or 'error'.
 */
export function describeMemoryError(error, fallback = 'Something went wrong with memory.') {
  if (!error?.response) {
    return {
      status: null,
      kind: 'network',
      message: 'Could not reach the memory service. Check your connection and try again.',
      problems: [],
    };
  }
  const { status } = error.response;
  const body = error.response.data || {};
  const detail = body.detail;

  if (status === 409) {
    return {
      status,
      kind: 'conflict',
      message: 'This was changed somewhere else while you were working on it.',
      problems: [],
      current: body,
    };
  }
  if (status === 422 && Array.isArray(body.problems)) {
    const problems = body.problems.filter((problem) => problem?.message);
    return {
      status,
      kind: 'rejected',
      message: problems.length === 1 ? problems[0].message : "This can't be saved as written:",
      problems: problems.length === 1 ? [] : problems,
    };
  }
  if (status === 422) {
    return { status, kind: 'invalid', message: 'Some of the details sent were not valid.', problems: [] };
  }
  if (status === 404) {
    return { status, kind: 'not_found', message: typeof detail === 'string' ? detail : 'Not found.', problems: [] };
  }
  if (status === 403) {
    return {
      status,
      kind: 'forbidden',
      message: typeof detail === 'string' ? detail : 'You do not have permission to do that.',
      problems: [],
    };
  }
  return { status, kind: 'error', message: typeof detail === 'string' ? detail : fallback, problems: [] };
}

const memoryApi = {
  // Settings: scope is 'user', 'case' (needs folderName) or 'firm' (firm admins).
  getSettings: (scope = 'user', folderName) =>
    request({ url: '/settings', params: { scope, ...(folderName ? { folder_name: folderName } : {}) } }),
  updateSettings: (flags, scope = 'user', folderName) =>
    request({
      method: 'put',
      url: '/settings',
      params: { scope, ...(folderName ? { folder_name: folderName } : {}) },
      data: flags,
    }),

  // Layers 1 and 2: instructions, one switchable item each. `scope` is 'user'
  // (every case) or 'case' (needs folderName). A folder with scope 'user' says
  // which case's overrides to show; a session id adds the per-chat mutes.
  listInstructions: (scope, folderName, sessionId) =>
    request({
      url: '/instructions',
      params: instructionParams(scope, folderName, sessionId ? { session_id: sessionId } : {}),
    }),
  addInstruction: (scope, folderName, body) =>
    request({ method: 'post', url: '/instructions', params: instructionParams(scope, folderName), data: body }),
  updateInstruction: (scope, folderName, instructionId, body) =>
    request({
      method: 'patch',
      url: `/instructions/${encodeURIComponent(instructionId)}`,
      params: instructionParams(scope, folderName),
      data: body,
    }),
  deleteInstruction: (scope, folderName, instructionId, version) =>
    request({
      method: 'delete',
      url: `/instructions/${encodeURIComponent(instructionId)}`,
      params: instructionParams(scope, folderName, version != null ? { version } : {}),
    }),
  // body: { override: 'case' | 'session', session_id?, enabled: true | false | null (clear) }
  setInstructionOverride: (scope, folderName, instructionId, body) =>
    request({
      method: 'put',
      url: `/instructions/${encodeURIComponent(instructionId)}/override`,
      params: instructionParams(scope, folderName),
      data: body,
    }),
  polishInstruction: (text, scope = 'case') =>
    request({ method: 'post', url: '/instructions/polish', data: { text, scope } }),

  // What JuriNex remembers about the advocate, used in every case.
  getAdvocateMemory: () => request({ url: '/advocate' }),
  addAdvocateFact: (body) => request({ method: 'post', url: '/advocate', data: body }),
  updateAdvocateFact: (lineId, body) =>
    request({ method: 'patch', url: `/advocate/${encodeURIComponent(lineId)}`, data: body }),
  deleteAdvocateFact: (lineId, version) =>
    request({
      method: 'delete',
      url: `/advocate/${encodeURIComponent(lineId)}`,
      params: version != null ? { version } : undefined,
    }),
  forgetAdvocate: () => request({ method: 'delete', url: '/advocate' }),
  // Fold overlapping facts into fewer, sharper lines, and put them back.
  consolidateAdvocate: (version) =>
    request({ method: 'post', url: '/advocate/consolidate', params: { version: version ?? undefined } }),
  undoAdvocateConsolidation: (version) =>
    request({ method: 'post', url: '/advocate/consolidate/undo', params: { version: version ?? undefined } }),

  // Rules JuriNex noticed in more than one case; accepted ones become standing instructions.
  listUserSuggestions: () => request({ url: '/suggestions', params: { status: 'pending' } }),
  // Look across all of your cases now: practice facts and rules kept in several cases, as suggestions.
  learnAcrossCases: () => request({ method: 'post', url: '/advocate/learn' }),
  // `text` is the wording the advocate approved: the tidied version, or their edit of it.
  resolveUserSuggestion: (proposalId, decision, text) =>
    request({
      method: 'post',
      url: `/suggestions/${encodeURIComponent(proposalId)}/${decision}`,
      data: text ? { text } : undefined,
    }),

  // Layer 3: case memory.
  getCaseMemory: (folderName) => request({ url: casePath(folderName) }),
  getSection: (folderName, section) => request({ url: `${casePath(folderName)}/sections/${section}` }),
  applyOp: (folderName, section, body) =>
    request({ method: 'post', url: `${casePath(folderName)}/sections/${section}/ops`, data: body }),
  deleteLine: (folderName, lineId) =>
    request({ method: 'delete', url: `${casePath(folderName)}/lines/${encodeURIComponent(lineId)}` }),
  deleteSection: (folderName, section, version) =>
    request({
      method: 'delete',
      url: `${casePath(folderName)}/sections/${section}`,
      params: version != null ? { version } : undefined,
    }),
  forgetCase: (folderName) => request({ method: 'delete', url: casePath(folderName) }),

  // Suggestions the model made for one case; only the advocate can accept them.
  listProposals: (folderName, status = 'pending') =>
    request({ url: `${casePath(folderName)}/proposals`, params: { status } }),
  resolveProposal: (folderName, proposalId, decision, text) =>
    request({
      method: 'post',
      url: `${casePath(folderName)}/proposals/${encodeURIComponent(proposalId)}/${decision}`,
      data: text ? { text } : undefined,
    }),

  // Lifecycle.
  exportCase: (folderName) => request({ url: `${casePath(folderName)}/export` }),
  importCase: (folderName, payload, replace = false) =>
    request({ method: 'post', url: `${casePath(folderName)}/import`, data: { payload, replace } }),
  seedCase: (folderName) => request({ method: 'post', url: `${casePath(folderName)}/seed` }),
  getLog: (folderName, limit = 20) => request({ url: `${casePath(folderName)}/log`, params: { limit } }),
  // What memory did with each of your recent turns in this case, and why.
  getActivity: (folderName, limit = 30) =>
    request({ url: `${casePath(folderName)}/activity`, params: { limit } }),
  // Earlier messages memory has not read yet, and the latest run reading them.
  getRereadStatus: (folderName) => request({ url: `${casePath(folderName)}/reread` }),
  // Read this case's earlier messages now, in the background; poll getRereadStatus.
  startReread: (folderName) => request({ method: 'post', url: `${casePath(folderName)}/reread` }),
  // What memory did after one chat turn. `ready` stays false until the writer has finished.
  getTurn: (folderName, chatId) =>
    request({ url: `${casePath(folderName)}/turns/${encodeURIComponent(chatId)}` }),
  // The running summary of one chat: read-only, and already part of what the chat sends.
  getChatSummary: (folderName, sessionId) =>
    request({ url: `${casePath(folderName)}/chat-summary`, params: { session_id: sessionId || undefined } }),
};

export default memoryApi;
