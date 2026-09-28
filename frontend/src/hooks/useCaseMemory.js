import { useCallback, useEffect, useRef, useState } from 'react';
import memoryApi, { describeMemoryError } from '../services/memoryApi';

/**
 * Everything the case memory panel reads and changes, for one case folder.
 *
 * Every action resolves to `{ ok, error, ... }` instead of throwing, so the
 * panel can show the reason inline. Section writes carry the version the panel
 * last loaded; when someone else changed the section first, the latest lines
 * are loaded and the caller's edit is left in place to be saved again.
 */

const downloadJson = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const safeFilePart = (value) =>
  String(value || 'Case').replace(/[^\w\- ]+/g, '').trim().replace(/ +/g, '_') || 'Case';

// A case that has never been filled from its details (one created before memory
// existed, say) is filled the first time its memory is opened, unless the
// advocate cleared it or has memory generation switched off.
const shouldAutoSeed = (overview) => {
  const effective = overview?.settings?.effective || {};
  return Boolean(
    overview &&
      !overview.line_count &&
      overview.seed &&
      overview.seed.auto_seed !== false &&
      !overview.seed.seeded_at &&
      effective.enabled !== false &&
      effective.write_enabled !== false,
  );
};

export default function useCaseMemory(folderName) {
  const [overview, setOverview] = useState(null);
  const [sections, setSections] = useState({});
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoSeeding, setAutoSeeding] = useState(false);
  const [error, setError] = useState(null);

  const aliveRef = useRef(true);
  const autoSeededRef = useRef(new Set());
  const sectionsRef = useRef(sections);
  const overviewRef = useRef(overview);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

  const setSection = useCallback((section, entry) => {
    if (!aliveRef.current) return;
    setSections((prev) => ({ ...prev, [section]: { ...(prev[section] || {}), ...entry } }));
  }, []);

  const loadOverview = useCallback(async () => {
    if (!folderName) return null;
    try {
      const data = await memoryApi.getCaseMemory(folderName);
      if (aliveRef.current) {
        setOverview(data);
        setError(null);
      }
      return data;
    } catch (err) {
      if (aliveRef.current) setError(describeMemoryError(err, "Could not load this case's memory."));
      return null;
    }
  }, [folderName]);

  const loadProposals = useCallback(async () => {
    if (!folderName) return;
    try {
      const data = await memoryApi.listProposals(folderName, 'pending');
      if (aliveRef.current) setProposals(Array.isArray(data?.proposals) ? data.proposals : []);
    } catch {
      // Suggestions are secondary; access problems already surface through the overview.
    }
  }, [folderName]);

  const loadSection = useCallback(
    async (section) => {
      if (!folderName || !section) return null;
      setSection(section, { loading: true, error: null });
      try {
        const data = await memoryApi.getSection(folderName, section);
        const entry = {
          version: data?.version ?? null,
          lines: Array.isArray(data?.lines) ? data.lines : [],
          loading: false,
          error: null,
        };
        setSection(section, entry);
        return entry;
      } catch (err) {
        setSection(section, { loading: false, error: describeMemoryError(err, 'Could not load this section.') });
        return null;
      }
    },
    [folderName, setSection],
  );

  const reload = useCallback(async () => {
    if (!folderName) return;
    setLoading(true);
    setSections({});
    const [data] = await Promise.all([loadOverview(), loadProposals()]);
    if (aliveRef.current) setLoading(false);
    if (!shouldAutoSeed(data) || autoSeededRef.current.has(folderName)) return;

    autoSeededRef.current.add(folderName);
    if (aliveRef.current) setAutoSeeding(true);
    try {
      await memoryApi.seedCase(folderName);
      if (aliveRef.current) setSections({});
      await loadOverview();
    } catch {
      // The empty state still offers "Fill from case details".
    } finally {
      if (aliveRef.current) setAutoSeeding(false);
    }
  }, [folderName, loadOverview, loadProposals]);

  useEffect(() => {
    reload();
  }, [reload]);

  const runOp = useCallback(
    async (section, body) => {
      const version = sectionsRef.current[section]?.version ?? null;
      try {
        await memoryApi.applyOp(folderName, section, { version, ...body });
        await Promise.all([loadSection(section), loadOverview()]);
        return { ok: true };
      } catch (err) {
        const described = describeMemoryError(err, 'Could not save that change.');
        if (described.kind === 'conflict') {
          const current = described.current || {};
          if (Array.isArray(current.lines)) {
            setSection(section, {
              version: current.current_version ?? null,
              lines: current.lines,
              loading: false,
              error: null,
            });
          } else {
            await loadSection(section);
          }
          await loadOverview();
          described.message =
            'This section changed while you were editing. The latest version is shown now; save again to apply your change.';
        }
        return { ok: false, error: described };
      }
    },
    [folderName, loadSection, loadOverview, setSection],
  );

  const addLine = useCallback(
    (section, text) => runOp(section, { op: 'append_line', tag: 'stated', text }),
    [runOp],
  );

  // An edited line becomes something the advocate stated, whatever its origin.
  const editLine = useCallback(
    (section, line, text) => runOp(section, { op: 'replace_line', tag: 'stated', text, line_id: line.id }),
    [runOp],
  );

  const deleteLine = useCallback(
    async (section, line) => {
      try {
        await memoryApi.deleteLine(folderName, line.id);
      } catch (err) {
        const described = describeMemoryError(err, 'Could not forget that line.');
        if (described.kind !== 'not_found') return { ok: false, error: described };
      }
      await Promise.all([loadSection(section), loadOverview()]);
      return { ok: true };
    },
    [folderName, loadSection, loadOverview],
  );

  const clearSection = useCallback(
    async (section) => {
      const version = sectionsRef.current[section]?.version ?? null;
      try {
        await memoryApi.deleteSection(folderName, section, version);
        setSection(section, { version: null, lines: [], loading: false, error: null });
        await loadOverview();
        return { ok: true };
      } catch (err) {
        const described = describeMemoryError(err, 'Could not clear that section.');
        if (described.kind === 'conflict') {
          await loadSection(section);
          described.message =
            'This section changed since you opened it. Review the latest lines, then clear it again if you still want to.';
        }
        return { ok: false, error: described };
      }
    },
    [folderName, loadSection, loadOverview, setSection],
  );

  const forgetAll = useCallback(async () => {
    try {
      const data = await memoryApi.forgetCase(folderName);
      await reload();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: describeMemoryError(err, "Could not forget this case's memory.") };
    }
  }, [folderName, reload]);

  // `text` is the wording the advocate approved for an accepted suggestion.
  const resolveProposal = useCallback(
    async (proposalId, decision, text) => {
      try {
        const data = await memoryApi.resolveProposal(folderName, proposalId, decision, text);
        await Promise.all([loadProposals(), loadOverview()]);
        return { ok: true, data };
      } catch (err) {
        const described = describeMemoryError(
          err,
          decision === 'accept' ? 'Could not accept that suggestion.' : 'Could not dismiss that suggestion.',
        );
        if (described.kind === 'not_found') await loadProposals();
        return { ok: false, error: described };
      }
    },
    [folderName, loadProposals, loadOverview],
  );

  const updateCaseSettings = useCallback(
    async (patch) => {
      try {
        const data = await memoryApi.updateSettings(patch, 'case', folderName);
        if (aliveRef.current) {
          setOverview((prev) =>
            prev
              ? {
                  ...prev,
                  settings: {
                    case: data?.settings || null,
                    effective: data?.effective || prev.settings?.effective,
                  },
                }
              : prev,
          );
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: describeMemoryError(err, "Could not save this case's memory settings.") };
      }
    },
    [folderName],
  );

  const exportMemory = useCallback(
    async (caseTitle) => {
      try {
        const data = await memoryApi.exportCase(folderName);
        downloadJson(`JuriNex_Memory_${safeFilePart(caseTitle || folderName)}.json`, data);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: describeMemoryError(err, "Could not export this case's memory.") };
      }
    },
    [folderName],
  );

  const importMemory = useCallback(
    async (file, replace) => {
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        return {
          ok: false,
          error: { kind: 'invalid', message: 'That file is not a JuriNex memory export.', problems: [] },
        };
      }
      try {
        const report = await memoryApi.importCase(folderName, payload, replace);
        await reload();
        return { ok: true, report };
      } catch (err) {
        return { ok: false, error: describeMemoryError(err, 'Could not import that file.') };
      }
    },
    [folderName, reload],
  );

  const seed = useCallback(async () => {
    try {
      const report = await memoryApi.seedCase(folderName);
      await reload();
      return { ok: true, report };
    } catch (err) {
      return { ok: false, error: describeMemoryError(err, 'Could not fill memory from the case details.') };
    }
  }, [folderName, reload]);

  return {
    overview,
    sections,
    proposals,
    loading,
    autoSeeding,
    error,
    reload,
    loadSection,
    addLine,
    editLine,
    deleteLine,
    clearSection,
    forgetAll,
    resolveProposal,
    updateCaseSettings,
    exportMemory,
    importMemory,
    seed,
  };
}
