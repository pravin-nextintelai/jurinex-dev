import { CHAT_DRAFT_BACKEND_URL, getUserIdForDrafting } from '@/config/apiConfig';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

const getAuthToken = () =>
  localStorage.getItem('token') ||
  localStorage.getItem('authToken') ||
  localStorage.getItem('access_token') ||
  localStorage.getItem('jwt') ||
  localStorage.getItem('auth_token');

const authHeaders = () => {
  const headers = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const userId = getUserIdForDrafting();
  if (userId) headers['X-User-Id'] = userId;
  return headers;
};

export const createChatDraftSession = async ({ templateText, templateFile, documents, templateId }) => {
  const form = new FormData();
  if (templateText) form.append('templateText', templateText);
  if (templateFile) form.append('templateFile', templateFile);
  if (templateId) form.append('templateId', templateId);
  (documents || []).forEach((file) => form.append('documents', file));

  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/session`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    await throwIfQuotaResponse(res, 'Failed to create draft session');
  }
  return res.json();
};

export const sendChatDraftMessage = async (sessionId, message) => {
  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    await throwIfQuotaResponse(res, 'Failed to send message');
  }
  return res.json();
};

export const exportChatDraftDocx = async (sessionId) => {
  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/session/${sessionId}/export-docx`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    await throwIfQuotaResponse(res, 'Export failed');
  }
  return res.blob();
};

export const saveChatDraftToGoogleDocs = async ({
  html,
  title,
  draftId,
  existingGoogleFileId,
  userId,
}) => {
  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/upload-google-docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      html,
      title,
      draft_id: draftId,
      existing_google_file_id: existingGoogleFileId,
      user_id: userId,
    }),
  });
  if (!res.ok) {
    await throwIfQuotaResponse(res, 'Failed to save to Google Docs');
  }
  return res.json();
};
