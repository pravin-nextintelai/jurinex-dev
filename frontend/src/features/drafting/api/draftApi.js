import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

/**
 * Service for interacting with Draft Service API
 * Handles document CRUD operations and Microsoft Word integration
 */

const getAuthToken = () => {
  // Try multiple possible localStorage keys
  const token = localStorage.getItem('token') || 
                localStorage.getItem('authToken') || 
                localStorage.getItem('access_token') || 
                localStorage.getItem('jwt') ||
                localStorage.getItem('auth_token');
  
  // Debug logging
  if (!token) {
    console.warn('[draftApi] No token found in localStorage. Available keys:', Object.keys(localStorage));
  } else {
    console.log('[draftApi] Token retrieved successfully, length:', token.length);
  }
  
  return token;
};

const getHeaders = () => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    console.error('[draftApi] No token available for request');
  }
  
  return headers;
};

export const draftApi = {
  /**
   * Get all documents for the current user
   * ✅ SECURITY: Backend verifies user_id from JWT token
   */
  async getDocuments() {
    try {
      // URL from apiConfig.DRAFTING_SERVICE_URL
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.documents || [];
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }
  },

  /**
   * Get only Word-linked documents for the current user
   * ✅ SECURITY: Backend filters by user_id AND word_file_id IS NOT NULL
   */
  async getWordDocuments() {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents/word`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.documents || [];
    } catch (error) {
      console.error('Error fetching Word documents:', error);
      throw error;
    }
  },

  /**
   * Get a single document by ID
   */
  async getDocument(documentId) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents/${documentId}`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.document;
    } catch (error) {
      console.error('Error fetching document:', error);
      throw error;
    }
  },

  /**
   * Create a new document
   */
  async createDocument(title, content = '') {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.document;
    } catch (error) {
      console.error('Error creating document:', error);
      throw error;
    }
  },

  /**
   * Update an existing document
   */
  async updateDocument(documentId, title, content) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents/${documentId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.document;
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  },

  /**
   * Delete a document
   */
  async deleteDocument(documentId) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  },

  /**
   * Check Microsoft connection status
   */
  async getMicrosoftStatus() {
    try {
      const headers = getHeaders();
      console.log('[draftApi] getMicrosoftStatus - URL:', `${DRAFTING_SERVICE_URL}/api/auth/status`);
      console.log('[draftApi] getMicrosoftStatus - Headers:', headers);
      
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/auth/status`, {
        method: 'GET',
        headers: headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[draftApi] getMicrosoftStatus error response:', errorText);
        // Don't throw error for status check - just return not connected
        return { isConnected: false };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error checking Microsoft status:', error);
      return { isConnected: false };
    }
  },

  /**
   * Initiate Microsoft OAuth sign-in
   */
  async signInWithMicrosoft() {
    try {
      // Get token from localStorage
      const token = localStorage.getItem('token') || 
                    localStorage.getItem('authToken') || 
                    localStorage.getItem('access_token') || 
                    localStorage.getItem('jwt') ||
                    localStorage.getItem('auth_token');
      
      console.log('[draftApi] signInWithMicrosoft - Token check:', {
        hasToken: !!token,
        tokenLength: token?.length,
        availableKeys: Object.keys(localStorage).filter(k => k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))
      });
      
      if (!token) {
        console.error('[draftApi] No token found in localStorage');
        throw new Error('Authentication required. Please login first.');
      }

      // URL from apiConfig.DRAFTING_SERVICE_URL
      const signInUrl = `${DRAFTING_SERVICE_URL}/api/auth/signin?token=${encodeURIComponent(token)}`;
      console.log('[draftApi] Redirecting to Microsoft sign-in');
      console.log('[draftApi] URL:', signInUrl);
      console.log('[draftApi] DRAFTING_SERVICE_URL:', DRAFTING_SERVICE_URL);
      console.log('[draftApi] Token present:', !!token, 'Token length:', token?.length);
      
      // Redirect to Microsoft sign-in
      window.location.href = signInUrl;
    } catch (error) {
      console.error('Error initiating Microsoft sign-in:', error);
      throw error;
    }
  },

  /**
   * Disconnect Microsoft account
   */
  async disconnectMicrosoft() {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/auth/disconnect`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error disconnecting Microsoft account:', error);
      throw error;
    }
  },

  /**
   * Export document to Microsoft Word
   */
  async exportToWord(title, content, documentId = null) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/word/export`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ title, content, documentId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error exporting to Word:', error);
      throw error;
    }
  },

  /**
   * Sync document from Word (fetch content and update in Jurinex)
   */
  async syncFromWord(documentId) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/word/sync/${documentId}`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error syncing from Word:', error);
      throw error;
    }
  },

  /**
   * Re-open existing Word document in Word Online
   */
  async reopenWordDocument(documentId) {
    try {
      const response = await fetch(`${DRAFTING_SERVICE_URL}/api/word/reopen/${documentId}`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error reopening Word document:', error);
      throw error;
    }
  },
};

export default draftApi;