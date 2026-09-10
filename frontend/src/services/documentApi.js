// import axios from 'axios';
// import { DOCS_BASE_URL } from '../config/apiConfig';

// const API_BASE_URL = DOCS_BASE_URL;

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   uploadDocuments: async (folderName, files, secret_id = null) => {
//     const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
//     const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
//     const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
//     const uploadedDocuments = [];

//     console.log(`[uploadDocuments] 🚀 Starting upload for ${files.length} file(s) to folder: ${folderName}`);
//     console.log(`[uploadDocuments] 🌍 Environment: ${environment}`);
//     console.log(`[uploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);

//     for (const file of files) {
//       const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
//       const isLarge = file.size > LARGE_FILE_THRESHOLD;
      
//       try {
//         if (isLarge) {
//           console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
//           console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
//           console.log(`[📤 SIGNED URL UPLOAD] Folder: ${folderName}`);
          
//           const generateUrlEndpoint = `${API_BASE_URL}/${folderName}/generate-upload-url`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
          
//           const urlResponse = await axios.post(
//             generateUrlEndpoint,
//             {
//               filename: file.name,
//               mimetype: file.type,
//               size: file.size,
//             },
//             { headers: getAuthHeader() }
//           );

//           const { signedUrl, gcsPath, filename } = urlResponse.data;
//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
//           console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
//           console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);

//           console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
//           const uploadResponse = await fetch(signedUrl, {
//             method: 'PUT',
//             body: file,
//             headers: {
//               'Content-Type': file.type || 'application/octet-stream',
//             },
//           });

//           if (!uploadResponse.ok) {
//             throw new Error(`Failed to upload file to GCS: ${uploadResponse.statusText}`);
//           }

//           console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);

//           const completeEndpoint = `${API_BASE_URL}/${folderName}/complete-upload`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
          
//           const completeResponse = await axios.post(
//             completeEndpoint,
//             {
//               gcsPath,
//               filename,
//               mimetype: file.type,
//               size: file.size,
//               secret_id,
//             },
//             { headers: getAuthHeader() }
//           );

//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully!`);
//           console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);

//           uploadedDocuments.push(completeResponse.data.document || completeResponse.data);
//         } else {
//           console.log(`[📦 REGULAR UPLOAD] Uploading small file: ${file.name} (${fileSizeMB}MB)`);
//           console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
//           console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/${folderName}/upload`);
          
//           const formData = new FormData();
//           formData.append('files', file);
//           if (secret_id) {
//             formData.append('secret_id', secret_id);
//           }

//           const response = await axios.post(
//             `${API_BASE_URL}/${folderName}/upload`,
//             formData,
//             {
//               headers: {
//                 ...getAuthHeader(),
//                 'Content-Type': 'multipart/form-data',
//               },
//             }
//           );

//           console.log(`[📦 REGULAR UPLOAD] ✅ Upload completed successfully!`);

//           const docs = response.data.documents || [];
//           uploadedDocuments.push(...docs);
//         }
//       } catch (error) {
//         const uploadMethod = isLarge ? 'SIGNED URL UPLOAD' : 'REGULAR UPLOAD';
//         console.error(`[${uploadMethod}] ❌ Upload failed for ${file.name}:`, error);
//         console.error(`[${uploadMethod}] Error details:`, error.message);
        
//         if (error.response && error.response.status === 403) {
//           return {
//             success: false,
//             message: error.response.data.message || 'Token exhausted.',
//             documents: uploadedDocuments,
//           };
//         }
//         uploadedDocuments.push({
//           originalname: file.name,
//           error: error.message || 'Upload failed',
//           status: 'failed',
//         });
//       }
//     }

//     console.log(`[uploadDocuments] ✅ Upload process completed. Successfully uploaded: ${uploadedDocuments.filter(d => !d.error).length}/${files.length} files`);
//     return { success: true, documents: uploadedDocuments };
//   },

//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     const payload = {
//       question: question || '',
//       session_id: sessionId,
//       llm_name: options.llm_name || 'gemini',
//       ...options
//     };
//     console.log('[documentApi] Sending request to intelligent-chat:', { folderName, payload });
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/intelligent-chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   queryTestDocuments: async (question, sessionId = null) => {
//     const payload = { question };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }
//     const response = await axios.post(
//       `${API_BASE_URL}/files/test_case/chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     const payload = {
//       question: promptValue,
//       prompt_label: promptLabel,
//       session_id: sessionId,
//       llm_name: 'gemini',
//     };
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/intelligent-chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteSingleFolderChat: async (folderName, chatId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/chat/${chatId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteAllFolderChats: async (folderName) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   deleteFile: async (fileId) => {
//     const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   generateDocumentUploadUrl: async (filename, mimetype, size) => {
//     const baseUrl = API_BASE_URL.replace('/docs', '/files');
//     const response = await axios.post(
//       `${baseUrl}/generate-upload-url`,
//       { filename, mimetype, size },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   completeDocumentUpload: async (gcsPath, filename, mimetype, size, secret_id = null) => {
//     const baseUrl = API_BASE_URL.replace('/docs', '/files');
//     const response = await axios.post(
//       `${baseUrl}/complete-upload`,
//       { gcsPath, filename, mimetype, size, secret_id },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },
// };

// export default documentApi;


import axios from 'axios';
import { DOCS_BASE_URL, getUserIdForDrafting, SECRET_PROMPTS_API_BASE } from '../config/apiConfig';
import { extractUploadPolicyErrorMessage } from '../utils/llmQuotaMessages';

// Docs and cases both go through the docs gateway prefix (`/docs/*` → document-service `/api/files/*`).
const API_BASE_URL = DOCS_BASE_URL;
const CASES_BASE_URL = DOCS_BASE_URL;
const SECRETS_API_BASE = String(SECRET_PROMPTS_API_BASE || '').replace(/\/$/, '');

const normalizeFolderFilesResponse = (data, folderName = '') => {
  const files = Array.isArray(data?.files)
    ? data.files
    : Array.isArray(data?.documents)
      ? data.documents
      : [];
  return {
    ...data,
    folderName: data?.folderName || folderName || '',
    files,
    documents: files,
    totalDocuments: typeof data?.totalDocuments === 'number' ? data.totalDocuments : files.length,
  };
};

/** Encode case/folder name for a single URL path segment (special characters, spaces, unicode). */
function folderPathSegment(folderName) {
  return encodeURIComponent(String(folderName ?? '').trim());
}

/**
 * LLM shape-drift guard for extracted case fields: some prompt/model
 * combinations wrap each field as {value, status, evidence} instead of the
 * plain value. The create-case form renders these values directly, and React
 * throws "Objects are not valid as a React child" on such wrappers — unwrap
 * recursively. Party objects ({fullName, role, …}) have no `value` key and
 * pass through untouched.
 */
const flattenExtractedValues = (v) => {
  if (Array.isArray(v)) return v.map(flattenExtractedValues);
  if (v && typeof v === 'object') {
    if ('value' in v) return flattenExtractedValues(v.value);
    const out = {};
    for (const key of Object.keys(v)) out[key] = flattenExtractedValues(v[key]);
    return out;
  }
  return v;
};

const getAuthHeader = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  const userId = getUserIdForDrafting();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
};

/** POST merged Q&A sections to an export endpoint and trigger a browser download. */
async function exportMergedFile(endpoint, extension, title, sections, includeQuestions = true, filename = null) {
  const response = await axios.post(
    `${API_BASE_URL}/export/${endpoint}`,
    { title, sections, include_questions: includeQuestions },
    { headers: getAuthHeader(), responseType: 'blob' }
  );
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename
    || `${String(title || 'Merged_Legal_Analysis').replace(/[^\w\- ]+/g, '').trim().replace(/ /g, '_') || 'Merged_Legal_Analysis'}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const documentApi = {
  createFolder: async (folderName, parentPath = '') => {
    const response = await axios.post(
      `${API_BASE_URL}/create-folder`,
      { folderName, parentPath },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFoldersAndFiles: async () => {
    const response = await axios.get(`${API_BASE_URL}/folders`, {
      headers: getAuthHeader(),
    });
    return {
      ...response.data,
      folders: Array.isArray(response.data?.folders) ? response.data.folders : [],
    };
  },

  /** Create a document in an external editor (google|zoho) and link it into a storage folder. */
  createStorageDocument: async (folderName, provider, title) => {
    const response = await axios.post(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/create-document`,
      { provider, title },
      { headers: getAuthHeader(), timeout: 90000 }
    );
    return response.data;
  },

  /** Fresh editor session (iframe URL) for an external document. */
  getEditorSession: async (fileId) => {
    const response = await axios.post(
      `${API_BASE_URL}/file/${fileId}/editor-session`,
      {},
      { headers: getAuthHeader(), timeout: 60000 }
    );
    return response.data;
  },

  /** Snapshot an editor-backed doc (Google/Zoho) into a chattable file id. */
  getChatSource: async (fileId) => {
    const response = await axios.post(
      `${API_BASE_URL}/file/${fileId}/chat-source`,
      {},
      { headers: getAuthHeader(), timeout: 90000 }
    );
    return response.data;
  },

  /** Google Drive connection status (proxied through the document service). */
  getGoogleAuthStatus: async () => {
    const response = await axios.get(`${API_BASE_URL}/storage/google-auth-status`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  /** Rename a Case Storage folder; backend re-points the folder's files too. */
  renameStorageFolder: async (folderId, newName) => {
    const response = await axios.post(
      `${API_BASE_URL}/storage/rename-folder`,
      { folderId, newName },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /** Case Storage folders only (parent path 'case-storage') — never returned by the default /folders listing. */
  getStorageFolders: async () => {
    const response = await axios.get(`${API_BASE_URL}/folders`, {
      params: { scope: 'storage' },
      headers: getAuthHeader(),
    });
    return {
      ...response.data,
      folders: Array.isArray(response.data?.folders) ? response.data.folders : [],
    };
  },

  getDocumentsInFolder: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/files`,
      { headers: getAuthHeader(), timeout: 30000 }
    );
    return normalizeFolderFilesResponse(response.data, folderName);
  },

  uploadDocuments: async (folderName, files, secret_id = null, opts = {}) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
    const uploadedDocuments = [];
    // opts.process === false → storage-only upload (no OCR/embedding pipeline), used by Case Storage.
    const skipProcessing = opts.process === false;
    // opts.onProgress(percent 0-100) → aggregate byte progress across all files.
    const totalBytes = Array.from(files).reduce((s, f) => s + (f.size || 0), 0) || 1;
    let completedBytes = 0;
    const reportProgress = (loadedInCurrent) => {
      if (typeof opts.onProgress !== 'function') return;
      const pct = Math.round(((completedBytes + (loadedInCurrent || 0)) / totalBytes) * 100);
      opts.onProgress(Math.min(99, pct)); // 100 only when everything finished
    };

    console.log(`[uploadDocuments] 🚀 Starting upload for ${files.length} file(s) to folder: ${folderName}`);
    console.log(`[uploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[uploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);

    for (const file of files) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      
      try {
        if (isLarge) {
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
          console.log(`[📤 SIGNED URL UPLOAD] Folder: ${folderName}`);
          
          const generateUrlEndpoint = `${API_BASE_URL}/${folderPathSegment(folderName)}/generate-upload-url`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
          
          const urlResponse = await axios.post(
            generateUrlEndpoint,
            {
              filename: file.name,
              mimetype: file.type,
              size: file.size,
            },
            { headers: getAuthHeader() }
          );

          const { signedUrl, gcsPath, filename } = urlResponse.data;
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
          console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
          console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);

          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
          // axios (not fetch) so onUploadProgress can drive the progress bar.
          await axios.put(signedUrl, file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            onUploadProgress: (e) => reportProgress(e.loaded),
          });

          console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);

          const completeEndpoint = `${API_BASE_URL}/${folderPathSegment(folderName)}/complete-upload`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
          
          const completeResponse = await axios.post(
            completeEndpoint,
            {
              gcsPath,
              filename,
              mimetype: file.type,
              size: file.size,
              secret_id,
              ...(skipProcessing ? { process: false } : {}),
            },
            { headers: getAuthHeader() }
          );

          console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully!`);
          console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);

          const batch = completeResponse.data.document || completeResponse.data;
          const batchDocs = batch.uploadedFiles || batch.documents || batch.uploaded_files || [];
          if (batchDocs.length > 0) {
            uploadedDocuments.push(...batchDocs);
          } else {
            uploadedDocuments.push(batch);
          }
        } else {
          console.log(`[📦 REGULAR UPLOAD] Uploading small file: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
          console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/${folderPathSegment(folderName)}/upload`);
          
          const formData = new FormData();
          formData.append('files', file);
          if (secret_id) {
            formData.append('secret_id', secret_id);
          }
          if (skipProcessing) {
            formData.append('process', 'false');
          }

          const response = await axios.post(
            `${API_BASE_URL}/${folderPathSegment(folderName)}/upload`,
            formData,
            {
              headers: {
                ...getAuthHeader(),
                'Content-Type': 'multipart/form-data',
              },
              onUploadProgress: (e) => reportProgress(Math.min(e.loaded, file.size)),
            }
          );

          console.log(`[📦 REGULAR UPLOAD] ✅ Upload completed successfully!`);

          const docs =
            response.data.documents ||
            response.data.uploadedFiles ||
            response.data.uploaded_files ||
            [];
          uploadedDocuments.push(...docs);
        }
        completedBytes += file.size || 0;
        reportProgress(0);
      } catch (error) {
        const uploadMethod = isLarge ? 'SIGNED URL UPLOAD' : 'REGULAR UPLOAD';
        console.error(`[${uploadMethod}] ❌ Upload failed for ${file.name}:`, error);

        // Extract the real server message from the response body — prefer formatted policy message.
        const policyMsg = extractUploadPolicyErrorMessage(error);
        const data = error?.response?.data;
        const serverMessage = policyMsg ||
          (data?.detail && typeof data.detail === 'object' ? data.detail.message : null) ||
          (typeof data?.detail === 'string' ? data.detail : null) ||
          data?.message ||
          data?.error ||
          null;
        const serverCode =
          (data?.detail && typeof data.detail === 'object' ? data.detail.code : null) ||
          data?.code ||
          null;
        const status = error?.response?.status;

        // For rate-limit and file-policy rejections, surface the real reason immediately.
        if (status === 429 || status === 413 || status === 403) {
          return {
            success: false,
            code: serverCode,
            message: serverMessage || (status === 429 ? 'Usage limit reached.' : status === 413 ? 'File too large or too many pages.' : 'Access denied.'),
            documents: uploadedDocuments,
          };
        }

        uploadedDocuments.push({
          originalname: file.name,
          error: serverMessage || error.message || 'Upload failed',
          status: 'failed',
        });
      }
    }

    console.log(`[uploadDocuments] ✅ Upload process completed. Successfully uploaded: ${uploadedDocuments.filter(d => !d.error).length}/${files.length} files`);
    if (typeof opts.onProgress === 'function') opts.onProgress(100);
    return { success: true, documents: uploadedDocuments };
  },

  getFolderSummary: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/summary`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFileProcessingStatus: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getDocumentContent: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  /** Signed URL to the original file in storage (PDF/image/etc.) — prefer this over status `full_text_content` for preview. */
  getDocumentViewInfo: async (fileId, page = 1) => {
    const response = await axios.get(`${API_BASE_URL}/file/${fileId}/view`, {
      params: page != null ? { page } : {},
      headers: getAuthHeader(),
    });
    return response.data;
  },

  /** Virtualized OCR text for a page window. Does not download the original PDF. */
  getOcrPages: async (fileId, fromPage = 1, toPage = 1) => {
    const response = await axios.get(`${API_BASE_URL}/file/${fileId}/ocr-pages`, {
      params: { from_page: fromPage, to_page: toPage },
      headers: getAuthHeader(),
    });
    return response.data;
  },

  queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    const payload = {
      question: question || '',
      session_id: sessionId,
      llm_name: options.llm_name || 'gemini',
      ...options
    };
    console.log('[documentApi] Sending request to intelligent-chat:', { folderName, payload });
    const response = await axios.post(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Upload files for processing (separate from extraction)
  uploadDocumentsForProcessing: async (files) => {
    const fallbackToDirectUpload = async () => {
      console.warn('[uploadDocumentsForProcessing] Falling back to direct multipart upload');
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      const response = await axios.post(
        `${API_BASE_URL}/upload-for-processing`,
        formData,
        {
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'multipart/form-data',
          },
          timeout: 120000,
        }
      );
      return {
        success: true,
        folderName: response.data.folderName,
        uploadedFiles: response.data.uploadedFiles || response.data.documents || response.data.files || [],
      };
    };

    try {
      console.log(`[uploadDocumentsForProcessing] 🚀 Signed upload for ${files.length} file(s)...`);
      // Keep one temporary folder for the whole upload batch, just like document-service.
      const tempFolderName = `temp-${Math.random().toString(16).slice(2, 14)}`;
      let folderName = tempFolderName;

      // All files upload in PARALLEL (generate-url → PUT → complete each) —
      // the serial for-of loop made an 8-file upload take 8× a single file.
      const uploadOne = async (file) => {
        const urlResponse = await axios.post(
          `${API_BASE_URL}/${encodeURIComponent(tempFolderName)}/generate-upload-url`,
          {
            filename: file.name,
            mimetype: file.type || 'application/octet-stream',
            size: file.size || 0,
          },
          { headers: getAuthHeader() }
        );

        const { signedUrl, gcsPath, filename: safeFilename } = urlResponse.data || {};
        if (!signedUrl || !gcsPath) {
          throw new Error('Failed to get signed upload URL.');
        }

        const putResponse = await fetch(signedUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
        if (!putResponse.ok) {
          throw new Error(`Failed to upload to signed URL: ${putResponse.statusText}`);
        }

        const completeResponse = await axios.post(
          `${API_BASE_URL}/${encodeURIComponent(tempFolderName)}/complete-upload`,
          {
            gcsPath,
            filename: safeFilename || file.name,
            mimetype: file.type || 'application/octet-stream',
            size: file.size || 0,
          },
          { headers: getAuthHeader() }
        );

        const completeData = completeResponse.data || {};
        if (completeData.folderName) folderName = completeData.folderName;
        return completeData.document || completeData;
      };

      const uploadedFiles = await Promise.all(files.map((file) => uploadOne(file)));

      if (!folderName) {
        throw new Error('Folder name missing after signed uploads.');
      }

      return {
        success: true,
        folderName,
        uploadedFiles,
      };
    } catch (error) {
      console.error('[uploadDocumentsForProcessing] ❌ Error:', error);

      // Extract the real server message: prefer formatted upload-policy messages, then raw server text.
      const extractMsg = (err) => {
        const policyMsg = extractUploadPolicyErrorMessage(err);
        if (policyMsg) return policyMsg;
        const d = err?.response?.data;
        return (d?.detail && typeof d.detail === 'object' ? d.detail.message : null) ||
          (typeof d?.detail === 'string' ? d.detail : null) ||
          d?.message || d?.error || null;
      };

      const isNetworkSignedUrlError =
        String(error?.message || '').toLowerCase().includes('failed to fetch') ||
        String(error?.message || '').toLowerCase().includes('signed url');
      if (isNetworkSignedUrlError) {
        try {
          return await fallbackToDirectUpload();
        } catch (fallbackError) {
          console.error('[uploadDocumentsForProcessing] ❌ Fallback upload failed:', fallbackError);
          throw new Error(extractMsg(fallbackError) || fallbackError.message || 'Failed to upload documents');
        }
      }
      throw new Error(extractMsg(error) || error.message || 'Failed to upload documents');
    }
  },

  // Get processing status of folder
  getFolderProcessingStatus: async (folderName) => {
    try {
      // URL encode the folderName to handle paths with slashes
      const encodedFolderName = encodeURIComponent(folderName);
      const response = await axios.get(
        `${API_BASE_URL}/${encodedFolderName}/status`,
        { 
          headers: getAuthHeader(),
          timeout: 30000, // 30 second timeout for status check
        }
      );
      return response.data;
    } catch (error) {
      console.error('[getFolderProcessingStatus] ❌ Error:', error);
      console.error('[getFolderProcessingStatus] Error details:', error.response?.data);
      console.error('[getFolderProcessingStatus] Folder name:', folderName);
      const detail = String(error.response?.data?.detail || '');
      if (detail.includes('No processing job found for folder')) {
        return {
          folderName,
          case_id: folderName,
          job_id: null,
          status: 'queued',
          progress: 0,
          total_documents: 0,
          processed_documents: 0,
          failed_documents: 0,
          documents: [],
        };
      }
      
      // Don't throw for timeout errors - let the caller handle retries
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        throw new Error('Request timeout - will retry');
      }
      
      throw new Error(error.response?.data?.message || error.response?.data?.error || 'Failed to get processing status');
    }
  },

  // Extract case fields from processed folder
  extractCaseFieldsFromFolder: async (folderName) => {
    try {
      console.log(`[extractCaseFieldsFromFolder] 🔍 Extracting fields from folder: ${folderName}`);

      // URL encode the folderName to handle paths with slashes
      const encodedFolderName = encodeURIComponent(folderName);
      const response = await axios.post(
        `${API_BASE_URL}/${encodedFolderName}/extract-case-fields`,
        {},
        {
          headers: getAuthHeader(),
          timeout: 120000, // 2 minutes for extraction
        }
      );

      console.log(`[extractCaseFieldsFromFolder] ✅ Extraction completed`);

      return {
        success: true,
        extractedData: flattenExtractedValues(response.data.extractedData || {}),
      };
    } catch (error) {
      console.error('[extractCaseFieldsFromFolder] ❌ Error:', error);
      const msg = extractUploadPolicyErrorMessage(error) ||
        (() => { const d = error?.response?.data; return (d?.detail && typeof d.detail === 'object' ? d.detail.message : null) || (typeof d?.detail === 'string' ? d.detail : null) || d?.message || d?.error || null; })() ||
        error.message || 'Failed to extract case fields';
      throw new Error(msg);
    }
  },

  // Legacy combined function (kept for backward compatibility)
  uploadAndExtractCaseFields: async (files) => {
    try {
      console.log(`[uploadAndExtractCaseFields] 🚀 Starting upload and extraction for ${files.length} file(s)...`);

      const uploadResult = await documentApi.uploadDocumentsForProcessing(files);
      const folderName = uploadResult.folderName;
      if (!folderName) {
        throw new Error('Folder name missing after upload-for-processing');
      }

      // Poll processing status before extraction
      let attempts = 0;
      const maxAttempts = 60; // ~5 minutes at 5s interval
      while (attempts < maxAttempts) {
        attempts += 1;
        const statusResult = await documentApi.getFolderProcessingStatus(folderName);
        const status = String(statusResult?.status || '').toLowerCase();
        if (status === 'processed') break;
        if (status === 'error') {
          throw new Error(statusResult?.message || 'Document processing failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const extracted = await documentApi.extractCaseFieldsFromFolder(folderName);
      return {
        success: true,
        folderName,
        extractedData: flattenExtractedValues(extracted?.extractedData || {}),
        uploadedFiles: uploadResult.uploadedFiles || [],
      };
    } catch (error) {
      console.error('[uploadAndExtractCaseFields] ❌ Error:', error);
      console.error('[uploadAndExtractCaseFields] Error response:', error.response?.data);
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timed out. Processing may still be in progress.');
      }
      
      const msg = extractUploadPolicyErrorMessage(error) ||
        (() => { const d = error?.response?.data; return (d?.detail && typeof d.detail === 'object' ? d.detail.message : null) || (typeof d?.detail === 'string' ? d.detail : null) || d?.message || d?.error || null; })() ||
        error.message || 'Failed to upload and extract case fields. Please try again.';
      throw new Error(msg);
    }
  },

  queryTestDocuments: async (question, sessionId = null) => {
    const payload = { question };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    const response = await axios.post(
      `${API_BASE_URL}/files/test_case/chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
    console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    const payload = {
      question: promptValue,
      prompt_label: promptLabel,
      session_id: sessionId,
      llm_name: 'gemini',
    };
    const response = await axios.post(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFolderChatSessions: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/sessions`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFolderChatSessionById: async (folderName, sessionId) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  continueFolderChat: async (folderName, sessionId, question) => {
    const response = await axios.post(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/sessions/${sessionId}/continue`,
      { question },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteFolderChatSession: async (folderName, sessionId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /** Merge selected Q&A sections into a .docx and trigger a browser download. */
  exportMergedDocx: async (title, sections, includeQuestions = true) => {
    await exportMergedFile('merged-docx', 'docx', title, sections, includeQuestions);
  },

  /** Merge selected Q&A sections into a .pdf and trigger a browser download. */
  exportMergedPdf: async (title, sections, includeQuestions = true, filename = null) => {
    await exportMergedFile('merged-pdf', 'pdf', title, sections, includeQuestions, filename);
  },

  getSecrets: async () => {
    const { fetchSecretsList } = await import('./secretsService');
    return fetchSecretsList();
  },

  getSecretById: async (secretId) => {
    const response = await axios.get(`${SECRETS_API_BASE}/secrets/${secretId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getFolderChats: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteSingleFolderChat: async (folderName, chatId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/chat/${chatId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteAllFolderChats: async (folderName) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderPathSegment(folderName)}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getCases: async () => {
    const response = await axios.get(`${CASES_BASE_URL}/cases`, {
      headers: getAuthHeader(),
      timeout: 8000,
    });
    return response.data;
  },

  getCaseById: async (caseId) => {
    const response = await axios.get(`${CASES_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
      timeout: 8000,
    });
    return response.data;
  },

  updateCase: async (caseId, caseData) => {
    const response = await axios.put(
      `${CASES_BASE_URL}/cases/${caseId}`,
      caseData,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteCase: async (caseId) => {
    const response = await axios.delete(`${CASES_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  deleteFolderWithContents: async (folderName) => {
    const response = await axios.delete(`${API_BASE_URL}/cases/${encodeURIComponent(folderName)}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  deleteFile: async (fileId) => {
    const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  generateDocumentUploadUrl: async (filename, mimetype, size) => {
    const response = await axios.post(
      `${API_BASE_URL}/generate-upload-url`,
      { filename, mimetype, size },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  completeDocumentUpload: async (gcsPath, filename, mimetype, size, secret_id = null) => {
    const response = await axios.post(
      `${API_BASE_URL}/complete-upload`,
      { gcsPath, filename, mimetype, size, secret_id },
      { headers: getAuthHeader() }
    );
    return response.data;
  },
};

export default documentApi;

