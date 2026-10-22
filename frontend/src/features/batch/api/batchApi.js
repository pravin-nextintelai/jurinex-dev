/**
 * Batch API service — wraps all /api/batch/* endpoints on the agentic-document-service.
 */

import { DOCUMENT_SERVICE_URL } from '@/config/apiConfig';

const BASE = `${DOCUMENT_SERVICE_URL}/api/batch`;

function _getToken() {
  return (
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt') ||
    localStorage.getItem('auth_token') ||
    null
  );
}

function _getUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return u.id || u.userId || u.user_id || localStorage.getItem('userId') || localStorage.getItem('user_id') || null;
  } catch { return null; }
}

function authHeaders() {
  const token  = _getToken();
  const userId = _getUserId();
  const headers = { 'Content-Type': 'application/json' };
  if (token)  headers['Authorization'] = `Bearer ${token}`;
  if (userId) headers['X-User-Id']     = String(userId);
  return headers;
}

async function handleResponse(res) {
  let data;
  try { data = await res.json(); } catch { data = { detail: `HTTP ${res.status}` }; }
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}

// ── File upload ───────────────────────────────────────────────────────────────

/**
 * Step 1: get a signed GCS PUT URL.
 * Returns { file_id, upload_url, gcs_path, expires_in_seconds }
 */
export async function generateUploadUrl(filename, contentType = 'application/pdf') {
  const res = await fetch(`${BASE}/files/generate-upload-url`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ filename, content_type: contentType }),
  });
  return handleResponse(res);
}

/**
 * Step 2: upload file bytes directly to GCS via the signed URL.
 * @param {string} signedUrl
 * @param {File} file
 * @param {function} onProgress  - optional (loaded, total) callback
 */
export async function uploadToGcs(signedUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/pdf');
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`GCS upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('GCS upload network error'));
    xhr.send(file);
  });
}

/**
 * Step 3: notify backend that the upload is done → starts background processing.
 */
export async function completeUpload(fileId, gcsPath, filename, fileSizeBytes) {
  const res = await fetch(`${BASE}/files/complete-upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      file_id: fileId,
      gcs_path: gcsPath,
      filename,
      file_size_bytes: fileSizeBytes,
    }),
  });
  return handleResponse(res);
}

/** Poll file processing status. Returns BatchFileInfo. */
export async function getFileStatus(fileId) {
  const res = await fetch(`${BASE}/files/${fileId}/status`, { headers: authHeaders() });
  return handleResponse(res);
}

/** List all batch files for the current user. */
export async function listBatchFiles() {
  const res = await fetch(`${BASE}/files`, { headers: authHeaders() });
  return handleResponse(res);
}

// ── Batch jobs ────────────────────────────────────────────────────────────────

/**
 * Create a new batch job.
 * @param {object} params
 * @param {string}   params.display_name
 * @param {string[]} params.queries          — up to 200,000
 * @param {string}  [params.file_id]         — optional uploaded file ID
 * @param {string}  [params.model]           — defaults to gemini-2.0-flash
 * @param {string}  [params.system_instruction]
 */
export async function createBatchJob(params) {
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  });
  return handleResponse(res);
}

/** List batch jobs for the current user. */
export async function listBatchJobs(limit = 50, offset = 0) {
  const res = await fetch(`${BASE}/jobs?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

/** Get a single batch job (polls Gemini for live status). */
export async function getBatchJob(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}`, { headers: authHeaders() });
  return handleResponse(res);
}

/** Get results for a completed batch job (paginated). */
export async function getBatchJobResults(jobId, page = 0, limit = 100, {
  textLimit = 0,
  requestKey = null,
  includeText = true,
  queryOffset = 0,
  responseOffset = 0,
  fields = 'both',
} = {}) {
  const offset = page * limit;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (textLimit > 0) params.set('text_limit', String(textLimit));
  if (requestKey) params.set('request_key', requestKey);
  if (!includeText) params.set('include_text', 'false');
  if (queryOffset > 0) params.set('query_offset', String(queryOffset));
  if (responseOffset > 0) params.set('response_offset', String(responseOffset));
  if (fields && fields !== 'both') params.set('fields', fields);
  const res = await fetch(`${BASE}/jobs/${jobId}/results?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

/** Fetch one result row (optionally with offset/limit windows). */
export async function getBatchJobResult(jobId, requestKey, {
  textLimit = 100000,
  queryOffset = 0,
  responseOffset = 0,
  fields = 'both',
} = {}) {
  return getBatchJobResults(jobId, 0, 1, {
    textLimit,
    requestKey,
    includeText: true,
    queryOffset,
    responseOffset,
    fields,
  });
}

/**
 * Get full reusable config for a job (queries list, model, system_instruction, file info).
 * Used by the Job History "Reuse" flow.
 */
export async function getBatchJobConfig(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}/config`, { headers: authHeaders() });
  return handleResponse(res);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function listSessions() {
  const res = await fetch(`${BASE}/sessions`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function createSession(name, description = '') {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, description }),
  });
  return handleResponse(res);
}

export async function renameSession(sessionId, name) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  return handleResponse(res);
}

export async function deleteSession(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function listSessionJobs(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/jobs`, { headers: authHeaders() });
  return handleResponse(res);
}

/** Cancel a batch job. */
export async function cancelBatchJob(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Full upload flow: generateUploadUrl → uploadToGcs → completeUpload.
 * @param {File} file
 * @param {function} onProgress  — optional (0–100) percent callback
 * Returns { file_id, gcs_path }
 */
export async function uploadBatchFile(file, onProgress) {
  const { file_id, upload_url, gcs_path } = await generateUploadUrl(file.name, file.type || 'application/pdf');
  await uploadToGcs(upload_url, file, (loaded, total) => {
    if (onProgress) onProgress(Math.round((loaded / total) * 100));
  });
  await completeUpload(file_id, gcs_path, file.name, file.size);
  return { file_id, gcs_path };
}

/** Parse queries from a plain-text string (one per line, blank lines ignored). */
export function parseQueriesFromText(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Parse queries from a CSV or TXT File object (reads as text). */
export async function parseQueriesFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(parseQueriesFromText(e.target.result));
    reader.onerror = () => reject(new Error('Could not read queries file'));
    reader.readAsText(file);
  });
}

export const STATUS_LABELS = {
  CREATING: 'Creating',
  JOB_STATE_PENDING: 'Queued',
  JOB_STATE_RUNNING: 'Running',
  JOB_STATE_SUCCEEDED: 'Completed',
  JOB_STATE_FAILED: 'Failed',
  JOB_STATE_CANCELLED: 'Cancelled',
  JOB_STATE_EXPIRED: 'Expired',
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export const STATUS_COLORS = {
  CREATING: 'bg-gray-100 text-gray-600',
  JOB_STATE_PENDING: 'bg-blue-100 text-blue-700',
  JOB_STATE_RUNNING: 'bg-amber-100 text-amber-700',
  JOB_STATE_SUCCEEDED: 'bg-emerald-100 text-emerald-700',
  JOB_STATE_FAILED: 'bg-red-100 text-red-600',
  JOB_STATE_CANCELLED: 'bg-gray-100 text-gray-500',
  JOB_STATE_EXPIRED: 'bg-orange-100 text-orange-600',
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  ready: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-600',
};
