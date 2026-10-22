import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import ChatQuotaErrorModal from '../components/ChatQuotaErrorModal';
import { fetchTokenQuotaStatus, invalidateTokenQuotaCache } from '../api/tokenQuotaService';
import { isQuotaError, normalizeQuotaErrorForModal } from '@/shared/utils/quotaError';

const TokenQuotaContext = createContext({
  showQuotaError: () => false,
  clearQuotaError: () => {},
  quotaError: null,
  quotaStatus: null,
  isExhausted: false,
  refreshQuota: async () => {},
  onTopupSuccess: () => {},
});

export function TokenQuotaProvider({ children }) {
  const [quotaError, setQuotaError] = useState(null);
  const [quotaStatus, setQuotaStatus] = useState(null);

  const isExhausted = !!quotaStatus?.monthly_exhausted;

  // Proactive check on mount — only when the user is authenticated.
  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (!token) return;
    fetchTokenQuotaStatus().then(setQuotaStatus).catch(() => {});
  }, []);

  const refreshQuota = useCallback(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (!token) return;
    try {
      invalidateTokenQuotaCache();
      const status = await fetchTokenQuotaStatus({ forceRefresh: true });
      setQuotaStatus(status);
      return status;
    } catch {}
  }, []);

  const clearQuotaError = useCallback(() => {
    setQuotaError(null);
  }, []);

  const showQuotaError = useCallback((error) => {
    const display = normalizeQuotaErrorForModal(error);
    if (!display && !isQuotaError(error)) {
      return false;
    }
    setQuotaError(error);
    return true;
  }, []);

  const handleTopupSuccess = useCallback(() => {
    invalidateTokenQuotaCache();
    clearQuotaError();
    refreshQuota();
  }, [clearQuotaError, refreshQuota]);

  const value = useMemo(
    () => ({ showQuotaError, clearQuotaError, quotaError, quotaStatus, isExhausted, refreshQuota, onTopupSuccess: handleTopupSuccess }),
    [showQuotaError, clearQuotaError, quotaError, quotaStatus, isExhausted, refreshQuota, handleTopupSuccess]
  );

  return (
    <TokenQuotaContext.Provider value={value}>
      {children}
      <ChatQuotaErrorModal
        error={quotaError}
        onDismiss={clearQuotaError}
        onTopupSuccess={handleTopupSuccess}
      />
    </TokenQuotaContext.Provider>
  );
}

export function useTokenQuota() {
  return useContext(TokenQuotaContext);
}

export function useQuotaErrorHandler() {
  const { showQuotaError } = useTokenQuota();
  return useCallback(
    (error, fallbackMessage) => {
      if (showQuotaError(error)) return null;
      return fallbackMessage || error?.message || 'Something went wrong.';
    },
    [showQuotaError]
  );
}
