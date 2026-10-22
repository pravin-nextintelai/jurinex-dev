import axios from 'axios';
import { API_BASE_URL, VISUAL_SERVICE_URL } from '@/config/apiConfig';

const getAuthToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

const getHeaders = () => ({
  'Authorization': `Bearer ${getAuthToken()}`,
  'Content-Type': 'application/json'
});

export const mindmapService = {
  async generateMindmap(fileId, sessionId = null, prompt = null) {
    try {
      const response = await axios.post(
        `${VISUAL_SERVICE_URL}/generate-mindmap`,
        {
          file_id: fileId,
          session_id: sessionId,
          prompt: prompt
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error generating mind map:', error);
      throw error;
    }
  },

  async generateMindmapMulti(fileIds, sessionId = null, prompt = null) {
    try {
      const response = await axios.post(
        `${VISUAL_SERVICE_URL}/generate-mindmap`,
        {
          file_ids: fileIds,
          session_id: sessionId,
          prompt: prompt
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error generating multi-file mind map:', error);
      throw error;
    }
  },

  async getMindmap(mindmapId) {
    try {
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmap`,
        {
          params: { mindmap_id: mindmapId },
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind map:', error);
      throw error;
    }
  },

  async getMindmapsByFile(fileId, sessionId = null) {
    try {
      const params = { file_id: fileId };
      if (sessionId) {
        params.session_id = sessionId;
      }
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmaps`,
        {
          params: params,
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind maps:', error);
      throw error;
    }
  },

  async getMindmapBySession(sessionId) {
    try {
      console.log('[mindmapService] Fetching mindmap for session:', sessionId);
      console.log('[mindmapService] Using endpoint:', `${VISUAL_SERVICE_URL}/mindmap`);
      
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmap`,
        {
          params: { session_id: sessionId },
          headers: getHeaders()
        }
      );
      
      console.log('[mindmapService] Mindmap response received:', {
        status: response.status,
        data: response.data,
        hasData: !!response.data,
        hasSuccess: response.data?.success !== undefined,
        hasDataField: !!response.data?.data,
        responseKeys: response.data ? Object.keys(response.data) : []
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[mindmapService] No mindmap found for session (404):', sessionId);
        return { success: false, data: null };
      }
      
      if (error.response?.status === 404 || error.code === 'ERR_BAD_REQUEST') {
        console.log('[mindmapService] Trying alternative endpoint path...');
        try {
          const altResponse = await axios.get(
            `${VISUAL_SERVICE_URL}/mindmap`,
            {
              params: { session_id: sessionId },
              headers: getHeaders()
            }
          );
          console.log('[mindmapService] Alternative endpoint succeeded');
          return altResponse.data;
        } catch (altError) {
          console.log('[mindmapService] Alternative endpoint also failed');
        }
      }
      
      console.error('[mindmapService] Error getting mindmap by session:', error);
      console.error('[mindmapService] Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });
      throw error;
    }
  },

  async getMindmapsMetadataBySession(sessionId) {
    try {
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmaps/session`,
        {
          params: { session_id: sessionId },
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind maps metadata by session:', error);
      throw error;
    }
  },

  async updateNodeState(nodeId, isCollapsed) {
    try {
      const response = await axios.put(
        `${VISUAL_SERVICE_URL}/mindmap/node/state`,
        {
          node_id: nodeId,
          is_collapsed: isCollapsed
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error updating node state:', error);
      throw error;
    }
  },

  async deleteMindmap(mindmapId) {
    try {
      const response = await axios.delete(
        `${VISUAL_SERVICE_URL}/mindmap/${mindmapId}`,
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error deleting mind map:', error);
      throw error;
    }
  }
};

