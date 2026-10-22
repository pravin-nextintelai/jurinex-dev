import axios from 'axios';
import { DOCS_BASE_URL, API_BASE_URL } from '@/config/apiConfig';

/** Use API gateway (same host as redirect_uri) so OAuth config stays consistent; avoid calling :5001 while redirect is :5000. */
const GOOGLE_DRIVE_AUTH_URL = `${API_BASE_URL}/api/auth/google/drive`;

const readViteEnv = (name) => {
  const value = import.meta.env?.[name];
  return typeof value === 'string' ? value.trim() : '';
};

export const getGooglePickerApiKey = () =>
  readViteEnv('VITE_GOOGLE_DRIVE_API_KEY') || readViteEnv('VITE_GOOGLE_API_KEY');

export const validateGooglePickerApiKey = (apiKey = getGooglePickerApiKey()) => {
  if (!apiKey) {
    return { valid: false, reason: 'missing' };
  }
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) {
    return { valid: false, reason: 'format' };
  }
  return { valid: true, reason: null };
};

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const googleDriveApi = {
  /**
   * Initiate Google Drive OAuth flow
   * Returns the authorization URL to redirect user to
   * @param {string} [returnTo] - Path to redirect after success (e.g. /draft-form/123?step=6)
   * Uses base64url encoding to avoid query-string parsing issues with ? and & in returnTo.
   */
  initiateAuth: async (returnTo) => {
    let params = {};
    if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(returnTo)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        params = { returnTo: b64 };
      } catch {
        params = { returnTo };
      }
    }
    const response = await axios.get(
      GOOGLE_DRIVE_AUTH_URL,
      { headers: getAuthHeader(), params }
    );
    return response.data;
  },

  /**
   * Complete OAuth callback with authorization code
   */
  handleCallback: async (code, state) => {
    const response = await axios.post(
      `${GOOGLE_DRIVE_AUTH_URL}/callback`,
      { code, state },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Check if user has Google Drive connected
   */
  getConnectionStatus: async () => {
    try {
      const response = await axios.get(
        `${GOOGLE_DRIVE_AUTH_URL}/status`,
        { headers: getAuthHeader() }
      );
      return response.data;
    } catch (error) {
      console.error('[GoogleDrive] Status check error:', error);
      return { connected: false };
    }
  },

  /**
   * Get fresh access token for Google Picker
   */
  getAccessToken: async () => {
    const response = await axios.get(
      `${GOOGLE_DRIVE_AUTH_URL}/token`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Disconnect Google Drive
   */
  disconnect: async () => {
    const response = await axios.delete(
      GOOGLE_DRIVE_AUTH_URL,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Download file from Google Drive to server storage
   * @param {string} fileId - Google Drive file ID
   * @param {string} accessToken - Google OAuth access token from Picker
   * @param {string} folderName - Optional folder name
   */
  downloadFile: async (fileId, accessToken, folderName = null) => {
    if (!folderName) {
      throw new Error('Folder name is required for Google Drive import');
    }
    const response = await axios.post(
      `${DOCS_BASE_URL}/${encodeURIComponent(folderName)}/google-drive/import`,
      { file_ids: [fileId] },
      {
        headers: {
          ...getAuthHeader(),
          'X-Google-Access-Token': accessToken,
        },
      }
    );
    const data = response.data || {};
    return {
      ...data,
      success: Boolean(data.success),
      documents: data.uploadedFiles || [],
      summary: {
        successful: data.google_drive?.imported_count ?? (data.uploadedFiles || []).length,
        failed: data.google_drive?.failed_count ?? 0,
      },
    };
  },

  /**
   * Download multiple files from Google Drive
   * @param {Array} files - Array of {id, name} objects
   * @param {string} accessToken - Google OAuth access token from Picker
   * @param {string} folderName - Optional folder name
   */
  downloadMultipleFiles: async (files, accessToken, folderName = null, opts = {}) => {
    if (!folderName) {
      throw new Error('Folder name is required for Google Drive import');
    }
    const fileIds = (files || [])
      .map((item) => item?.id)
      .filter(Boolean);
    const response = await axios.post(
      `${DOCS_BASE_URL}/${encodeURIComponent(folderName)}/google-drive/import`,
      // process:false → storage-only import (Case Storage), no OCR/embedding pipeline.
      { file_ids: fileIds, ...(opts.process === false ? { process: false } : {}) },
      {
        headers: {
          ...getAuthHeader(),
          'X-Google-Access-Token': accessToken,
        },
      }
    );
    const data = response.data || {};
    return {
      ...data,
      success: Boolean(data.success),
      documents: data.uploadedFiles || [],
      summary: {
        successful: data.google_drive?.imported_count ?? (data.uploadedFiles || []).length,
        failed: data.google_drive?.failed_count ?? 0,
      },
    };
  },

  /**
   * Get file info from Google Drive
   */
  getFileInfo: async (fileId) => {
    const response = await axios.get(
      `${DOCS_BASE_URL}/google-drive/info/${fileId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  }
};

export default googleDriveApi;

/**
 * Google Picker helper functions
 */

// Load Google Picker API script
export const loadGooglePickerApi = () => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.picker) {
      resolve(window.google.picker);
      return;
    }

    // Check if script is already loading
    if (document.querySelector('script[src*="apis.google.com/js/api.js"]')) {
      // Wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.gapi) {
          clearInterval(checkLoaded);
          window.gapi.load('picker', {
            callback: () => resolve(window.google.picker),
            onerror: reject
          });
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      window.gapi.load('picker', {
        callback: () => resolve(window.google.picker),
        onerror: reject
      });
    };
    
    script.onerror = reject;
    document.body.appendChild(script);
  });
};

// Create and show Google Picker with full Google Drive UI (like native Drive picker)
export const openGooglePicker = async ({
  accessToken,
  apiKey,
  onSelect,
  onCancel,
  multiselect = true
}) => {
  const resolvedApiKey = (apiKey || getGooglePickerApiKey() || '').trim();
  const apiKeyValidation = validateGooglePickerApiKey(resolvedApiKey);
  if (!apiKeyValidation.valid) {
    throw new Error(
      'Google Drive Picker API key is missing or invalid. Set VITE_GOOGLE_DRIVE_API_KEY in frontend/.env and restart the frontend.'
    );
  }

  await loadGooglePickerApi();

  // Remove any blur from background when picker opens
  const removeBlur = () => {
    // Remove blur from Google's picker overlay
    const style = document.createElement('style');
    style.id = 'google-picker-no-blur';
    style.textContent = `
      .picker-dialog-bg {
        background: rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .picker-dialog {
        box-shadow: 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2) !important;
      }
    `;
    if (!document.getElementById('google-picker-no-blur')) {
      document.head.appendChild(style);
    }
  };
  removeBlur();

  // Create "Recent" view - shows recently accessed files with GRID layout (thumbnails)
  const recentView = new window.google.picker.DocsView(window.google.picker.ViewId.RECENTLY_PICKED)
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Recent');

  // Create "My Drive" view - browse all files in user's drive
  const myDriveView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setParent('root')
    .setLabel('My Drive');

  // Create "Shared with me" view
  const sharedWithMeView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setOwnedByMe(false)
    .setLabel('Shared with me');

  // Create "Starred" view
  const starredView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setStarred(true)
    .setLabel('Starred');

  const pickerBuilder = new window.google.picker.PickerBuilder()
    .addView(recentView)
    .addView(myDriveView)
    .addView(sharedWithMeView)
    .addView(starredView)
    .setOAuthToken(accessToken)
    .setDeveloperKey(resolvedApiKey)
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const files = data.docs.map(doc => ({
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          url: doc.url,
          iconUrl: doc.iconUrl,
          sizeBytes: doc.sizeBytes
        }));
        onSelect(files);
      } else if (data.action === window.google.picker.Action.CANCEL) {
        if (onCancel) onCancel();
      }
    })
    .setTitle('Select files')
    .setSize(1051, 650)
    .setOrigin(window.location.protocol + '//' + window.location.host);

  // Enable multiselect if requested
  if (multiselect) {
    pickerBuilder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
  }
  
  // Enable shared drives support
  pickerBuilder.enableFeature(window.google.picker.Feature.SUPPORT_DRIVES);

  const picker = pickerBuilder.build();
  picker.setVisible(true);
};
