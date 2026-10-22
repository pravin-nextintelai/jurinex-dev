import axios from 'axios';
import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

/**
 * Drafting Service API
 * Handles all API calls to the Drafting microservice
 */

const getAuthHeader = () => {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const draftingApi = {
  /**
   * Create a new draft from a Google Docs template
   * @param {Object} data - Draft creation data
   * @param {string} data.templateFileId - Google Drive file ID of the template
   * @param {string} data.googleAccessToken - User's Google OAuth access token
   * @param {string} [data.draftName] - Optional custom name for the draft
   * @param {Object} [data.metadata] - Optional metadata/variables to store
   * @param {string} [data.folderId] - Optional destination folder ID in Google Drive
   * @returns {Promise<Object>} Created draft
   */
  initiateDraft: async (data) => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/initiate`,
      data,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Create a new blank Google Docs document
   * @param {string} title - Document title
   * @param {string} googleAccessToken - User's Google OAuth access token
   * @returns {Promise<Object>} Created draft
   */
  createDocument: async (title, googleAccessToken) => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/create`,
      { title, googleAccessToken },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Populate a draft with template variables
   * @param {string} draftId - Draft UUID
   * @param {Object} data - Population data
   * @param {string} data.googleAccessToken - User's Google OAuth access token
   * @param {Object} data.variables - Key-value pairs for placeholder replacement
   * @param {boolean} [data.saveToMetadata] - Whether to save variables to metadata
   * @returns {Promise<Object>} Update result
   */
  populateDraft: async (draftId, data) => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/populate/${draftId}`,
      data,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get all drafts for the current user
   * @param {Object} [options] - Query options
   * @param {string} [options.status] - Filter by status (DRAFTING or FINALIZED)
   * @param {number} [options.limit] - Number of results to return
   * @param {number} [options.offset] - Pagination offset
   * @returns {Promise<Object>} Drafts list with pagination
   */
  listDrafts: async (options = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);

    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts?${params.toString()}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get a specific draft by ID
   * @param {string} draftId - Draft UUID
   * @returns {Promise<Object>} Draft details
   */
  getDraft: async (draftId) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Open a draft for editing
   * Returns either Google Docs editor URL or GCS download URL if file is deleted
   * @param {string} draftId - Draft ID
   * @returns {Promise<Object>} Response with editorUrl or downloadUrl
   */
  openDraft: async (draftId) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/open`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get placeholders from a draft document
   * @param {string} draftId - Draft UUID
   * @param {string} googleAccessToken - User's Google OAuth access token
   * @returns {Promise<Object>} Placeholders array
   */
  getPlaceholders: async (draftId, googleAccessToken) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/placeholders`,
      { 
        headers: getAuthHeader(),
        params: { googleAccessToken }
      }
    );
    return response.data;
  },

  /**
   * Finalize a draft (mark as complete)
   * @param {string} draftId - Draft UUID
   * @returns {Promise<Object>} Updated draft
   */
  finalizeDraft: async (draftId) => {
    const response = await axios.patch(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/finalize`,
      {},
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Delete a draft
   * @param {string} draftId - Draft UUID
   * @returns {Promise<Object>} Deletion result
   */
  deleteDraft: async (draftId) => {
    const response = await axios.delete(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Sync draft to GCS (save document)
   * Exports the current Google Doc version and overwrites the file at the existing gcs_path
   * @param {string} draftId - Draft ID
   * @param {string} [format] - Export format: 'docx' or 'pdf' (default: 'docx')
   * @returns {Promise<Object>} Sync result with gcsPath, syncedAt, draftId, exportFormat
   */
  syncToGCS: async (draftId, format = 'docx') => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/sync`,
      { format },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get GCS signed URL for downloaded document
   * @param {string} draftId - Draft ID
   * @param {number} [expiresInHours] - URL expiration in hours (default: 24)
   * @returns {Promise<Object>} Signed URL
   */
  getGCSUrl: async (draftId, expiresInHours = 24) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/gcs-url?expiresInHours=${expiresInHours}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Share draft with another user
   * @param {string} draftId - Draft ID
   * @param {string} googleAccessToken - Google OAuth access token
   * @param {string} email - Email of user to share with
   * @param {string} [role] - Permission role: 'reader', 'commenter', or 'writer' (default: 'writer')
   * @returns {Promise<Object>} Share result
   */
  shareDraft: async (draftId, googleAccessToken, email, role = 'writer') => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/share`,
      { googleAccessToken, email, role },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get permissions for a draft
   * @param {string} draftId - Draft ID
   * @param {string} googleAccessToken - Google OAuth access token
   * @returns {Promise<Object>} Permissions list
   */
  getDraftPermissions: async (draftId, googleAccessToken) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/permissions`,
      { 
        headers: getAuthHeader(),
        params: { googleAccessToken }
      }
    );
    return response.data;
  },

  /**
   * Make draft public (anyone with link)
   * @param {string} draftId - Draft ID
   * @param {string} googleAccessToken - Google OAuth access token
   * @param {string} [role] - Permission role: 'reader', 'commenter', or 'writer' (default: 'reader')
   * @returns {Promise<Object>} Result
   */
  makeDraftPublic: async (draftId, googleAccessToken, role = 'reader') => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/make-public`,
      { googleAccessToken, role },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Remove a permission (revoke access)
   * @param {string} draftId - Draft ID
   * @param {string} permissionId - Permission ID to remove
   * @param {string} googleAccessToken - Google OAuth access token
   * @returns {Promise<Object>} Result
   */
  removePermission: async (draftId, permissionId, googleAccessToken) => {
    const response = await axios.delete(
      `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}/permissions/${permissionId}`,
      { 
        headers: getAuthHeader(),
        data: { googleAccessToken }
      }
    );
    return response.data;
  },

  /**
   * Health check for the drafting service
   * @returns {Promise<Object>} Health status
   */
  healthCheck: async () => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/health`
    );
    return response.data;
  },

  // ========== Microsoft Word API Methods ==========

  /**
   * Check Microsoft Office connection status
   * @returns {Promise<Object>} Connection status and auth URL if not connected
   */
  checkMicrosoftConnection: async () => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/microsoft/auth/status`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get Microsoft OAuth sign-in URL
   * @returns {Promise<Object>} Auth URL
   */
  getMicrosoftAuthUrl: async () => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/microsoft/auth/signin`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * List Microsoft Word documents
   * @param {Object} [options] - Query options
   * @param {string} [options.status] - Filter by status
   * @param {number} [options.limit] - Number of results
   * @param {number} [options.offset] - Pagination offset
   * @returns {Promise<Object>} Documents list with pagination
   */
  listMicrosoftDocuments: async (options = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);

    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/microsoft/documents/list?${params.toString()}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Create a new Microsoft Word document
   * @param {string} title - Document title
   * @param {string} [templateId] - Template ID (default: 'blank')
   * @returns {Promise<Object>} Created document
   */
  createMicrosoftDocument: async (title, templateId = 'blank') => {
    const response = await axios.post(
      `${DRAFTING_SERVICE_URL}/api/microsoft/documents/create`,
      { title, templateId },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Open a Microsoft Word document
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Document URL and details
   */
  openMicrosoftDocument: async (documentId) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/microsoft/documents/${documentId}/open`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Download a Microsoft Word document
   * @param {string} documentId - Document ID
   * @returns {Promise<Blob>} Document file blob
   */
  downloadMicrosoftDocument: async (documentId) => {
    const response = await axios.get(
      `${DRAFTING_SERVICE_URL}/api/microsoft/documents/${documentId}/download`,
      { 
        headers: getAuthHeader(),
        responseType: 'blob'
      }
    );
    return response.data;
  },

  /**
   * Delete a Microsoft Word document
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Deletion result
   */
  deleteMicrosoftDocument: async (documentId) => {
    const response = await axios.delete(
      `${DRAFTING_SERVICE_URL}/api/microsoft/documents/${documentId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  }
};

export default draftingApi;

/**
 * Helper function to generate the Google Docs editor URL
 * @param {string} googleFileId - Google Drive file ID
 * @param {Object} [options] - URL options
 * @param {boolean} [options.minimal] - Use minimal UI (rm=minimal)
 * @param {boolean} [options.embedded] - Add embedded parameter
 * @returns {string} Google Docs URL
 */
export const getGoogleDocsUrl = (googleFileId, options = {}) => {
  // Return full Google Docs UI (no minimal parameter)
  // This shows the complete Google Docs interface with menus, toolbar, etc.
  let url = `https://docs.google.com/document/d/${googleFileId}/edit`;
  
  const params = [];
  // Only add minimal if explicitly requested (default is full UI)
  if (options.minimal) {
    params.push('rm=minimal');
  }
  if (options.embedded) {
    params.push('embedded=true');
  }
  
  if (params.length > 0) {
    url += '?' + params.join('&');
  }
  
  return url;
};

/**
 * Helper function to generate the Google Docs preview URL
 * @param {string} googleFileId - Google Drive file ID
 * @returns {string} Google Docs preview URL
 */
export const getGoogleDocsPreviewUrl = (googleFileId) => {
  return `https://docs.google.com/document/d/${googleFileId}/preview`;
};

