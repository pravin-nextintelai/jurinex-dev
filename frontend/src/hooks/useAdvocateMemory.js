import { useCallback, useEffect, useRef, useState } from 'react';
import memoryApi, { describeMemoryError } from '../services/memoryApi';
import { ADVOCATE_MAX_LINES, LINE_MAX_CHARS } from '../utils/memoryLabels';

/**
 * What JuriNex remembers about the signed-in advocate, for every case.
 *
 * Every action resolves to `{ ok, error, data }`. Writes carry the version last
 * loaded; when the list changed elsewhere first (another window, or the chat
 * learning something), the latest list is loaded and the caller is asked to retry.
 */
export default function useAdvocateMemory({ enabled = true } = {}) {
  const [lines, setLines] = useState([]);
  const [version, setVersion] = useState(null);
  const [limits, setLimits] = useState({ maxLines: ADVOCATE_MAX_LINES, maxLineChars: LINE_MAX_CHARS, maxChars: 3000 });
  // How full the set is, and what the last tidy did (null when there is nothing to undo).
  const [usedChars, setUsedChars] = useState(0);
  const [canConsolidate, setCanConsolidate] = useState(false);
  const [consolidation, setConsolidation] = useState(null);
  // What a question actually carries, as against what is stored.
  const [reach, setReach] = useState({ budgetChars: 0, sentChars: 0, sentLines: 0, unsentLines: 0 });
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
    if (!enabled) return null;
    setLoading(true);
    try {
      const data = await memoryApi.getAdvocateMemory();
      if (aliveRef.current) {
        setLines(Array.isArray(data?.lines) ? data.lines : []);
        setVersion(data?.version ?? null);
        setLimits({
          maxLines: data?.max_lines || ADVOCATE_MAX_LINES,
          maxLineChars: data?.max_line_chars || LINE_MAX_CHARS,
          maxChars: data?.max_chars || 3000,
        });
        setUsedChars(Number(data?.used_chars) || 0);
        setCanConsolidate(Boolean(data?.can_consolidate));
        setConsolidation(data?.consolidation || null);
        setReach({
          budgetChars: Number(data?.send_budget_chars) || 0,
          sentChars: Number(data?.send_chars) || 0,
          sentLines: Number(data?.sent_lines) || 0,
          unsentLines: Number(data?.unsent_lines) || 0,
        });
        setError(null);
        setLoaded(true);
      }
      return data;
    } catch (err) {
      if (aliveRef.current) setError(describeMemoryError(err, 'Could not load what JuriNex knows about you.'));
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(
    async (action, fallback) => {
      try {
        const data = await action(versionRef.current);
        await load();
        return { ok: true, data };
      } catch (err) {
        const described = describeMemoryError(err, fallback);
        if (described.kind === 'conflict') {
          await load();
          return {
            ok: false,
            error: { ...described, message: 'This list changed somewhere else. The latest is shown now; try again.' },
          };
        }
        if (described.kind === 'not_found') await load();
        return { ok: false, error: described };
      }
    },
    [load],
  );

  const add = useCallback(
    (category, text) =>
      run((v) => memoryApi.addAdvocateFact({ category, text, version: v }), 'Could not remember that.'),
    [run],
  );

  const update = useCallback(
    (line, patch) =>
      run((v) => memoryApi.updateAdvocateFact(line.id, { ...patch, version: v }), 'Could not save that change.'),
    [run],
  );

  const remove = useCallback(
    (line) => run((v) => memoryApi.deleteAdvocateFact(line.id, v), 'Could not forget that.'),
    [run],
  );

  const forgetAll = useCallback(
    () => run(() => memoryApi.forgetAdvocate(), 'Could not forget everything about you.'),
    [run],
  );

  // Fold overlapping facts into fewer, sharper lines — and put them back.
  const consolidate = useCallback(
    () => run((v) => memoryApi.consolidateAdvocate(v), 'Could not tidy what JuriNex knows about you.'),
    [run],
  );

  const undoConsolidation = useCallback(
    () => run((v) => memoryApi.undoAdvocateConsolidation(v), 'Could not put the earlier version back.'),
    [run],
  );

  return {
    lines,
    version,
    limits,
    usedChars,
    canConsolidate,
    consolidation,
    reach,
    loading,
    loaded,
    error,
    reload: load,
    add,
    update,
    remove,
    forgetAll,
    consolidate,
    undoConsolidation,
  };
}
