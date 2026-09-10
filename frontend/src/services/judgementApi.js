// Judgement service client — ADK legal search pipeline (FastAPI, direct).
//
// Flow:
//   1. analyze / analyzeUpload  -> sessionId + caseContext + suggestedIssues
//   2. runSearch(sessionId)     -> precedents grouped by issue (bands, chips, signals)
//   3. refine(sessionId)        -> search-within-search over the cached result set
//   searchOneShot               -> single call doing analyze + search together
//
// Every docId returned by this service is mechanically verified against the
// Indian Kanoon fetch pool server-side (CitationGuardian) — nothing invented.

import { JUDGEMENT_SERVICE_URL, getUserIdForDrafting } from '../config/apiConfig';
import { throwIfQuotaResponse } from '../utils/quotaError';

function getAuthHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken')
    || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  // The document service scopes case/file access by X-User-Id; the
  // judgement service forwards it when resolving a case's documents.
  const userId = getUserIdForDrafting();
  if (userId) headers['X-User-Id'] = String(userId);
  return headers;
}

// A network-level failure surfaces as an opaque TypeError ("Failed to
// fetch") — translate it so users know the service was unreachable (down,
// restarting, or the request was cut off) rather than a data problem.
const NETWORK_ERROR_MSG =
  'Could not reach the research service — it may be restarting or the '
  + 'request was cut off. Nothing was lost; please try again in a moment.';

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${JUDGEMENT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_ERROR_MSG);
  }
  if (!response.ok) {
    await throwIfQuotaResponse(response, 'Judgement service request failed');
    let detail = `Judgement service error (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep default detail */ }
    throw new Error(detail);
  }
  return response.json();
}

async function getJson(path, failMsg) {
  let response;
  try {
    response = await fetch(`${JUDGEMENT_SERVICE_URL}${path}`, { headers: getAuthHeader() });
  } catch {
    throw new Error(NETWORK_ERROR_MSG);
  }
  if (!response.ok) {
    let detail = `${failMsg} (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep default detail */ }
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

export const judgementApi = {
  /** GET /health — service + store status. */
  async health() {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/health`, { headers: getAuthHeader() });
    if (!response.ok) throw new Error(`Judgement service unreachable (${response.status})`);
    return response.json();
  },

  /**
   * Phase 1 — POST /api/v1/analyze with pasted case text (and/or a server-side
   * fileRef). Returns { sessionId, caseContext, suggestedIssues,
   * needsClarification, clarificationQuestion, researchMode, groundsMeta }.
   * mode: 'issues' (default — issue spotter) | 'grounds' (extract the grounds
   * pleaded in the filing and research precedents for each ground).
   * No search spend happens here.
   */
  analyze({ text, fileRef, mode = 'issues', queryStyle = 'simple', role = null } = {}) {
    return postJson('/api/v1/analyze', { caseInput: { text: text || null, fileRef: fileRef || null }, mode, queryStyle, role: role || null });
  },

  /**
   * Phase 1 (case) — POST /api/v1/analyze/case. Analyzes one of the user's
   * existing cases: the backend pulls the case documents (and their
   * page-numbered chunks) from the agentic document service, so suggested
   * issues come back with 'file, page N' source references.
   */
  analyzeCase(caseId, text = '', mode = 'issues', queryStyle = 'simple', role = null) {
    return postJson('/api/v1/analyze/case', { caseId, text: text || null, mode, queryStyle, role: role || null });
  },

  /**
   * Phase 1 (fresh matter) — POST /api/v1/analyze/case/fresh. For a case with
   * NO drafted pleading yet: the backend pulls ALL of the case's source
   * documents and the lawyer's stated objective (required) drives PROPOSED
   * grounds; the identical search pipeline then runs on them.
   */
  analyzeCaseFresh(caseId, objective, queryStyle = 'simple', role = null) {
    return postJson('/api/v1/analyze/case/fresh', { caseId, objective, queryStyle, role: role || null });
  },

  /**
   * Phase 1 (upload) — POST /api/v1/analyze/upload with one or more
   * PDF/DOCX/TXT documents + an optional description. All documents are
   * analysed together as a single matter.
   */
  async analyzeUpload(files, text = '', mode = 'issues', title = '', queryStyle = 'simple', role = null) {
    const list = Array.isArray(files) ? files : [files];
    const form = new FormData();
    list.forEach((f) => form.append('files', f));
    if (text) form.append('text', text);
    form.append('mode', mode);
    if (title) form.append('title', title);
    form.append('queryStyle', queryStyle);
    if (role) form.append('role', role);
    let response;
    try {
      response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/analyze/upload`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
        body: form,
      });
    } catch {
      throw new Error(NETWORK_ERROR_MSG);
    }
    if (!response.ok) {
      await throwIfQuotaResponse(response, 'Document analysis failed');
      let detail = `Document analysis failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      } catch { /* keep default detail */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /**
   * Phase 2 — POST /api/v1/search/{sessionId}/run.
   * issueIds: ids picked from suggestedIssues (null/undefined = all).
   * customIssues: the user's own issue texts, each searched separately.
   * Returns the full SearchResponse: issues[] -> results[] with band, score,
   * pinpoint, signals (explainability chips — render one chip per key).
   */
  runSearch(sessionId, {
    issueIds = null, customIssues = [], queryOverrides = {},
    courtScope = null, fromdate = '', todate = '',
  } = {}) {
    return postJson(`/api/v1/search/${sessionId}/run`, {
      issueIds, customIssues, queryOverrides, courtScope, fromdate, todate,
    });
  },

  /**
   * Add a user-typed issue/ground to an analysed session —
   * POST /api/v1/search/{sessionId}/issues. The backend enriches it and
   * generates its IK queries exactly like system-suggested issues; returns
   * { issue } ready to render as a normal card.
   */
  addIssue(sessionId, text) {
    return postJson(`/api/v1/search/${sessionId}/issues`, { text });
  },

  /** One-shot — POST /api/v1/search (analyze + split + search in one call). */
  searchOneShot({ text, fileRef } = {}) {
    return postJson('/api/v1/search', { caseInput: { text: text || null, fileRef: fileRef || null } });
  },

  /** Research history — GET /api/v1/sessions (scoped by X-User-Id). */
  async listSessions() {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/sessions`, { headers: getAuthHeader() });
    if (!response.ok) throw new Error(`History failed (${response.status})`);
    const data = await response.json();
    return data.sessions || [];
  },

  /** Reopen a stored research session with all its citations + decisions. */
  async getSession(sessionId) {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/search/${sessionId}`, { headers: getAuthHeader() });
    if (!response.ok) {
      let detail = `Could not open research (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /**
   * Delete a stored research session — its results, citation reports and
   * approve/reject decisions — permanently. DELETE /api/v1/search/{sessionId}
   * (owner-scoped by X-User-Id server-side).
   */
  async deleteSession(sessionId) {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/search/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      let detail = `Delete failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /**
   * Full legal-intelligence report for one surfaced citation —
   * GET /api/v1/search/{sessionId}/report/{issueId}/{docId}.
   * Includes grounded LLM analysis, deterministic semantic/factual
   * relevance scores, citation context, bench/date, and the full
   * judgment text for the Document tab. Cached server-side per session.
   */
  async getReport(sessionId, issueId, docId) {
    const response = await fetch(
      `${JUDGEMENT_SERVICE_URL}/api/v1/search/${sessionId}/report/${issueId}/${encodeURIComponent(docId)}`,
      { headers: getAuthHeader() },
    );
    if (!response.ok) {
      let detail = `Report failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /** Approve / reject a citation — persisted in the search session. */
  setReportStatus(sessionId, issueId, docId, status) {
    return postJson(`/api/v1/search/${sessionId}/report/${issueId}/${encodeURIComponent(docId)}/status`, { status });
  },

  /**
   * Advanced Search — POST /api/v1/advanced-search. A direct Indian Kanoon
   * query built from the user's own criteria (every field optional):
   * keywords, title-only, citation, author/judge, bench, doctypes, date
   * range and sort order. Results come back exactly as Indian Kanoon ranks
   * them, 10 per page — no analysis pipeline, no verification bands.
   */
  advancedSearch({
    query = '', title = '', cite = '', author = '', bench = '',
    doctypes = '', fromdate = '', todate = '', sortby = 'relevance', pagenum = 0,
  } = {}) {
    return postJson('/api/v1/advanced-search', {
      query, title, cite, author, bench, doctypes, fromdate, todate, sortby, pagenum,
    });
  },

  /**
   * Local judgment library search — POST /api/v1/local-search. Same
   * criteria and response shape as advancedSearch, but served from the
   * Elasticsearch mirror of every judgment already fetched (same docIds
   * as Indian Kanoon) — zero IK spend.
   */
  localSearch({
    query = '', title = '', cite = '', author = '', bench = '',
    doctypes = '', fromdate = '', todate = '', sortby = 'relevance', pagenum = 0,
  } = {}) {
    return postJson('/api/v1/local-search', {
      query, title, cite, author, bench, doctypes, fromdate, todate, sortby, pagenum,
    });
  },

  /**
   * Local library document view — GET /api/v1/local-search/doc/{docId}.
   * Served ONLY from Elasticsearch: a judgment the library never collected
   * comes back 404 ("not in your library") instead of billing Indian Kanoon.
   */
  localSearchDoc(docId) {
    return getJson(`/api/v1/local-search/doc/${encodeURIComponent(docId)}`,
      'Document fetch failed');
  },

  /**
   * Advanced Search document view — GET /api/v1/advanced-search/doc/{docId}.
   * The full judgment as Indian Kanoon serves it (its own HTML) plus
   * bench/author metadata and cites/cited-by, for in-app rendering.
   */
  advancedSearchDoc(docId) {
    return getJson(`/api/v1/advanced-search/doc/${encodeURIComponent(docId)}`,
      'Document fetch failed');
  },

  /**
   * Search-within-search — POST /api/v1/search/{sessionId}/refine.
   * mode: 'facet' | 'keyword' | 'semantic' | 'ik_escape'.
   * Results are reordered/de-emphasised, never deleted; when nothing matches,
   * the response carries an escapeHatch offer to search all of Indian Kanoon.
   */
  refine(sessionId, { issueId, mode, query = '', court = null, yearFrom = null, yearTo = null, band = null }) {
    return postJson(`/api/v1/search/${sessionId}/refine`, {
      issueId, mode, query, court, yearFrom, yearTo, band,
    });
  },
};

export default judgementApi;
