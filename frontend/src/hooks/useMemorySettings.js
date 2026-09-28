import { useCallback, useEffect, useState } from 'react';
import memoryApi, { describeMemoryError } from '../services/memoryApi';
import { DEFAULT_MEMORY_SETTINGS, MEMORY_SETTINGS_EVENT } from '../utils/memoryLabels';

/**
 * The signed-in advocate's memory settings, shared by every component that needs
 * them: the Settings page toggles and the case page's Memory button.
 *
 * One request per page load: the result is cached at module level, and a save
 * anywhere is broadcast so every mounted instance updates without a reload.
 */

let cache = null;
let inflight = null;

const normalize = (data) => ({
  settings: { ...DEFAULT_MEMORY_SETTINGS, ...(data?.settings || {}) },
  effective: { ...DEFAULT_MEMORY_SETTINGS, ...(data?.effective || {}) },
});

const fetchUserSettings = () => {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = memoryApi
      .getSettings('user')
      .then((data) => {
        cache = normalize(data);
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

const broadcast = (value) => {
  window.dispatchEvent(new CustomEvent(MEMORY_SETTINGS_EVENT, { detail: value }));
};

/** Forget the cached settings, e.g. after the user signs out. */
export function clearMemorySettingsCache() {
  cache = null;
}

export default function useMemorySettings() {
  const [state, setState] = useState(() => cache || normalize(null));
  const [loading, setLoading] = useState(() => !cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchUserSettings()
      .then((value) => {
        if (!alive) return;
        setState(value);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(describeMemoryError(err, 'Could not load your memory settings.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    const onUpdate = (event) => {
      if (event?.detail) setState(event.detail);
    };
    window.addEventListener(MEMORY_SETTINGS_EVENT, onUpdate);
    return () => {
      alive = false;
      window.removeEventListener(MEMORY_SETTINGS_EVENT, onUpdate);
    };
  }, []);

  const update = useCallback(
    async (patch) => {
      const previous = cache || state;
      setState({ ...previous, settings: { ...previous.settings, ...patch } });
      try {
        const data = await memoryApi.updateSettings(patch, 'user');
        cache = normalize(data);
        broadcast(cache);
        setError(null);
        return { ok: true, value: cache };
      } catch (err) {
        setState(previous);
        return { ok: false, error: describeMemoryError(err, 'Could not save your memory settings.') };
      }
    },
    [state],
  );

  // Re-read after something else changed the result, such as a firm-wide setting.
  const refresh = useCallback(async () => {
    cache = null;
    try {
      const value = await fetchUserSettings();
      broadcast(value);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: describeMemoryError(err, 'Could not reload your memory settings.') };
    }
  }, []);

  return {
    settings: state.settings,
    effective: state.effective,
    loading,
    error,
    update,
    refresh,
  };
}
