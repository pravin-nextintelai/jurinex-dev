import { useCallback, useEffect, useRef, useState } from 'react';
import memoryApi, { describeMemoryError } from '../services/memoryApi';

/**
 * One set of instructions: the advocate's universal ones (scope 'user') or a
 * case's (scope 'case'). With a folder name, a universal set also carries each
 * item's state in that case; with a session id, each item's per-chat mute.
 *
 * Every action resolves to `{ ok, error, ... }`. Writes carry the version last
 * loaded; when the set changed elsewhere first, the latest list is loaded and
 * the caller is told to try again.
 */
export default function useInstructions(scope, { folderName = null, sessionId = null, enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [version, setVersion] = useState(null);
  const [limits, setLimits] = useState({ maxItems: 40, maxItemChars: 400, maxChars: 4000 });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const aliveRef = useRef(true);
  const versionRef = useRef(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  const load = useCallback(async () => {
    if (!enabled || (scope === 'case' && !folderName)) return null;
    setLoading(true);
    try {
      const data = await memoryApi.listInstructions(scope, folderName, sessionId);
      if (aliveRef.current) {
        setItems(Array.isArray(data?.items) ? data.items : []);
        setVersion(data?.version ?? null);
        setLimits({
          maxItems: data?.max_items || 40,
          maxItemChars: data?.max_item_chars || 400,
          maxChars: data?.max_chars || 4000,
        });
        setError(null);
        setLoaded(true);
      }
      return data;
    } catch (err) {
      if (aliveRef.current) setError(describeMemoryError(err, 'Could not load these instructions.'));
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [enabled, scope, folderName, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // A write that lost to another window: show the latest list, ask for a retry.
  const afterConflict = useCallback(
    async (described) => {
      await load();
      return {
        ...described,
        message: 'These instructions changed somewhere else. The latest list is shown now; try that change again.',
      };
    },
    [load],
  );

  const run = useCallback(
    async (action, fallback) => {
      try {
        const data = await action(versionRef.current);
        await load();
        return { ok: true, data };
      } catch (err) {
        const described = describeMemoryError(err, fallback);
        if (described.kind === 'conflict') return { ok: false, error: await afterConflict(described) };
        if (described.kind === 'not_found') await load();
        return { ok: false, error: described };
      }
    },
    [load, afterConflict],
  );

  const add = useCallback(
    (text, { enabled: on = true, polished = false } = {}) =>
      run(
        (v) => memoryApi.addInstruction(scope, folderName, { text, version: v, enabled: on, polished }),
        'Could not add that instruction.',
      ),
    [run, scope, folderName],
  );

  const update = useCallback(
    (item, patch) =>
      run(
        (v) => memoryApi.updateInstruction(scope, folderName, item.id, { ...patch, version: v }),
        'Could not change that instruction.',
      ),
    [run, scope, folderName],
  );

  const remove = useCallback(
    (item) =>
      run((v) => memoryApi.deleteInstruction(scope, folderName, item.id, v), 'Could not remove that instruction.'),
    [run, scope, folderName],
  );

  // override: 'case' (this case only; universal items) or 'session' (this chat).
  // value: true / false, or null to clear the override.
  const setOverride = useCallback(
    (item, override, value) =>
      run(
        () =>
          memoryApi.setInstructionOverride(scope, folderName, item.id, {
            override,
            enabled: value,
            ...(override === 'session' ? { session_id: sessionId } : {}),
          }),
        'Could not change where that instruction applies.',
      ),
    [run, scope, folderName, sessionId],
  );

  const polish = useCallback(
    async (text) => {
      try {
        const data = await memoryApi.polishInstruction(text, scope);
        return { ok: true, ...data };
      } catch (err) {
        return { ok: false, error: describeMemoryError(err, "Couldn't polish that right now.") };
      }
    },
    [scope],
  );

  return {
    scope,
    folderName,
    sessionId,
    items,
    version,
    limits,
    loading,
    loaded,
    error,
    reload: load,
    add,
    update,
    remove,
    setOverride,
    polish,
  };
}
