/**
 * Citation Service API — Verified Citation Reports (Watchdog → Fetcher → Clerk).
 * Base URL: CITATION_SERVICE_URL (citation-service Cloud Run)
 */
import { CITATION_SERVICE_URL, AUTH_SERVICE_URL } from '@/config/apiConfig';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

function getAuthHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Best-effort logged-in user id for citation usage (matches backend JWT subject). */
export function resolveCitationUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    const id = u.id ?? u.user_id ?? u.userId;
    if (id != null && String(id).trim() && String(id).toLowerCase() !== 'anonymous') {
      return String(id).trim();
    }
  } catch {
    /* ignore */
  }
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt') ||
    localStorage.getItem('auth_token');
  if (token && typeof token === 'string' && token.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const id = payload.id ?? payload.userId ?? payload.sub;
      if (id != null && String(id).trim()) return String(id).trim();
    } catch {
      /* ignore */
    }
  }
  const legacy = localStorage.getItem('userId') || localStorage.getItem('user_id');
  if (legacy) return String(legacy).trim();
  return 'anonymous';
}

function coalesceUserId(explicit) {
  if (explicit != null && explicit !== '' && String(explicit).toLowerCase() !== 'anonymous') {
    return String(explicit).trim();
  }
  return resolveCitationUserId();
}

export const citationApi = {
  /**
   * Generate a new citation report (runs full pipeline).
   * Body: { query, user_id?, case_id?, use_pipeline?: true, case_file_context?: [...], perspective?: string }
   * Returns: { success, report_id, report_format: { citations, generatedAt, perspective }, case_id }
   *
   * perspective: 'all' | 'appellant' | 'respondent' | 'court'
   *   When set to a specific party, citations are filtered to show only that party's arguments.
   */
  async generateReport(query, userId = 'anonymous', usePipeline = true, caseFileContext = null, caseId = null, perspective = 'all', retrievalMethod = 'indiankanoon', customKeywords = null) {
    const body = { query, user_id: coalesceUserId(userId), use_pipeline: usePipeline };
    if (caseFileContext && caseFileContext.length > 0) body.case_file_context = caseFileContext;
    if (caseId) body.case_id = caseId;
    if (perspective && perspective !== 'all') body.perspective = perspective;
    if (retrievalMethod) body.retrieval_method = retrievalMethod;
    if (customKeywords?.length) body.custom_keywords = customKeywords;
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await throwIfQuotaResponse(res, 'Failed to generate report');
    }
    return res.json();
  },

  /**
   * List reports for a user — optionally filtered by case_id.
   * GET /citation/reports?user_id=...&case_id=... (case_id optional)
   */
  async listReports(userId, caseId = null) {
    let url = `${CITATION_SERVICE_URL}/citation/reports?user_id=${encodeURIComponent(userId)}`;
    if (caseId) url += `&case_id=${encodeURIComponent(caseId)}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { headers: getAuthHeader(), signal: controller.signal });
      if (!res.ok) throw new Error('Failed to list reports');
      return res.json();
    } finally {
      clearTimeout(tid);
    }
  },

  /**
   * List reports for a specific case.
   */
  async listReportsByCase(caseId, userId) {
    return this.listReports(userId, caseId);
  },

  /**
   * Get one report by ID.
   */
  async getReport(reportId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/reports/${reportId}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch report');
    }
    return res.json();
  },

  /**
   * Get complete judgment text for a citation (by canonical_id).
   * GET /citation/judgements/{canonicalId}/full-text
   */
  async getJudgementFullText(canonicalId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/judgements/${encodeURIComponent(canonicalId)}/full-text`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch judgment');
    }
    return res.json();
  },

  /**
   * Get citation graph for a judgment (by canonical_id).
   * GET /citation/cases/{canonicalId}/graph
   */
  async getCaseCitationGraph(canonicalId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/cases/${encodeURIComponent(canonicalId)}/graph`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) {
      if (res.status === 404) return { nodes: [], edges: [] };
      throw new Error('Failed to fetch citation graph');
    }
    return res.json();
  },

  /**
   * Start citation report pipeline in background. Returns run_id immediately.
   * perspective: 'all' | 'appellant' | 'respondent' | 'court'
   */
  async startReport(query, userId = 'anonymous', caseId = null, caseFileContext = null, perspective = 'all', retrievalMethod = 'indiankanoon', customKeywords = null, selectedKeywords = null, selectedCaseNames = null, representedSide = null, caseType = null, jurisdiction = null, legalIssueFocus = null, mode = 'auto') {
    const body = { query, user_id: coalesceUserId(userId), use_pipeline: true };
    if (caseId) body.case_id = caseId;
    if (caseFileContext?.length) body.case_file_context = caseFileContext;
    if (perspective && perspective !== 'all') body.perspective = perspective;
    if (retrievalMethod) body.retrieval_method = retrievalMethod;
    if (customKeywords?.length) body.custom_keywords = customKeywords;
    if (selectedKeywords?.length) body.selected_keywords = selectedKeywords;
    if (selectedCaseNames?.length) body.selected_case_names = selectedCaseNames;
    if (representedSide) body.represented_side = representedSide;
    if (caseType) body.case_type = caseType;
    if (jurisdiction) body.jurisdiction = jurisdiction;
    if (legalIssueFocus) body.legal_issue_focus = legalIssueFocus;
    if (mode) body.mode = mode;
    const endpoint = `${CITATION_SERVICE_URL}/citation/report/start`;
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err?.message || 'Network request failed';
      throw new Error(`Citation service unreachable at ${CITATION_SERVICE_URL}. ${msg}`);
    }
    if (!res.ok) await throwIfQuotaResponse(res, 'Failed to start pipeline');
    return res.json(); // { run_id, status: 'running' }
  },

  /**
   * Poll pipeline run status. Returns { status, report_id, report_format } when done.
   */
  async getRunStatus(runId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/runs/${encodeURIComponent(runId)}/status`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) return { status: 'unknown' };
    return res.json();
  },

  /**
   * Get incremental agent logs since a given log id.
   */
  async getRunLogs(runId, sinceTime = '') {
    const params = new URLSearchParams({ limit: '200' });
    if (sinceTime) params.set('since_time', sinceTime);
    const res = await fetch(
      `${CITATION_SERVICE_URL}/citation/runs/${encodeURIComponent(runId)}/logs?${params}`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) return { logs: [] };
    return res.json();
  },

  /**
   * Enterprise analytics for admin dashboard.
   * GET /citation/analytics/enterprise?days=&months=
   */
  async getEnterpriseAnalytics(days = 30, months = 6) {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    if (months) params.set('months', String(months));
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/analytics/enterprise?${params}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) throw new Error('Failed to load analytics');
    return res.json();
  },

  /**
   * Get citation service usage and cost analytics (third-party API costs).
   * FIRM_ADMIN: firm-scoped. SUPER_ADMIN + scope=platform: platform-wide.
   * Query params: days, scope (firm|platform)
   */
  async getUsageAnalytics(days = 30, scope = 'firm') {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    if (scope) params.set('scope', scope);
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/analytics/usage?${params}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) throw new Error('Failed to load usage analytics');
    return res.json();
  },

  /**
   * Search all indexed judgments.
   * GET /citation/judgements/search?q=...&court=...&area=...&status=...&limit=...
   */
  async searchJudgements({ q = '', court = '', area = '', status = '', limit = 100 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (court) params.set('court', court);
    if (area) params.set('area', area);
    if (status) params.set('status', status);
    params.set('limit', limit);
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/judgements/search?${params}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  /**
   * Register for HITL notification when a pending ticket is resolved.
   * POST /citation/hitl/{ticketId}/notify
   */
  async notifyMeOnHitl(ticketId, userId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/hitl/${encodeURIComponent(ticketId)}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ user_id: userId }),
    });
    return res.json().catch(() => ({ success: false }));
  },

  /**
   * Fetch all firm members for the current user (used in share dialog).
   * Calls auth service directly: GET /auth/api/auth/internal/user/:id/firm-members
   */
  async getFirmMembers() {
    const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const uid = _u.id || _u.user_id;
    if (!uid) return { members: [] };
    const res = await fetch(`${AUTH_SERVICE_URL}/internal/user/${uid}/firm-members`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) return { members: [] };
    return res.json();
  },

  /**
   * Team shared reports.
   * FIRM_ADMIN gets all shared reports from firm members.
   * Others get only reports explicitly shared with them.
   * Pass caseId to filter by case (case-specific view).
   * GET /citation/reports/team
   */
  async getTeamReports(memberIds = [], caseId = null) {
    const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const params = new URLSearchParams();
    if (memberIds.length) params.set('member_ids', memberIds.join(','));
    const uid = _u.id ?? _u.user_id;
    const acctType = _u.account_type ?? _u.accountType;
    if (uid) params.set('user_id', String(uid));
    if (acctType) params.set('account_type', String(acctType).toUpperCase());
    if (caseId) params.set('case_id', String(caseId));
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/reports/team?${params}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) return { reports: [] };
    return res.json();
  },

  /**
   * Get current shared_with list for a report.
   * GET /citation/reports/{reportId}/shares
   */
  async getReportShares(reportId) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}/shares`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) return { shared_with: [] };
    return res.json();
  },

  /**
   * Share a report with firm members.
   * POST /citation/reports/{reportId}/share
   * Body: { shared_with: [{user_id, email, username}] }
   */
  async shareReport(reportId, sharedWith) {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ shared_with: sharedWith }),
    });
    if (!res.ok) throw new Error('Failed to share report');
    return res.json();
  },

  /**
   * Generate keyword suggestions for a case in 3 categories.
   * POST /citation/suggest-keywords
   * Returns { statute_keywords, principle_keywords, fact_keywords }
   */
  async suggestKeywords(caseId = null, query = null, caseFileContext = null) {
    const body = {};
    if (caseId) body.case_id = caseId;
    if (query) body.query = query;
    if (caseFileContext?.length) body.case_file_context = caseFileContext;
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/suggest-keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { statute_keywords: [], principle_keywords: [], fact_keywords: [] };
    return res.json();
  },

  /**
   * Manual mode — fetch full judgment for each selected case name.
   * Priority: local DB → IK → Google. Stores results in background.
   * POST /citation/manual/fetch-case-judgments
   */
  async manualFetchCaseJudgments(caseNames, userId = 'anonymous') {
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/manual/fetch-case-judgments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ case_names: caseNames, user_id: userId }),
    });
    if (!res.ok) throw new Error('Failed to fetch case judgments');
    return res.json();
  },

  /**
   * Manual mode — search local DB + IK for each keyword. Stores IK results in background.
   * POST /citation/manual/search-by-keywords
   */
  async manualSearchByKeywords(keywords, userId = 'anonymous', caseId = null) {
    const body = { keywords, user_id: userId };
    if (caseId) body.case_id = caseId;
    const res = await fetch(`${CITATION_SERVICE_URL}/citation/manual/search-by-keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to search by keywords');
    return res.json();
  },

  /**
   * Delete a citation report. Pass userId to restrict to own reports.
   * DELETE /citation/reports/{reportId}?user_id=...
   */
  async deleteReport(reportId, userId = null) {
    let url = `${CITATION_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}`;
    if (userId) url += `?user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || err.error || 'Failed to delete report');
    }
    return res.json();
  },
};

export default citationApi;

