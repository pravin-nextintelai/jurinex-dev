import { useEffect, useRef, useCallback, useState } from 'react';
import { CONTENT_SERVICE_DIRECT } from '@/config/apiConfig';

const API_BASE_URL = CONTENT_SERVICE_DIRECT;

const decodeJWTToken = (token) => {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
};

const getUserIdFromToken = () => {
  try {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token) return null;

    const decoded = decodeJWTToken(token);
    if (!decoded) return null;

    const userId = decoded.id || 
                   decoded.userId || 
                   decoded.user_id || 
                   decoded.sub || 
                   (decoded.user && decoded.user.id);

    const userIdInt = parseInt(userId, 10);
    return isNaN(userIdInt) || userIdInt <= 0 ? null : userIdInt;
  } catch (error) {
    console.error('Error extracting user ID from token:', error);
    return null;
  }
};

const isTokenExpired = (token) => {
  try {
    const decoded = decodeJWTToken(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
};

export const useAutoSave = (caseData, currentStep, providedUserId = null, isEnabled = true) => {
  const timeoutRef = useRef(null);
  const lastSavedDataRef = useRef(null);
  const isInitialMount = useRef(true);

  const [saveStatus, setSaveStatus] = useState('idle');
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [tokenError, setTokenError] = useState(null);

  const actualUserId = providedUserId || getUserIdFromToken();

  useEffect(() => {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token) {
      setTokenError('No authentication token found. Please log in.');
      return;
    }

    if (isTokenExpired(token)) {
      setTokenError('Your session has expired. Please log in again.');
      return;
    }

    if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
      setTokenError('Invalid user ID. Unable to save draft.');
      return;
    }

    setTokenError(null);
  }, [actualUserId]);

  const hasDataChanged = useCallback((newData, oldData) => {
    return JSON.stringify(newData) !== JSON.stringify(oldData);
  }, []);

  const hasMeaningfulData = useCallback((data) => {
    const defaultValues = ['Medium', 'High Court', 'Delhi', 'Active'];
    
    const userInputFields = ['caseTitle', 'caseNumber', 'caseType', 'subType', 'courtName', 'filingDate'];
    
    const hasImportantData = userInputFields.some(field => {
      const value = data[field];
      if (!value) return false;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' && !defaultValues.includes(trimmed);
      }
      return false;
    });
    
    const hasArrayData = ['petitioners', 'respondents'].some(field => {
      const arr = data[field];
      if (!Array.isArray(arr) || arr.length === 0) return false;
      return arr.some(item => {
        if (typeof item === 'object' && item !== null) {
          return Object.values(item).some(v => v && typeof v === 'string' && v.trim() !== '');
        }
        return false;
      });
    });
    
    return hasImportantData || hasArrayData;
  }, []);

  const saveDraft = useCallback(async (userId, data, step) => {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) {
      throw new Error('Authentication token expired');
    }

    const response = await fetch(`${API_BASE_URL}/case-draft/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        draftData: JSON.stringify(data),
        lastStep: step,
      }),
    });

    if (response.status === 401) {
      throw new Error('Authentication token expired');
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Save failed: ${response.status} ${text}`);
    }

    return await response.json();
  }, []);

  const loadDraft = useCallback(async () => {
    if (!actualUserId || tokenError) return null;

    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load draft');

      const result = await response.json();
      if (result.exists === false || !result.draft_data) return null;
      return {
        ...result,
        draft_data: typeof result.draft_data === 'string'
          ? JSON.parse(result.draft_data)
          : result.draft_data,
      };
    } catch (error) {
      console.error('Load draft error:', error);
      return null;
    }
  }, [actualUserId, tokenError]);

  const deleteDraft = useCallback(async () => {
    if (!actualUserId || tokenError) {
      console.log('Cannot delete draft: invalid user ID or token');
      return { success: false, error: 'Invalid session' };
    }

    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) {
      return { success: false, error: 'Token expired' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 404) {
        console.log('No draft to delete (already gone)');
        return { success: true };
      }

      if (!response.ok) throw new Error('Delete failed');

      console.log('Draft permanently deleted from database');
      lastSavedDataRef.current = null;
      return { success: true };
    } catch (error) {
      console.error('Delete draft error:', error);
      return { success: false, error: error.message };
    }
  }, [actualUserId, tokenError]);

  const manualSave = useCallback(async () => {
    if (tokenError || !actualUserId) {
      return { success: false, error: tokenError || 'Invalid user ID' };
    }

    setSaveStatus('saving');
    try {
      await saveDraft(actualUserId, caseData, currentStep);
      lastSavedDataRef.current = { ...caseData };
      setSaveStatus('saved');
      setLastSaveTime(new Date());
      setTimeout(() => setSaveStatus('idle'), 3000);
      return { success: true };
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 5000);
      return { success: false, error: error.message };
    }
  }, [actualUserId, caseData, currentStep, saveDraft, tokenError]);

  useEffect(() => {
    if (!isEnabled || tokenError || !actualUserId || !Number.isInteger(actualUserId)) {
      return;
    }

    if (isInitialMount.current) {
      console.log('⏭️ Skipping initial mount auto-save');
      isInitialMount.current = false;
      lastSavedDataRef.current = { ...caseData };
      return;
    }

    if (!hasDataChanged(caseData, lastSavedDataRef.current)) {
      console.log('⏭️ No data changes detected, skipping auto-save');
      return;
    }

    if (!hasMeaningfulData(caseData)) {
      console.log('⏭️ No meaningful data to save, skipping auto-save');
      return;
    }
    
    console.log('✅ Data changed and meaningful, triggering auto-save in 2s...');

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      (async () => {
        setSaveStatus('saving');
        try {
          await saveDraft(actualUserId, caseData, currentStep);
          lastSavedDataRef.current = { ...caseData };
          setSaveStatus('saved');
          setLastSaveTime(new Date());
          setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (error) {
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 5000);
        }
      })();
    }, 2000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [caseData, currentStep, actualUserId, isEnabled, hasDataChanged, hasMeaningfulData, saveDraft, tokenError]);

  const resetAutoSave = useCallback((draftData) => {
    console.log('🔄 Resetting auto-save baseline with draft data');
    lastSavedDataRef.current = { ...draftData };
    isInitialMount.current = false;
  }, []);

  return {
    saveStatus,
    lastSaveTime,
    actualUserId,
    tokenError,
    manualSave,
    loadDraft,
    deleteDraft,
    resetAutoSave,
  };
};
