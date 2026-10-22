/**
 * Citation Service V1 API — ADK + Claude + Serper pipeline.
 * Base URL: CITATION_V1_SERVICE_URL  (citation-service-v1, port 8002 local)
 *
 * Mirrors the citationApi interface so CitationReportPage can swap between
 * the two services with no other code changes.
 */
import { CITATION_V1_SERVICE_URL, AUTH_SERVICE_URL } from '@/config/apiConfig';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

function getAuthHeader() {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt') ||
    localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function resolveUserId(explicit) {
  if (explicit != null && explicit !== '' && String(explicit).toLowerCase() !== 'anonymous') {
    return String(explicit).trim();
  }
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    const id = u.id ?? u.user_id ?? u.userId;
    if (id != null && String(id).trim()) return String(id).trim();
  } catch { /* ignore */ }
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token');
  if (token && token.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const id = payload.id ?? payload.userId ?? payload.sub;
      if (id != null && String(id).trim()) return String(id).trim();
    } catch { /* ignore */ }
  }
  return 'anonymous';
}

/** Normalise v1 log entries: backend uses "ts" key; frontend polling expects "created_at". */
function normalizeLogs(logs = []) {
  return logs.map(l => ({ ...l, created_at: l.created_at || l.ts || '' }));
}

export const citationV1Api = {
  /**
   * Start citation pipeline (ADK + Claude + Serper) in background.
   * Returns { run_id, status: "running" } immediately.
   */
  async startReport(
    query,
    userId = 'anonymous',
    caseId = null,
    caseFileContext = null,
    perspective = 'all',
    retrievalMethod = 'serper',
  ) {
    const body = {
      query,
      user_id: resolveUserId(userId),
      use_pipeline: true,
      retrieval_method: retrievalMethod || 'serper',
    };
    if (caseId) body.case_id = caseId;
    if (caseFileContext?.length) body.case_file_context = caseFileContext;
    if (perspective && perspective !== 'all') body.perspective = perspective;

    let res;
    try {
      res = await fetch(`${CITATION_V1_SERVICE_URL}/citation/report/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Citation V1 service unreachable at ${CITATION_V1_SERVICE_URL}. ${err?.message || 'Network error'}`,
      );
    }
    if (!res.ok) await throwIfQuotaResponse(res, 'Failed to start V1 pipeline');
    return res.json();
  },

  /**
   * Generate citation report synchronously (blocks until complete).
   * Returns { success, report_id, report_format, run_id }
   */
  async generateReport(
    query,
    userId = 'anonymous',
    usePipeline = true,
    caseFileContext = null,
    caseId = null,
    perspective = 'all',
    retrievalMethod = 'serper',
  ) {
    const body = {
      query,
      user_id: resolveUserId(userId),
      use_pipeline: usePipeline,
      retrieval_method: retrievalMethod || 'serper',
    };
    if (caseFileContext?.length) body.case_file_context = caseFileContext;
    if (caseId) body.case_id = caseId;
    if (perspective && perspective !== 'all') body.perspective = perspective;

    const res = await fetch(`${CITATION_V1_SERVICE_URL}/citation/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || err.error || 'Failed to generate V1 report');
    }
    return res.json();
  },

  /** Poll run status — { status, progress, stage, report_id, report_format, error } */
  async getRunStatus(runId) {
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/runs/${encodeURIComponent(runId)}/status`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) return { status: 'unknown' };
    return res.json();
  },

  /**
   * Get incremental agent logs (plan steps + execution logs) since sinceTime.
   * Log entries include planning steps from each agent.
   */
  async getRunLogs(runId, sinceTime = '') {
    const params = new URLSearchParams({ limit: '200' });
    if (sinceTime) params.set('since_time', sinceTime);
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/runs/${encodeURIComponent(runId)}/logs?${params}`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) return { logs: [] };
    const data = await res.json();
    // Normalise ts → created_at so existing frontend polling logic works
    return { ...data, logs: normalizeLogs(data.logs || []) };
  },

  /** List reports for a user (optionally filtered by case_id). */
  async listReports(userId, caseId = null) {
    let url = `${CITATION_V1_SERVICE_URL}/citation/reports?user_id=${encodeURIComponent(userId)}`;
    if (caseId) url += `&case_id=${encodeURIComponent(caseId)}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { headers: getAuthHeader(), signal: controller.signal });
      if (!res.ok) throw new Error('Failed to list V1 reports');
      return res.json();
    } finally {
      clearTimeout(tid);
    }
  },

  async listReportsByCase(caseId, userId) {
    return this.listReports(userId, caseId);
  },

  /** Get one report by ID. */
  async getReport(reportId) {
    const res = await fetch(`${CITATION_V1_SERVICE_URL}/citation/reports/${reportId}`, {
      headers: getAuthHeader(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch V1 report');
    }
    return res.json();
  },

  /** Get full text of a judgment (by canonical_id e.g. "ik:123456"). */
  async getJudgementFullText(canonicalId) {
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/judgements/${encodeURIComponent(canonicalId)}/full-text`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch judgment');
    }
    return res.json();
  },

  /** Get citation graph (cite/cited-by) for a judgment. */
  async getCaseCitationGraph(canonicalId) {
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/cases/${encodeURIComponent(canonicalId)}/graph`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) return { nodes: [], edges: [] };
    return res.json();
  },

  /** Search indexed judgments. */
  async searchJudgements({ q = '', court = '', area = '', limit = 100 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (court) params.set('court', court);
    if (area) params.set('area', area);
    params.set('limit', String(limit));
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/judgements/search?${params}`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  /** Delete a citation report. */
  async deleteReport(reportId, userId = null) {
    let url = `${CITATION_V1_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}`;
    if (userId) url += `?user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to delete report');
    }
    return res.json();
  },

  /** Share a report with firm members. */
  async shareReport(reportId, sharedWith) {
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}/share`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ shared_with: sharedWith }),
      },
    );
    if (!res.ok) throw new Error('Failed to share report');
    return res.json();
  },

  async getReportShares(reportId) {
    const res = await fetch(
      `${CITATION_V1_SERVICE_URL}/citation/reports/${encodeURIComponent(reportId)}/shares`,
      { headers: getAuthHeader() },
    );
    if (!res.ok) return { shared_with: [] };
    return res.json();
  },

  /** Stubs for API surface compatibility */
  async getEnterpriseAnalytics() {
    return { service: 'v1-adk', note: 'analytics not available in V1' };
  },
  async getUsageAnalytics() {
    return { service: 'v1-adk', note: 'analytics not available in V1' };
  },
  async getFirmMembers() {
    // Fall back to the auth service — same endpoint regardless of citation version
    try {
      const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
      const uid = _u.id || _u.user_id;
      if (!uid) return { members: [] };
      const res = await fetch(`${AUTH_SERVICE_URL}/internal/user/${uid}/firm-members`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) return { members: [] };
      return res.json();
    } catch { return { members: [] }; }
  },
  async getTeamReports() { return { reports: [] }; },
  async notifyMeOnHitl() { return { success: false }; },
};

export default citationV1Api;
