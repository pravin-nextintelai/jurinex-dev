/**
 * Drafting Office Integrator API Service
 *
 * All API calls for Office Integrator embedded editor.
 * Handles authentication, error mapping, and response handling.
 * 
 * Endpoints:
 * - POST /drafting/oi/upload
 * - POST /drafting/oi/session
 * - POST /drafting/oi/save
 * - GET  /drafting/oi/list
 * - GET  /drafting/oi/:draftId/download
 */

import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

const DRAFTING_API_BASE =
    import.meta.env.VITE_DRAFTING_API_URL || DRAFTING_SERVICE_URL;

/**
 * Get JWT token from localStorage
 */
const getToken = () => localStorage.getItem("token");

/**
 * Build request headers with JWT
 */
const buildHeaders = (isJson = true) => {
    const headers = {};
    const token = getToken();

    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (isJson) headers["Content-Type"] = "application/json";
    return headers;
};

/**
 * Handle API response with proper error mapping
 */
const handleResponse = async (response, operation) => {
    if (response.status === 401) {
        console.error(`[DraftingOI] Unauthorized - redirecting to login`);
        window.location.href = "/login";
        throw new Error("Session expired. Please login again.");
    }

    if (response.status === 403) {
        throw new Error("Access denied. You do not have permission to perform this action.");
    }

    if (response.status === 404) {
        throw new Error("Resource not found.");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const errorMsg = data.error || data.message || `${operation} failed`;
        console.error(`[DraftingOI] ${operation} failed:`, errorMsg);
        throw new Error(errorMsg);
    }

    return data;
};

/**
 * Upload file to create a new draft
 * POST /drafting/oi/upload
 */
export const uploadFile = async (file) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Uploading file: ${file.name}`);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    });

    return handleResponse(response, "Upload");
};

/**
 * Create Office Integrator session (get iframe URL)
 * POST /drafting/oi/session
 */
export const createSession = async (draftId) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Creating session for draft: ${draftId}`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/session`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ draftId }),
    });

    return handleResponse(response, "CreateSession");
};

/**
 * Save document (export from OI, store to GCS)
 * POST /drafting/oi/save
 */
export const saveDraft = async (draftId, sessionId) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Saving draft: ${draftId}`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/save`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ draftId, sessionId }),
    });

    return handleResponse(response, "Save");
};

/**
 * List user's drafts/documents
 * GET /drafting/oi/list
 */
// export const listDrafts = async () => {
//     const token = getToken();
//     if (!token) throw new Error("Not authenticated. Please login.");

//     console.log(`[DraftingOI] Listing drafts`);

//     const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/list`, {
//         method: "GET",
//         headers: buildHeaders(false),
//     });

//     return handleResponse(response, "ListDrafts");
// };

// /**
//  * Get download URL for a document
//  * GET /drafting/oi/:draftId/download
//  */
// export const getDownloadUrl = async (draftId) => {
//     const token = getToken();
//     if (!token) throw new Error("Not authenticated. Please login.");

//     console.log(`[DraftingOI] Getting download URL: ${draftId}`);

//     const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/${draftId}/download`, {
//         method: "GET",
//         headers: buildHeaders(false),
//     });

//     return handleResponse(response, "Download");
// };

/**
 * Download file directly (opens browser download)
 * 
 * 
 * 
 * 
 * 
 * 
 */

export const listDrafts = async () => {
    const token = getToken();
    if (!token) throw new Error('Not authenticated. Please login.');

    console.log(`[DraftingOI] Listing drafts`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/list`, {
        method: 'GET',
        headers: buildHeaders(false) // ✅ no Content-Type for GET
    });

    return handleResponse(response, 'ListDrafts');
};

export const getDownloadUrl = async (draftId) => {
    const token = getToken();
    if (!token) throw new Error('Not authenticated. Please login.');

    console.log(`[DraftingOI] Getting download URL: ${draftId}`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/${draftId}/download`, {
        method: 'GET',
        headers: buildHeaders(false) // ✅ no Content-Type for GET
    });

    return handleResponse(response, 'Download');
};





/**
 * Create a new blank document (Word, Excel, or PowerPoint)
 * POST /drafting/oi/create-blank
 * @param {string} type - 'doc' | 'sheet' | 'show'
 * @param {string} title - Optional custom title
 */
export const createBlankDocument = async (type = 'doc', title = null) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Creating blank ${type} document`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/create-blank`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ type, title }),
    });

    return handleResponse(response, "Create blank document");
};

/**
 * Rename a document
 * POST /drafting/oi/:id/rename
 */
export const renameDocument = async (draftId, title) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Renaming doc ${draftId} to "${title}"`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/${draftId}/rename`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ title }),
    });

    return handleResponse(response, "Rename");
};

/**
 * Delete a document
 * DELETE /drafting/oi/:id/delete
 */
export const deleteDocument = async (draftId) => {
    const token = getToken();
    if (!token) throw new Error("Not authenticated. Please login.");

    console.log(`[DraftingOI] Deleting doc ${draftId}`);

    const response = await fetch(`${DRAFTING_API_BASE}/drafting/oi/${draftId}/delete`, {
        method: "DELETE",
        headers: buildHeaders(true),
    });

    return handleResponse(response, "Delete");
};

export const downloadFile = async (draftId) => {
    const data = await getDownloadUrl(draftId);
    const downloadUrl = data.downloadUrl;
    const filename = data.filename || "document.docx";

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export default {
    uploadFile,
    createSession,
    saveDraft,
    listDrafts,
    getDownloadUrl,
    downloadFile,
    createBlankDocument,
    renameDocument,
    deleteDocument,
};
