import {
  API_BASE_URL,
  CHAT_MODEL_BASE_URL,
  AUTH_SERVICE_URL,
  SECRET_PROMPTS_API_BASE,
  DOCS_BASE_URL,
  getUserIdForDrafting,
} from '@/config/apiConfig';
import { createQuotaError, parseQuotaHttpError } from '../utils/quotaError';
import { emitStorageFull, isStorageFullError } from '../utils/storageGuard';

class ApiService {
 constructor() {
 this.baseURL = API_BASE_URL;
 }

 getAuthToken() {
 const token = localStorage.getItem("token");
 console.log(
 `[ApiService] getAuthToken: Token ${token ? 'Present' : 'Not Present'}`
 );
 return token;
 }

 async request(endpoint, options = {}) {
 const url =
 endpoint.startsWith("http://") || endpoint.startsWith("https://")
 ? endpoint
 : `${this.baseURL}${endpoint}`;
 const token = this.getAuthToken();
 const { responseType, ...fetchOptions } = options;

 console.log(`[ApiService] Requesting URL: ${url}`);
 console.log(`[ApiService] Request method: ${options.method || 'GET'}`);
 console.log(`[ApiService] Full URL being sent: ${url}`);

 const headers = {
 ...(fetchOptions.body instanceof FormData
 ? {}
 : { "Content-Type": "application/json" }),
 ...fetchOptions.headers,
 };

 if (token) {
 headers["Authorization"] = `Bearer ${token}`;
 console.log('[ApiService] Authorization header added.');
 } else {
 console.log('[ApiService] No token found, Authorization header NOT added.');
 }

 const config = {
 headers,
 credentials: "include",
 ...fetchOptions,
 };

 try {
 const response = await fetch(url, config);
 console.log("[ApiService] Response received:", {
   url,
   status: response.status,
   ok: response.ok,
   contentType: response.headers.get("content-type"),
 });

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({}));
 const normalizedErrorData =
 errorData && typeof errorData === "object" && errorData.detail && typeof errorData.detail === "object"
 ? errorData.detail
 : errorData;
 console.error("[ApiService] Response error payload:", {
   url,
   status: response.status,
   errorData,
   normalizedErrorData,
 });
 const error = new Error(
 normalizedErrorData.message || normalizedErrorData.error || `HTTP error! status: ${response.status}`
 );
 error.code = normalizedErrorData.code;
 error.details = normalizedErrorData.details;
 error.response = {
 status: response.status,
 data: normalizedErrorData,
 rawData: errorData,
 };
 // Auto-emit global storage-full modal for HTTP 507 from any service
 if (response.status === 507 || isStorageFullError(error)) {
   emitStorageFull(error);
 }
 throw error;
 }

 if (responseType === "arrayBuffer") {
 return await response.arrayBuffer();
 }
 const json = await response.json();
 console.log("[ApiService] Response JSON payload:", {
   url,
   status: response.status,
   dataPreview: json,
 });
 return json;
 } catch (error) {
 console.error("API request failed:", error);
 throw error;
 }
 }

 async login(credentials) {
 const response = await this.request("/api/auth/login", {
 method: "POST",
 body: JSON.stringify(credentials),
 });
 if (response.token) {
 localStorage.setItem("token", response.token);
 }
 return response;
 }

  async register(userData) {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  async registerSoloLawyer(userData) {
    return this.request(`${AUTH_SERVICE_URL}/api/auth/register/solo`, {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  async registerFirm(firmData) {
    return this.request(`${AUTH_SERVICE_URL}/api/auth/register/firm`, {
      method: "POST",
      body: JSON.stringify(firmData),
    });
  }

 async logout() {
 localStorage.removeItem("token");
 localStorage.removeItem("user");
 localStorage.removeItem("userInfo");
 window.dispatchEvent(new Event("userUpdated"));
 return { message: "Logged out successfully locally" };
 }

 async updateProfile(userData) {
 return this.request("/api/auth/update", {
 method: "PUT",
 body: JSON.stringify(userData),
 });
 }

  async updatePassword(passwordData) {
    return this.request("/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify(passwordData),
    });
  }

  async setPassword(passwordData) {
    return this.request("/api/auth/set-password", {
      method: "POST",
      body: JSON.stringify(passwordData),
    });
  }

 async getProfessionalProfile() {
return this.request(`${AUTH_SERVICE_URL}/api/auth/professional-profile`, {
 method: "GET",
 });
 }

 async updateProfessionalProfile(profileData) {
return this.request(`${AUTH_SERVICE_URL}/api/auth/professional-profile`, {
 method: "PUT",
 body: JSON.stringify(profileData),
 });
 }

 async deleteAccount() {
 return this.request("/api/auth/delete", {
 method: "DELETE",
 });
 }

 async logoutUser() {
 return this.request("/api/auth/logout", {
 method: "POST",
 });
 }

 async fetchProfile() {
 return this.request("/api/auth/profile");
 }

  // Device sessions — Settings → "Where you're logged in"
  async getSessions() {
    return this.request("/api/auth/sessions");
  }

  async revokeSession(sessionId) {
    return this.request(`/api/auth/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }

  async revokeSessions(sessionIds) {
    return this.request("/api/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ session_ids: sessionIds }),
    });
  }

  async revokeAllOtherSessions() {
    return this.request("/api/auth/sessions/revoke-all", {
      method: "POST",
    });
  }

  async verifyOtp(email, otp, newPassword = null) {
    const body = { email, otp };
    if (newPassword) {
      body.newPassword = newPassword;
    }
    const response = await this.request(`${AUTH_SERVICE_URL}/api/auth/verify-otp`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (response.token) {
      localStorage.setItem("token", response.token);
    }
    return response;
  }

 async getTemplates() {
 return this.request("/drafting");
 }

 async getUserTemplates() {
 return this.request("/drafting/user");
 }

 async getTemplateById(id) {
 return this.request(`/drafting/${id}`);
 }

 async openTemplateForEditing(templateId) {
 return this.request(`/drafting/${templateId}/open`);
 }

 async saveUserDraft(templateId, name, file) {
 const formData = new FormData();
 formData.append("templateId", templateId);
 formData.append("name", name);
 formData.append("file", file);

 return this.request("/templates/draft", {
 method: "POST",
 body: formData,
 });
 }

 async getTemplateDocxArrayBuffer(templateId) {
 return this.request(`/templates/${templateId}/docx`, {
 responseType: "arrayBuffer",
 });
 }

 async exportUserDraft(draftId) {
 return this.request(`/templates/${draftId}/export`);
 }

 async addHtmlTemplate(templateData) {
 return this.request("/templates/admin/html", {
 method: "POST",
 body: JSON.stringify(templateData),
 });
 }

 async getDraftingTemplates() {
 return this.request("/drafting");
 }

 async saveDocument(documentData) {
 return this.request("/doc/save", {
 method: "POST",
 body: JSON.stringify(documentData),
 });
 }

 async getDocuments() {
 return this.request("/doc");
 }

 async getDocument(documentId) {
 return this.request(`/doc/${documentId}`);
 }

 async getPublicPlans() {
 return this.request(`/payments/plans`);
 }

 async startSubscription(plan_id) {
 return this.request("/payments/subscription/start", {
 method: "POST",
 body: JSON.stringify({ plan_id }),
 });
 }

 async verifySubscription(paymentData) {
 return this.request("/payments/subscription/verify", {
 method: "POST",
 body: JSON.stringify(paymentData),
 });
 }

 async getPaymentPlans() {
 return this.request(`/payments/plans`);
 }

 async getUserPlanDetails(service = "") {
 const endpoint = service
 ? `/user-resources/plan-details?service=${service}`
 : `/user-resources/plan-details`;
 return this.request(endpoint);
 }

 async getUserTransactions() {
 return this.request(`/user-resources/transactions`);
 }

 async fetchPaymentHistory() {
 return this.request("/payments/history");
 }

 async getUserTokenUsage(userId) {
 return this.request(`/files/user-usage-and-plan/${userId}`);
 }

 async uploadSingleFile(file, folderPath = "") {
 const formData = new FormData();
 formData.append("files", file);
 if (folderPath) {
 formData.append("folderPath", folderPath);
 }
 return this.request("/files/upload", {
 method: "POST",
 body: formData,
 });
 }

 async uploadMultipleFiles(files, folderPath = "") {
 const formData = new FormData();
 Array.from(files).forEach((file) => {
 formData.append("files", file);
 });
 if (folderPath) {
 formData.append("folderPath", folderPath);
 }
 return this.request("/files/upload-folder", {
 method: "POST",
 body: formData,
 });
 }

 async getFileStatus(fileId) {
 return this.request(`/files/status/${fileId}`);
 }

 async uploadDocumentForProcessing(file) {
 const formData = new FormData();
 formData.append("file", file);
 return this.request("/documents/upload", {
 method: "POST",
 body: formData,
 });
 }

 async batchUploadDocument(file) {
 const formData = new FormData();
 formData.append("document", file);
 return this.request("/documents/batch-upload", {
 method: "POST",
 body: formData,
 });
 }

 async saveUserDraftFromTemplate(file, templateId, name) {
 const formData = new FormData();
 formData.append("file", file);
 formData.append("templateId", templateId);
 formData.append("name", name);
 return this.request("/templates/draft", {
 method: "POST",
 body: formData,
 });
 }

 async fetchChatsBySessionId(sessionId) {
 if (!sessionId) {
 console.warn("[ApiService] fetchChatsBySessionId called without sessionId.");
 return;
 }
 return this.request(`/files/session/${sessionId}`);
 }

 async fetchChatSessions(page = 1, limit = 20) {
 // Analysis chat sessions routed via backend gateway (/docs -> /api/files).
 return this.request(`/docs/chat-sessions?page=${page}&limit=${limit}`);
 }

 async getFolderChatSessions(folderName) {
 return this.request(`/files/${folderName}/chat/sessions`);
 }

 async getFolderChatSessionById(folderName, sessionId) {
 return this.request(`/files/${folderName}/chat/sessions/${sessionId}`);
 }

 async queryFolderDocuments(folderName, question, options = {}) {
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question, ...options }),
 headers: uid ? { "X-User-Id": uid } : {},
 });
 }

 async continueFolderChat(folderName, sessionId, question, options = {}) {
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question, session_id: sessionId, ...options }),
 headers: uid ? { "X-User-Id": uid } : {},
 });
 }

 async deleteFolderChatSession(folderName, sessionId) {
 return this.request(`/files/${folderName}/chat/sessions/${sessionId}`, {
 method: "DELETE",
 });
 }

 async queryTestDocuments(question, sessionId) {
 return this.request(`/files/test/chat`, {
 method: "POST",
 body: JSON.stringify({ question, session_id: sessionId }),
 });
 }

 async queryFolderDocumentsWithSecret(folderName, question, promptLabel, sessionId, options = {}) {
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question, prompt_label: promptLabel, session_id: sessionId, llm_name: 'gemini', ...options }),
 headers: uid ? { "X-User-Id": uid } : {},
 });
 }

 async getChatStatistics() {
 return this.request(`/files/chats/statistics`);
 }

 async getDeletePreview(filters) {
 return this.request(`/files/chats/delete-preview`, {
 method: "POST",
 body: JSON.stringify(filters),
 });
 }

 async deleteChat(chatId) {
 return this.request(`/files/chat/${chatId}`, {
 method: "DELETE",
 });
 }

 async deleteSelectedChats(chatIds) {
 return this.request(`/files/chats/selected`, {
 method: "DELETE",
 body: JSON.stringify({ chat_ids: chatIds }),
 });
 }

 async deleteAllChats() {
 return this.request(`/files/chats/all`, {
 method: "DELETE",
 });
 }

 async deleteChatsBySession(sessionId) {
 return this.request(`/files/chats/session/${sessionId}`, {
 method: "DELETE",
 });
 }

 async deleteChatsByFile(fileId) {
 return this.request(`/files/chats/file/${fileId}`, {
 method: "DELETE",
 });
 }

 async getSecrets() {
 const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL || '').replace(/\/$/, '');
 return this.request(`${base}/secrets?fetch=false`);
 }

 async getSecretById(secretId) {
 const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL || '').replace(/\/$/, '');
 return this.request(`${base}/secrets/${secretId}`);
 }

 async triggerLLMWithSecret(secretId, fileId, additionalInput = "") {
 return this.request("/files/trigger-llm", {
 method: "POST",
 body: JSON.stringify({ 
 secretId, 
 fileId,
 additionalInput 
 }),
 });
 }

 async submitSupportQuery(queryData) {
 return this.request("/support/tickets", {
 method: "POST",
 body: queryData instanceof FormData ? queryData : JSON.stringify(queryData),
 });
 }

 async getMySupportTickets() {
 return this.request("/support/tickets/my");
 }

 async getSupportTicket(ticketId) {
 return this.request(`/support/tickets/${ticketId}`);
 }

 async getAdminSupportTickets(params = {}) {
 const searchParams = new URLSearchParams();
 if (params.status) {
   searchParams.set("status", params.status);
 }
 if (params.search) {
   searchParams.set("search", params.search);
 }
 const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
 return this.request(`/support/tickets/admin/all${suffix}`);
 }

 async markSupportTicketSeen(ticketId) {
 return this.request(`/support/tickets/${ticketId}/seen`, {
 method: "POST",
 });
 }

 async updateSupportTicketStatus(ticketId, payload) {
 return this.request(`/support/tickets/${ticketId}/status`, {
 method: "PATCH",
 body: JSON.stringify(payload),
 });
 }

 async chatModelRequest(endpoint, options = {}) {
 const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
   ? endpoint
   : `${CHAT_MODEL_BASE_URL}${endpoint}`;
 const token = this.getAuthToken();
 const { responseType, ...fetchOptions } = options;

 const headers = {
   ...(fetchOptions.body instanceof FormData
     ? {}
     : { "Content-Type": "application/json" }),
   ...fetchOptions.headers,
 };

 if (token) {
   headers["Authorization"] = `Bearer ${token}`;
 }

 // ChatModel uses Bearer token only; omit cookies so CORS can use reflected Origin (not wildcard + credentials).
 const config = {
   headers,
   credentials: "omit",
   ...fetchOptions,
 };

 try {
   const response = await fetch(url, config);

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     const quota = parseQuotaHttpError(response.status, errorData);
     if (quota) {
       throw createQuotaError(quota, response.status);
     }
     const normalized =
       errorData && typeof errorData === 'object' && errorData.detail && typeof errorData.detail === 'object'
         ? errorData.detail
         : errorData;
     const error = new Error(
       normalized.message || normalized.error || `HTTP error! status: ${response.status}`
     );
     error.code = normalized.code;
     error.details = normalized.details;
     error.response = { status: response.status, data: normalized, rawData: errorData };
     throw error;
   }

   if (responseType === "arrayBuffer") {
     return await response.arrayBuffer();
   }
   return await response.json();
 } catch (error) {
   console.error("ChatModel API request failed:", error);
   throw error;
 }
 }

 async uploadChatModelDocument(file, options = {}) {
  const { onProgress } = options;
  const mimeType = file?.type || "application/octet-stream";
  const initiate = await this.chatModelRequest("/api/chat/upload-document/initiate", {
    method: "POST",
    body: JSON.stringify({
      filename: file?.name || "document",
      mimetype: mimeType,
      size: Number(file?.size || 0),
    }),
  });

  const uploadData = initiate?.data || {};
  if (!uploadData.upload_url || !uploadData.upload_token) {
    throw new Error("Signed upload response missing upload_url or upload_token");
  }

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") {
        return;
      }
      const percentComplete = Math.min(95, Math.round((event.loaded / event.total) * 95));
      onProgress(percentComplete);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Signed upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during signed upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Signed upload cancelled"));
    });

    xhr.open(uploadData.method || "PUT", uploadData.upload_url);
    const uploadHeaders = uploadData.headers || { "Content-Type": mimeType };
    Object.keys(uploadHeaders).forEach((key) => {
      xhr.setRequestHeader(key, uploadHeaders[key]);
    });
    xhr.send(file);
  });

  if (typeof onProgress === "function") {
    onProgress(97);
  }

  const response = await this.chatModelRequest("/api/chat/upload-document/complete", {
    method: "POST",
    body: JSON.stringify({
      upload_token: uploadData.upload_token,
      filename: file?.name || "document",
      mimetype: mimeType,
      size: Number(file?.size || 0),
    }),
  });

  if (typeof onProgress === "function") {
    onProgress(100);
  }

  return response;
 }

 async askChatModelQuestion(question, fileId, sessionId = null) {
 const body = { question, file_id: fileId };
 if (sessionId) {
   body.session_id = sessionId;
 }
 return this.chatModelRequest("/api/chat/ask", {
   method: "POST",
   body: JSON.stringify(body),
 });
 }

 async askChatModelQuestionStream(question, fileId, sessionId = null, onChunk, onStatus, onMetadata, onDone, onError, secretId = null, usedSecretPrompt = false, promptLabel = null, additionalInput = null, llmName = null, extraFetchParams = null, fileIds = null, onThought = null, onUsage = null, abortSignal = null) {
 const token = this.getAuthToken();
 
 const body = { question, file_id: fileId };
 if (Array.isArray(fileIds) && fileIds.length > 1) {
   body.file_ids = fileIds;
 }
 if (sessionId) {
   body.session_id = sessionId;
 }
 if (usedSecretPrompt && secretId) {
   body.secret_id = secretId;
   body.used_secret_prompt = true;
   body.prompt_label = promptLabel;
   if (additionalInput) {
     body.additional_input = additionalInput;
   }
 } else if (promptLabel) {
   // Custom prompts have no secret_id, but still need a stored label so the
   // thread and history show the prompt's name instead of its full body.
   body.prompt_label = promptLabel;
 }
 if (llmName) {
   body.llm_name = llmName;
 }
 if (extraFetchParams && typeof extraFetchParams === 'object') {
   const rawMot =
     extraFetchParams.max_output_tokens != null && extraFetchParams.max_output_tokens !== ''
       ? extraFetchParams.max_output_tokens
       : extraFetchParams.maxOutputTokens;
   if (rawMot != null && rawMot !== '') {
     const n = Number(rawMot);
     if (Number.isFinite(n)) body.max_output_tokens = n;
   }
   const rawTemp =
     extraFetchParams.model_temperature != null && extraFetchParams.model_temperature !== ''
       ? extraFetchParams.model_temperature
       : extraFetchParams.temperature;
   if (rawTemp != null && rawTemp !== '') {
     const t = Number(rawTemp);
     if (Number.isFinite(t)) body.model_temperature = t;
   }
    if (typeof extraFetchParams.learning_mode === 'boolean') {
      body.learning_mode = extraFetchParams.learning_mode;
    }
    if (typeof extraFetchParams.incognito === 'boolean') {
      body.incognito = extraFetchParams.incognito;
    }
    if (typeof extraFetchParams.document_context === 'string') {
      body.document_context = extraFetchParams.document_context;
    }
    if (extraFetchParams.context_page != null && extraFetchParams.context_page !== '') {
      const p = Number(extraFetchParams.context_page);
      if (Number.isFinite(p)) body.context_page = p;
    }
    if (typeof extraFetchParams.context_selection === 'string') {
      body.context_selection = extraFetchParams.context_selection;
    }
    if (extraFetchParams.web_search === true || extraFetchParams.web_search === 'true') {
      body.web_search = true;
    }
    if (extraFetchParams.disable_cache === true) {
      // Skip the Gemini explicit-cache path entirely (used by Case Storage chat).
      body.disable_cache = true;
    }
    if (typeof extraFetchParams.chat_source === 'string' && extraFetchParams.chat_source) {
      // Tags the saved chat (e.g. 'case_storage') so it stays out of ChatModel's history.
      body.chat_source = extraFetchParams.chat_source;
    }
 }

 const headers = {
   "Content-Type": "application/json",
   "Accept": "text/event-stream",
 };
 if (token) {
   headers["Authorization"] = `Bearer ${token}`;
 }

 try {
   const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`, {
     method: "POST",
     headers,
     body: JSON.stringify(body),
     ...(abortSignal ? { signal: abortSignal } : {}),
   });

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     const quota = parseQuotaHttpError(response.status, errorData);
     if (quota) {
       throw createQuotaError(quota, response.status);
     }
     const normalized =
       errorData && typeof errorData === 'object' && errorData.detail && typeof errorData.detail === 'object'
         ? errorData.detail
         : errorData;
     const err = new Error(normalized.message || normalized.error || `HTTP error! status: ${response.status}`);
     err.code = normalized.code;
     err.details = normalized.details;
     err.status = response.status;
     err.response = { status: response.status, data: normalized, rawData: errorData };
     throw err;
   }

   const reader = response.body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';
   let streamDone = false;
   let doneDispatched = false;
   let accumulatedAnswer = '';
   // Yield to the browser if we've blocked the main thread for >16ms (one frame).
   const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));
   let lastYieldTime = performance.now();

   while (true) {
     const { done, value } = await reader.read();
     
     if (done) {
       break;
     }

     buffer += decoder.decode(value, { stream: true });
     const lines = buffer.split(/\r\n|\n|\r/);
     buffer = lines.pop() || '';

     for (const line of lines) {
       if (!line.trim()) continue;
       
       let data = line.trim();
       if (data.startsWith('data: ')) {
         data = data.substring(6).trim();
       }
       
       if (data === '[PING]') {
         continue;
       }
       
       if (data === '[DONE]') {
         streamDone = true;
         break;
       }

       if (!data) continue;

       try {
         const parsed = JSON.parse(data);
         
         if (parsed.type === 'status' && onStatus) {
           onStatus(parsed.status, parsed.message);
         } else if (parsed.type === 'metadata' && onMetadata) {
           onMetadata(parsed);
         } else if (parsed.type === 'cache_session' && onMetadata) {
           onMetadata(parsed);
         } else if (parsed.type === 'usage') {
           if (onUsage) onUsage(parsed);
           if (onMetadata && parsed.sessionMetrics) {
             onMetadata({ cache_session_metrics: parsed.sessionMetrics });
           }
         } else if (parsed.type === 'sources' && onMetadata) {
           onMetadata({ sources: parsed.sources || [], web_search_queries: parsed.queries || [] });
         } else if (parsed.type === 'thought' && onThought) {
           const thoughtPiece = typeof parsed.text === 'string' ? parsed.text : '';
           if (thoughtPiece) onThought(thoughtPiece);
         } else if (parsed.type === 'chunk' && onChunk) {
           const piece = typeof parsed.text === 'string' ? parsed.text : '';
           accumulatedAnswer += piece;
           onChunk(piece);
         } else if (parsed.type === 'done' && onDone) {
           const fromServer = typeof parsed.answer === 'string' ? parsed.answer : '';
           // Server answer is authoritative: the backend streams degenerate/restarted
           // generation rounds live but EXCLUDES them from its stitched final answer
           // (and from saved history). The accumulated stream can therefore be longer
           // but dirtier — only fall back to it when the server sent nothing.
           const merged = fromServer.trim() ? fromServer : (accumulatedAnswer || fromServer);
           doneDispatched = true;
           onDone({ ...parsed, answer: merged });
           streamDone = true;
          } else if (parsed.type === 'error' && onError) {
            onError(parsed.message, parsed.details, parsed.code);
            streamDone = true;
          }
       } catch (e) {
         console.warn('Failed to parse SSE data:', data, e);
       }
        
        // Only yield if the thread has been busy for >16ms. This prevents
        // artificial delays on fast streams while still preventing UI lockups.
        if (performance.now() - lastYieldTime > 16) {
          await yieldToMain();
          lastYieldTime = performance.now();
        }
      }
     
     if (streamDone) break;
   }

   if (onDone && !doneDispatched) {
     doneDispatched = true;
     onDone({ answer: accumulatedAnswer });
   }
  } catch (error) {
    console.error("ChatModel streaming error:", error);
    if (onError) {
      onError(error.message, error.details, error.code);
    }
    throw error;
  }
 }

 async getChatModelFiles() {
 return this.chatModelRequest("/api/chat/files");
 }

 async getChatModelHistory(fileId, sessionId = null) {
 let endpoint = `/api/chat/history/${fileId}`;
 if (sessionId) {
   endpoint += `?session_id=${sessionId}`;
 }
 return this.chatModelRequest(endpoint);
 }

 async getChatModelSessions(fileId) {
 return this.chatModelRequest(`/api/chat/sessions/${fileId}`);
 }

 async getGeneralChatHistory(sessionId) {
   return this.chatModelRequest(`/api/chat/general/history/${sessionId}`);
 }

 async getGeneralChatSessions() {
   return this.chatModelRequest('/api/chat/general/sessions');
 }

 async getAllDocumentSessions() {
   return this.chatModelRequest('/api/chat/document-sessions');
 }

 async askGeneralChatStream(question, sessionId = null, onChunk, onStatus, onMetadata, onDone, onError, extraFetchParams = null, onThought = null, abortSignal = null) {
   const token = this.getAuthToken();

   const body = { question };
   if (sessionId) body.session_id = sessionId;
   if (extraFetchParams && typeof extraFetchParams === 'object') {
     if (extraFetchParams.llm_name) body.llm_name = String(extraFetchParams.llm_name);
     const rawMot =
       extraFetchParams.max_output_tokens != null && extraFetchParams.max_output_tokens !== ''
         ? extraFetchParams.max_output_tokens
         : extraFetchParams.maxOutputTokens;
     if (rawMot != null && rawMot !== '') {
       const n = Number(rawMot);
       if (Number.isFinite(n)) body.max_output_tokens = n;
     }
     const rawTemp =
       extraFetchParams.model_temperature != null && extraFetchParams.model_temperature !== ''
         ? extraFetchParams.model_temperature
         : extraFetchParams.temperature;
     if (rawTemp != null && rawTemp !== '') {
       const t = Number(rawTemp);
       if (Number.isFinite(t)) body.model_temperature = t;
     }
     if (extraFetchParams.web_search === true || extraFetchParams.web_search === 'true') {
       body.web_search = true;
     }
   }

   const headers = {
     'Content-Type': 'application/json',
     'Accept': 'text/event-stream',
   };
   if (token) headers['Authorization'] = `Bearer ${token}`;

   console.log('[API] askGeneralChatStream called with params:', {
     session_id: sessionId,
     question_preview: question.substring(0, 80),
     endpoint: `${CHAT_MODEL_BASE_URL}/api/chat/ask/general/stream`,
   });

   // Micro-yield helper for the general chat stream
   const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

   try {
     const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/general/stream`, {
       method: 'POST',
       headers,
       body: JSON.stringify(body),
       credentials: 'omit',
       ...(abortSignal ? { signal: abortSignal } : {}),
     });

     if (!response.ok) {
       const errorData = await response.json().catch(() => ({}));
       const quota = parseQuotaHttpError(response.status, errorData);
       if (quota) {
         throw createQuotaError(quota, response.status);
       }
       const normalized =
         errorData && typeof errorData === 'object' && errorData.detail && typeof errorData.detail === 'object'
           ? errorData.detail
           : errorData;
       const err = new Error(normalized.message || normalized.error || `HTTP error! status: ${response.status}`);
       err.code = normalized.code;
       err.details = normalized.details;
       err.status = response.status;
       err.response = { status: response.status, data: normalized, rawData: errorData };
       throw err;
     }

     const reader = response.body.getReader();
     const decoder = new TextDecoder();
     let buffer = '';
     let streamDone = false;
     let doneDispatched = false;
     let accumulatedAnswer = '';
     let lastYieldTime = performance.now();

     while (true) {
       const { done, value } = await reader.read();
       if (done) {
         break;
       }

       buffer += decoder.decode(value, { stream: true });
       const lines = buffer.split(/\r\n|\n|\r/);
       buffer = lines.pop() || '';

       for (const line of lines) {
         if (!line.trim()) continue;
         let data = line.trim();
         if (data.startsWith('data: ')) data = data.substring(6).trim();
         if (data === '[PING]') continue;
         if (data === '[DONE]') { streamDone = true; break; }
         if (!data) continue;

         try {
           const parsed = JSON.parse(data);
           if (parsed.type === 'status' && onStatus) onStatus(parsed.status, parsed.message);
           else if (parsed.type === 'metadata' && onMetadata) onMetadata(parsed);
           else if (parsed.type === 'sources' && onMetadata) {
             onMetadata({ sources: parsed.sources || [], web_search_queries: parsed.queries || [] });
           } else if (parsed.type === 'thought' && onThought) {
             const thoughtPiece = typeof parsed.text === 'string' ? parsed.text : '';
             if (thoughtPiece) onThought(thoughtPiece);
           } else if (parsed.type === 'chunk' && onChunk) {
             const piece = typeof parsed.text === 'string' ? parsed.text : '';
             accumulatedAnswer += piece;
             onChunk(piece);
           } else if (parsed.type === 'done' && onDone) {
             const fromServer = typeof parsed.answer === 'string' ? parsed.answer : '';
             const merged =
               fromServer.length > accumulatedAnswer.length ? fromServer : (accumulatedAnswer || fromServer);
             doneDispatched = true;
             onDone({ ...parsed, answer: merged });
             streamDone = true;
           } else if (parsed.type === 'error' && onError) {
             onError(parsed.message, parsed.details, parsed.code);
             streamDone = true;
           }
         } catch (e) {
           console.warn('[API] Failed to parse SSE data:', data, e);
         }

         if (performance.now() - lastYieldTime > 16) {
           await yieldToMain();
           lastYieldTime = performance.now();
         }
       }

       if (streamDone) break;
     }

     if (onDone && !doneDispatched) {
       doneDispatched = true;
       onDone({ answer: accumulatedAnswer });
     }
  } catch (error) {
     console.error('[API] General chat streaming error:', error);
     if (onError) onError(error.message, error.details, error.code);
     throw error;
   }
 }

 async getChunkDetails(chunkIds, fileId) {
   if (!chunkIds || chunkIds.length === 0) {
     return [];
   }
   return this.request(`/files/${fileId}/chunks`, {
     method: "POST",
     body: JSON.stringify({ chunk_ids: chunkIds }),
   });
 }

 async getFolderChunkDetails(chunkIds, folderName) {
   if (!chunkIds || chunkIds.length === 0 || !folderName) {
     console.log('[API] getFolderChunkDetails: Missing chunkIds or folderName', { chunkIds, folderName });
     return [];
   }
   console.log('[API] Fetching chunks for folder:', folderName, 'chunk_ids:', chunkIds);
   try {
     const response = await this.request(`/api/files/${folderName}/chunks`, {
       method: "POST",
       body: JSON.stringify({ chunk_ids: chunkIds }),
     });
     console.log('[API] Chunks response:', response);
     const chunks = Array.isArray(response) ? response : (response.chunks || []);
     console.log('[API] Parsed chunks:', chunks.length, 'chunks');
     return chunks;
   } catch (error) {
     console.error('[API] Error fetching folder chunks:', error);
     try {
       const chunkIdsParam = chunkIds.join(',');
       const response = await this.request(`/api/files/${folderName}/chunks?chunk_ids=${chunkIdsParam}`, {
         method: "GET",
       });
       const chunks = Array.isArray(response) ? response : (response.chunks || []);
       console.log('[API] Chunks (GET fallback):', chunks.length, 'chunks');
       return chunks;
     } catch (fallbackError) {
       console.error('[API] Fallback also failed:', fallbackError);
       throw error;
     }
   }
 }

  async createGeminiCache(payload) {
    return this.chatModelRequest('/api/chat/cache/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async askGeminiCacheQuestion(fileId, question, displayName = '') {
    return this.chatModelRequest('/api/chat/cache/ask', {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId, question, displayName }),
    });
  }

  async askGeminiCacheQuestionStream(fileId, question, displayName = '', onChunk, onStatus, onDone, onError, abortSignal = null) {
    const token = this.getAuthToken();
    const base  = CHAT_MODEL_BASE_URL || 'http://localhost:8096';

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const response = await fetch(`${base}/api/chat/cache/ask/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ file_id: fileId, question, displayName }),
        credentials: 'omit',
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const quota = parseQuotaHttpError(response.status, errorData);
        if (quota) {
          throw createQuotaError(quota, response.status);
        }
        const normalized =
          errorData && typeof errorData === 'object' && errorData.detail && typeof errorData.detail === 'object'
            ? errorData.detail
            : errorData;
        const err = new Error(normalized.message || `HTTP error! status: ${response.status}`);
        err.code = normalized.code;
        err.details = normalized.details;
        err.status = response.status;
        throw err;
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;
      let doneDispatched = false;
      let accumulatedAnswer = '';
      let latestTokenUsage = null;
      let latestSessionMetrics = null;
      let streamError = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\n|\r/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let data = line.trim();
          if (data.startsWith('data: ')) data = data.substring(6).trim();
          if (data === '[PING]') continue;
          if (data === '[DONE]') { streamDone = true; break; }
          if (!data) continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            console.warn('[API] Failed to parse cache SSE data:', data, e);
            continue;
          }

          if (parsed.type === 'status' && onStatus) {
            onStatus(parsed.status, parsed.message);
          } else if (parsed.type === 'thought') {
            // Model is in thinking phase — signal 'generating' so the UI shows the active spinner
            if (onStatus) onStatus('generating', 'Model thinking...');
          } else if (parsed.type === 'cache_session') {
            latestSessionMetrics =
              parsed.cache_session_metrics || parsed.sessionMetrics || latestSessionMetrics;
          } else if (parsed.type === 'chunk' && onChunk) {
            const piece = typeof parsed.text === 'string' ? parsed.text : '';
            accumulatedAnswer += piece;
            onChunk(piece);
          } else if (parsed.type === 'cache_session') {
            latestSessionMetrics =
              parsed.cache_session_metrics || parsed.sessionMetrics || latestSessionMetrics;
          } else if (parsed.type === 'usage') {
            latestTokenUsage = parsed.tokenUsage || parsed;
            latestSessionMetrics = parsed.sessionMetrics || parsed.session_metrics || latestSessionMetrics;
          } else if (parsed.type === 'done' && onDone) {
            const fromServer = typeof parsed.answer === 'string' ? parsed.answer : '';
            const merged = fromServer.length > accumulatedAnswer.length ? fromServer : (accumulatedAnswer || fromServer);
            doneDispatched = true;
            onDone({
              ...parsed,
              answer: merged,
              tokenUsage: parsed.tokenUsage || latestTokenUsage || parsed.token_usage,
              sessionMetrics: parsed.sessionMetrics || latestSessionMetrics || parsed.session_metrics,
            });
            streamDone = true;
          } else if (parsed.type === 'error') {
            streamError = new Error(parsed.message || 'Cache stream failed');
            streamError.code = parsed.code;
            streamError.details = parsed.details;
            if (onError) onError(parsed.message, parsed.details, parsed.code);
            streamDone = true;
          }
        }

        if (streamDone) break;
      }

      if (streamError) throw streamError;

      if (onDone && !doneDispatched) {
        doneDispatched = true;
        onDone({ answer: accumulatedAnswer, tokenUsage: latestTokenUsage, sessionMetrics: latestSessionMetrics });
      }
    } catch (error) {
      console.error('[API] Cache streaming error:', error);
      if (onError) onError(error.message);
      throw error;
    }
  }

  async getGeminiCacheStatus(sessionId) {
    return this.chatModelRequest(`/api/chat/cache/status/${sessionId}`);
  }

  async getGeminiCacheFileStatus(fileId) {
    return this.chatModelRequest(`/api/chat/cache/file-status/${fileId}`);
  }

  async deleteGeminiCache(sessionId) {
    return this.chatModelRequest('/api/chat/cache/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  /**
   * Count tokens for an uploaded file using Vertex AI's free countTokens API.
   * Mirrors the Google AI Studio live token count — call immediately after upload.
   * @param {string} fileId  The uploaded file UUID
   * @param {string} [modelName]  Gemini model (default: gemini-2.5-pro)
   */
  async countFileTokens(fileId, modelName = 'gemini-2.5-pro') {
    return this.chatModelRequest('/api/chat/count-tokens', {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId, model_name: modelName }),
    });
  }
}

export default new ApiService();
