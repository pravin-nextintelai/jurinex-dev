import React, { useRef, useState } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import { plural } from '../../utils/memoryLabels';

const primaryButton =
  'mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';

/** Export, import, and refreshing memory from what the case records already show. */
const MemoryTransferTab = ({ memory, caseTitle }) => {
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const handleExport = async () => {
    setBusy('export');
    setNotice(null);
    const result = await memory.exportMemory(caseTitle);
    setBusy(null);
    setNotice(
      result.ok ? { tone: 'success', message: 'Memory file downloaded.' } : { tone: 'error', error: result.error },
    );
  };

  const handleImport = async () => {
    if (!file) return;
    if (
      replace &&
      !window.confirm(
        "Replace this case's memory, instructions and case settings with this file? What is there now will be deleted.",
      )
    ) {
      return;
    }
    setBusy('import');
    setNotice(null);
    const result = await memory.importMemory(file, replace);
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: 'error', error: result.error });
      return;
    }
    const report = result.report || {};
    const refused = Array.isArray(report.rejected) ? report.rejected : [];
    const parts = [`${plural(report.lines_written || 0, 'line')} added`];
    if (report.duplicates_skipped) parts.push(`${report.duplicates_skipped} already known`);
    if (refused.length) parts.push(`${refused.length} refused`);
    if (report.instructions_imported) parts.push('instructions imported');
    setNotice({
      tone: refused.length ? 'warning' : 'success',
      message: `Import finished: ${parts.join(', ')}.`,
      problems: refused.slice(0, 5).map((item, index) => ({
        code: `${item.code || 'refused'}-${index}`,
        message: `${item.section || 'memory'}: ${item.message}`,
      })),
    });
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const handleSeed = async () => {
    setBusy('seed');
    setNotice(null);
    const result = await memory.seed();
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: 'error', error: result.error });
      return;
    }
    const { added = 0, updated = 0, skipped_reason: reason } = result.report || {};
    if (reason === 'disabled_by_user') {
      setNotice({ tone: 'warning', message: 'Memory generation is turned off, so nothing was added.' });
    } else if (!added && !updated) {
      setNotice({ tone: 'info', message: 'Nothing new to add from the case records.' });
    } else {
      setNotice({
        tone: 'success',
        message: `Added ${plural(added, 'line')} and updated ${plural(updated, 'line')} from the case records.`,
      });
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <MemoryNotice tone={notice.tone} problems={notice.problems || notice.error?.problems || []}>
          {notice.message || notice.error?.message}
        </MemoryNotice>
      )}

      <section className="rounded-xl border border-gray-100 p-4">
        <h3 className="text-xs font-bold text-gray-800">Export</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Download this case&apos;s memory, instructions and case settings as a file. The audit log and pending
          suggestions are not included.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy !== null}
          className={primaryButton}
          style={{ background: '#21C1B6' }}
        >
          <Download className="w-3.5 h-3.5" />
          {busy === 'export' ? 'Preparing…' : 'Download memory file'}
        </button>
      </section>

      <section className="rounded-xl border border-gray-100 p-4">
        <h3 className="text-xs font-bold text-gray-800">Import</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Load a memory file exported from JuriNex. Every line is checked again, and a fact taken from a document is kept
          only if this case has that document.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="mt-3 block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
        />
        <fieldset className="mt-3 space-y-1.5">
          <legend className="sr-only">Import mode</legend>
          <label className="flex items-start gap-2 text-[11px] text-gray-600">
            <input
              type="radio"
              name="memory-import-mode"
              checked={!replace}
              onChange={() => setReplace(false)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-gray-700">Add to this case&apos;s memory.</span> Lines the case
              already has are skipped, and existing instructions are kept.
            </span>
          </label>
          <label className="flex items-start gap-2 text-[11px] text-gray-600">
            <input
              type="radio"
              name="memory-import-mode"
              checked={replace}
              onChange={() => setReplace(true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-gray-700">Replace this case&apos;s memory.</span> Memory,
              instructions and case settings are swapped for the file&apos;s.
            </span>
          </label>
        </fieldset>
        <button
          type="button"
          onClick={handleImport}
          disabled={!file || busy !== null}
          className={primaryButton}
          style={{ background: '#21C1B6' }}
        >
          <Upload className="w-3.5 h-3.5" />
          {busy === 'import' ? 'Importing…' : 'Import file'}
        </button>
      </section>

      <section className="rounded-xl border border-gray-100 p-4">
        <h3 className="text-xs font-bold text-gray-800">Update from case records</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Add anything new from the case details, the chronology and the uploaded documents. Nothing is duplicated, and
          lines you wrote are never changed.
        </p>
        <button
          type="button"
          onClick={handleSeed}
          disabled={busy !== null}
          className={primaryButton}
          style={{ background: '#21C1B6' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'seed' ? 'animate-spin' : ''}`} />
          {busy === 'seed' ? 'Updating…' : 'Update from case records'}
        </button>
      </section>
    </div>
  );
};

export default MemoryTransferTab;
