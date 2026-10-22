/**
 * Agent-draft-service API (API_POSTMAN.md).
 * GET /api/templates — list admin templates with optional preview_image_url.
 */

import { AGENT_DRAFT_TEMPLATE_API } from '@/config/apiConfig';

const TEMPLATES_URL = `${AGENT_DRAFT_TEMPLATE_API}/api/templates`;

const getAuthHeaders = () => {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token');
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const userStr = localStorage.getItem('user') || localStorage.getItem('userInfo');
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const id = parsed?.id ?? parsed?.userId ?? parsed?.user_id;
      if (id != null) headers['X-User-Id'] = String(id);
    }
  } catch (_) {}
  return headers;
};

/**
 * Fetch admin template list (agent-draft-service GET /api/templates).
 * Include preview_image_url for gallery. Optional category filter.
 * Use finalized_only=true for draft section (only templates finalized in template section).
 */
export const fetchTemplates = async ({
  category = '',
  is_active = true,
  limit = 50,
  offset = 0,
  include_preview_url = true,
  finalized_only = false,
} = {}) => {
  const params = new URLSearchParams({
    category: String(category),
    is_active: String(is_active),
    limit: String(limit),
    offset: String(offset),
    include_preview_url: String(include_preview_url),
    finalized_only: String(finalized_only),
  });
  const url = `${TEMPLATES_URL}?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${response.status}`);
  }
  return response.json();
};
