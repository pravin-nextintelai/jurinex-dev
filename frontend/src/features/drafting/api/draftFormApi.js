/**
 * Draft form API: create draft from template, get draft (with fields + values), update field values.
 * Uses agent-draft-service (Draft_DB). Supports both System and Custom (user-uploaded) templates.
 * Custom Template Isolation: send Authorization and X-User-Id so backend can fetch user templates from Template Analyzer.
 */

import { AGENT_DRAFT_TEMPLATE_API, getUserIdForDrafting } from '@/config/apiConfig';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

const BASE = `${AGENT_DRAFT_TEMPLATE_API}/api`;

/** Log API activity to console (method, url, label). */
const logApi = (method, url, label) => {
  console.log('[API]', method, url, label ? `— ${label}` : '');
};

const getAuthToken = () =>
  localStorage.getItem('token') ||
  localStorage.getItem('authToken') ||
  localStorage.getItem('access_token') ||
  localStorage.getItem('jwt') ||
  localStorage.getItem('auth_token');

const headers = () => {
  const token = getAuthToken();
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const userId = getUserIdForDrafting();
  if (userId) h['X-User-Id'] = userId;
  return h;
};

/**
 * Get full template: metadata, fields, sections, and preview image URL.
 * Single call for both admin and user custom templates (agent-draft-service).
 * Use this when you need template + fields + sections + preview_image_url in one request.
 */
export const getTemplate = async (templateId, options = {}) => {
  const { includeSections = true, includePreviewUrl = true } = options;
  const params = new URLSearchParams();
  if (includeSections !== undefined) params.set('include_sections', String(includeSections));
  if (includePreviewUrl !== undefined) params.set('include_preview_url', String(includePreviewUrl));
  const qs = params.toString();
  const url = `${BASE}/templates/${templateId}${qs ? `?${qs}` : ''}`;
  logApi('GET', url, 'getTemplate');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get form field schema for a template (no auth required for this endpoint).
 */
export const getTemplateFields = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/fields`, 'getTemplateFields');
  const res = await fetch(`${BASE}/templates/${templateId}/fields`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get configured sections for a template from the database.
 * Returns the template-specific sections stored in user_template_analysis_sections or template_sections.
 */
export const getTemplateSections = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/sections`, 'getTemplateSections');
  const res = await fetch(`${BASE}/templates/${templateId}/sections`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get universal sections that apply to all legal templates.
 * Returns 23 standard sections with default prompts that users can customize.
 * Use this instead of hardcoded UNIVERSAL_SECTIONS constant.
 */
export const getUniversalSections = async () => {
  logApi('GET', `${BASE}/universal-sections`, 'getUniversalSections');
  const res = await fetch(`${BASE}/universal-sections`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get template preview image URL only (signed GCS or user template image_url).
 */
export const getTemplatePreviewImage = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/preview-image`, 'getTemplatePreviewImage');
  const res = await fetch(`${BASE}/templates/${templateId}/preview-image`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get signed GCS URL for template HTML content (agent-draft-service).
 * Used by Drafter agent for visual reference. GET /api/templates/{template_id}/url
 */
export const getTemplateUrl = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/url`, 'getTemplateUrl');
  const res = await fetch(`${BASE}/templates/${templateId}/url`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Create a new draft from a template (clone + attach to current user). Requires JWT.
 * @returns { draft_id, template_id, draft_title, status, ... }
 */
export const createDraft = async (templateId, draftTitle = '') => {
  logApi('POST', `${BASE}/drafts`, 'createDraft');
  const res = await fetch(`${BASE}/drafts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, draft_title: draftTitle || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * List current user's drafts (recent first). Requires JWT.
 */
export const listDrafts = async (status = null, limit = 50, offset = 0, templateId = null) => {
  const params = new URLSearchParams({ limit, offset });
  if (status) params.set('status', status);
  if (templateId) params.set('template_id', templateId);
  const url = `${BASE}/drafts?${params}`;
  logApi('GET', url, 'listDrafts');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get the latest draft for this template for the current user. Returns { success, draft } (draft may be null).
 * Use this before creating: if draft exists, open it; else create new.
 */
export const getLatestDraftForTemplate = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/drafts/latest`, 'getLatestDraftForTemplate');
  const res = await fetch(`${BASE}/templates/${templateId}/drafts/latest`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get a draft with template info, form fields schema, and current field values. Requires JWT.
 */
export const getDraft = async (draftId) => {
  logApi('GET', `${BASE}/drafts/${draftId}`, 'getDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get autopopulated field values from InjectionAgent (template_user_field_values).
 * Use with template_id and draft_session_id (= draftId) to show agent-filled form values.
 */
export const getTemplateUserFieldValues = async (templateId, draftSessionId = '') => {
  const params = new URLSearchParams({ template_id: templateId });
  if (draftSessionId) params.set('draft_session_id', draftSessionId);
  const url = `${BASE}/template-user-field-values?${params}`;
  logApi('GET', url, 'getTemplateUserFieldValues');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Save form field values and user-edited tracking (for InjectionAgent merge).
 * Call when user saves the form so agent does not overwrite user-edited fields.
 */
export const saveTemplateUserFieldValues = async (
  templateId,
  fieldValues,
  userEditedFields = [],
  draftSessionId = ''
) => {
  logApi('POST', `${BASE}/template-user-field-values`, 'saveTemplateUserFieldValues');
  const res = await fetch(`${BASE}/template-user-field-values`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      template_id: templateId,
      draft_session_id: draftSessionId || undefined,
      field_values: fieldValues,
      user_edited_fields: userEditedFields,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Update field values for a draft. Requires JWT.
 */
export const updateDraftFields = async (draftId, fieldValues, filledFields = null) => {
  logApi('PUT', `${BASE}/drafts/${draftId}`, 'updateDraftFields');
  const body = filledFields !== null
    ? { field_values: fieldValues, filled_fields: filledFields }
    : { field_values: fieldValues };
  const res = await fetch(`${BASE}/drafts/${draftId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Persist lightweight UI state (current step/method/chat mode) for resume.
 */
export const saveDraftUiState = async (draftId, uiState = {}) => {
  logApi('POST', `${BASE}/drafts/${draftId}/ui-state`, 'saveDraftUiState');
  const res = await fetch(`${BASE}/drafts/${draftId}/ui-state`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ui_state: uiState }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Rename a draft. Updates the draft title. Requires JWT (owner only).
 */
export const renameDraft = async (draftId, newTitle) => {
  logApi('PATCH', `${BASE}/drafts/${draftId}/rename`, 'renameDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}/rename`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ new_title: newTitle }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Delete a draft and its field data. Requires JWT (owner only).
 */
export const deleteDraft = async (draftId) => {
  logApi('DELETE', `${BASE}/drafts/${draftId}`, 'deleteDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Save the uploaded file name to draft metadata so it is shown when the draft is reopened.
 */
export const setUploadedFileNameInDraft = async (draftId, fileName) => {
  logApi('POST', `${BASE}/drafts/${draftId}/uploaded-file`, 'setUploadedFileNameInDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}/uploaded-file`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ file_name: fileName || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Link an uploaded file (by file_id) to this draft so the Librarian fetches only this draft's context.
 * Call this after upload when the response includes file_id. Stores file_id in metadata.uploaded_file_ids.
 */
export const linkFileToDraft = async (draftId, fileId, fileName = null) => {
  logApi('POST', `${BASE}/drafts/${draftId}/link-file`, 'linkFileToDraft');
  const body = { file_id: fileId };
  if (fileName != null) body.file_name = fileName;
  const res = await fetch(`${BASE}/drafts/${draftId}/link-file`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Attach a case to the draft. Case data (files/context) will be used by the agent.
 */
export const attachCaseToDraft = async (draftId, caseId, caseTitle = null) => {
  logApi('POST', `${BASE}/drafts/${draftId}/attach-case`, 'attachCaseToDraft');
  const body = { case_id: caseId };
  if (caseTitle != null) body.case_title = caseTitle;
  const res = await fetch(`${BASE}/drafts/${draftId}/attach-case`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Upload a document for the draft. Orchestrator sends task to ingestion agent (GCS → Document AI → chunk → embed → DB).
 * When templateId is provided, backend runs InjectionAgent to autofill form fields from the document.
 * @param {File} file - The file to upload
 * @param {{ draftId?: string, caseId?: string, templateId?: string }} options - Optional draft, case, and template (for autofill)
 */
export const uploadDocumentForDraft = async (file, options = {}) => {
  logApi('POST', `${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload`, 'uploadDocumentForDraft (Orchestrator → Ingestion)');
  const h = headers();
  const { 'Content-Type': _drop, ...authHeaders } = h; // FormData needs browser-set Content-Type with boundary
  const form = new FormData();
  form.append('file', file);
  if (options.draftId) form.append('draft_id', options.draftId);
  if (options.caseId) form.append('case_id', options.caseId);
  if (options.templateId) form.append('template_id', options.templateId);
  const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  if (!res.ok) await throwIfQuotaResponse(res, 'Upload failed');
  return res.json();
};

/**
 * Upload multiple documents for the draft. Creates 1 Draft Job + N Document Jobs; parallel workers
 * process each doc (OCR → chunk → embed → store). When all complete, draft job is marked complete.
 * @param {File[]} files - Array of files to upload
 * @param {{ draftId: string, caseId?: string, templateId?: string }} options - draftId required; optional caseId, templateId
 * @returns {Promise<{ draft_job_id: string, batch_id: string, job_ids: string[], total: number, draft_id: string }>}
 */
export const uploadDocumentsForDraft = async (files, options = {}) => {
  logApi('POST', `${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload-multiple`, 'uploadDocumentsForDraft (draft job + parallel workers)');
  const h = headers();
  const { 'Content-Type': _drop, ...authHeaders } = h;
  const form = new FormData();
  if (Array.isArray(files)) {
    files.forEach((file) => form.append('files', file));
  } else {
    form.append('files', files);
  }
  if (options.draftId) form.append('draft_id', options.draftId);
  if (options.caseId) form.append('case_id', options.caseId);
  if (options.templateId) form.append('template_id', options.templateId);
  const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload-multiple`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  if (!res.ok) await throwIfQuotaResponse(res, 'Upload failed');
  return res.json();
};

/**
 * Get draft job status (1 parent job for N document jobs). Poll until status === 'complete', then all chunks are ready for draft generation.
 * @param {string} draftJobId - From uploadDocumentsForDraft response (draft_job_id)
 * @returns {Promise<{ draft_job_id: string, draft_id: string, status: 'processing'|'complete', jobs: object[], all_done: boolean, file_ids: string[], finished_count: number, failed_count: number, total: number }>}
 */
export const getDraftJobStatus = async (draftJobId) => {
  const url = `${AGENT_DRAFT_TEMPLATE_API}/api/ingestion/draft-jobs/${draftJobId}`;
  logApi('GET', url, 'getDraftJobStatus');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get ingestion batch status (for multi-document upload). jobIds optional (batch_id is draft_job_id).
 * Prefer getDraftJobStatus(draftJobId) when you have draft_job_id.
 * @param {string} batchId - Same as draft_job_id from uploadDocumentsForDraft
 * @param {string[]} [jobIds] - Optional; if omitted, backend returns draft job status by batch_id
 */
export const getIngestionBatchStatus = async (batchId, jobIds) => {
  const ids = Array.isArray(jobIds) ? jobIds : jobIds ? [jobIds] : [];
  const url = ids.length
    ? `${AGENT_DRAFT_TEMPLATE_API}/api/ingestion/batches/${batchId}?job_ids=${ids.join(',')}`
    : `${AGENT_DRAFT_TEMPLATE_API}/api/ingestion/batches/${batchId}`;
  logApi('GET', url, 'getIngestionBatchStatus');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};
