import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context';
import {
  fetchLlmChatLimits,
  getMaxUploadBytesFromLimits,
  getMaxUploadMbLabel,
  invalidateLlmChatLimitsCache,
} from '../api/llmChatLimitsService';

/**
 * Upload and generation caps from ChatModel `llm_chat_config` (DB).
 */
export function useLlmChatLimits() {
  const { planInfo } = useAuth();
  const planKey = planInfo?.planId ?? planInfo?.plan ?? null;
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      invalidateLlmChatLimitsCache();
      const data = await fetchLlmChatLimits({ forceRefresh: true });
      setLimits(data);
    } catch (e) {
      setError(e);
      setLimits(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        invalidateLlmChatLimitsCache();
        const data = await fetchLlmChatLimits({ forceRefresh: true });
        if (!cancelled) {
          setLimits(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setLimits(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planKey]);

  const maxUploadBytes = limits ? getMaxUploadBytesFromLimits(limits) : null;
  const maxUploadMbLabel = limits ? getMaxUploadMbLabel(limits) : null;

  return {
    limits,
    loading,
    error,
    maxUploadBytes,
    maxUploadMbLabel,
    refresh,
  };
}
