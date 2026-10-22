import { useCallback, useEffect, useRef, useState } from 'react';
import { getCaseChronology, rebuildCaseChronology } from '../api/chronologyApi';

/**
 * Loads the case chronology tree for a folder and exposes a rebuild action
 * (POST extract-case-fields) for when the stored tree is empty or stale.
 */
export default function useChronology(folderName) {
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!folderName) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCaseChronology(folderName);
      if (aliveRef.current) setTree(data);
    } catch (err) {
      if (aliveRef.current) {
        if (err?.response?.status === 404) {
          setTree({ dates: [], phases: [], sourceDocuments: [], eventCount: 0 });
        } else {
          setError(err?.response?.data?.detail || err.message || 'Failed to load chronology');
        }
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [folderName]);

  const rebuild = useCallback(async () => {
    if (!folderName) return;
    setRebuilding(true);
    setError(null);
    try {
      const data = await rebuildCaseChronology(folderName);
      if (aliveRef.current) setTree(data);
    } catch (err) {
      if (aliveRef.current) {
        setError(err?.response?.data?.detail || err.message || 'Failed to build chronology');
      }
    } finally {
      if (aliveRef.current) setRebuilding(false);
    }
  }, [folderName]);

  useEffect(() => {
    load();
  }, [load]);

  return { tree, loading, rebuilding, error, reload: load, rebuild };
}
