import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Building2, Check, ChevronRight, Lightbulb, RefreshCw, X } from 'lucide-react';
import useMemorySettings from '../../hooks/useMemorySettings';
import useInstructions from '../../hooks/useInstructions';
import useAdvocateMemory from '../../hooks/useAdvocateMemory';
import AdvocateMemoryList from './AdvocateMemoryList';
import memoryApi, { describeMemoryError } from '../../services/memoryApi';
import {
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_MASTER_TOGGLE,
  MEMORY_TOGGLES,
  formatDate,
  plural,
} from '../../utils/memoryLabels';
import MemoryToggle from './MemoryToggle';
import MemoryNotice from './MemoryNotice';
import InstructionList from './InstructionList';
import SuggestionCard from './SuggestionCard';

const labelFor = (flag) =>
  flag === 'enabled' ? MEMORY_MASTER_TOGGLE.label : MEMORY_TOGGLES.find((item) => item.flag === flag)?.label || 'Memory';

const FIRM_OFF_HINT = 'Turned off for your whole firm by a firm admin.';

const UNIVERSAL_PLACEHOLDER = 'e.g. English for court drafts; Marathi for client-facing summaries.';

/** Firm-wide switches, shown to firm admins only. Off here means off for everyone. */
const FirmMemorySettings = ({ onChanged }) => {
  const [values, setValues] = useState(null);
  const [error, setError] = useState(null);
  const [pendingFlag, setPendingFlag] = useState(null);

  useEffect(() => {
    let alive = true;
    memoryApi
      .getSettings('firm')
      .then((data) => {
        if (alive) setValues({ ...DEFAULT_MEMORY_SETTINGS, ...(data?.settings || {}) });
      })
      .catch((err) => {
        if (alive) setError(describeMemoryError(err, "Could not load your firm's memory settings."));
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = async (flag, value) => {
    const previous = values;
    setValues({ ...values, [flag]: value });
    setPendingFlag(flag);
    try {
      const data = await memoryApi.updateSettings({ [flag]: value }, 'firm');
      setValues({ ...DEFAULT_MEMORY_SETTINGS, ...(data?.settings || {}) });
      toast.success(`${labelFor(flag)} turned ${value ? 'on' : 'off'} for your firm`);
      onChanged?.();
    } catch (err) {
      setValues(previous);
      toast.error(describeMemoryError(err, "Could not save your firm's memory settings.").message);
    } finally {
      setPendingFlag(null);
    }
  };

  return (
    <div className="mt-6 pt-5 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Your firm</h3>
      </div>
      <p className="text-sm text-gray-500">
        These apply to everyone in your firm. A setting turned off here stays off for every advocate and every case.
      </p>
      {error && (
        <div className="mt-3">
          <MemoryNotice tone="error">{error.message}</MemoryNotice>
        </div>
      )}
      {!error && !values && <p className="text-sm text-gray-400 mt-3">Loading…</p>}
      {values && (
        <div className="divide-y divide-gray-100">
          <MemoryToggle
            label={MEMORY_MASTER_TOGGLE.label}
            description="Allow memory anywhere in the firm."
            checked={values.enabled}
            busy={pendingFlag === 'enabled'}
            onChange={(value) => handleToggle('enabled', value)}
          />
          {MEMORY_TOGGLES.map((item) => (
            <MemoryToggle
              key={item.flag}
              label={item.label}
              description={item.description}
              checked={values[item.flag]}
              busy={pendingFlag === item.flag}
              disabled={!values.enabled}
              onChange={(value) => handleToggle(item.flag, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Rules JuriNex noticed the advocate asking for in more than one case. Nothing
 * changes until one is accepted; accepting makes it a standing instruction.
 */
const isAboutYou = (suggestion) => suggestion?.source_ref?.target === 'advocate';

/** Where a cross-case suggestion came from, in a few words. */
const suggestionOrigin = (suggestion) => {
  const ref = suggestion?.source_ref || {};
  if (isAboutYou(suggestion)) {
    return ref.total ? `Counted from your cases: ${ref.count} of ${ref.total}` : 'Counted from your cases';
  }
  const from = Array.isArray(ref.learned_from) ? ref.learned_from : [];
  if (ref.kind === 'cross_case') return `Kept as a rule in ${plural(from.length, 'case')}`;
  return from.length ? `Seen in ${plural(from.length + 1, 'case')}` : 'Seen in more than one case';
};

const LearnedSuggestions = ({ onAccepted, onAboutYouAccepted }) => {
  const [suggestions, setSuggestions] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await memoryApi.listUserSuggestions();
      setSuggestions(Array.isArray(data?.proposals) ? data.proposals : []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lookAcrossCases = async () => {
    setLooking(true);
    setNotice(null);
    try {
      const data = await memoryApi.learnAcrossCases();
      setSuggestions(Array.isArray(data?.proposals) ? data.proposals : []);
      const found = (data?.practice_suggested?.length || 0) + (data?.rules_suggested?.length || 0);
      if (data?.skipped_reason === 'disabled_by_user') {
        setNotice({ tone: 'warning', message: 'Generating memory is switched off, so nothing was looked at.' });
      } else if (found) {
        setNotice({ tone: 'success', message: `Found ${plural(found, 'new suggestion')} below. Nothing is saved until you add it.` });
      } else {
        setNotice({
          tone: 'info',
          message: 'Nothing new. JuriNex needs at least 3 cases that share something, or the same rule kept in 2 cases.',
        });
      }
    } catch (err) {
      setNotice({ tone: 'error', error: describeMemoryError(err, "Couldn't look across your cases right now.") });
    } finally {
      setLooking(false);
    }
  };

  const resolve = async (suggestion, decision, text) => {
    setBusyId(suggestion.id);
    setNotice(null);
    try {
      await memoryApi.resolveUserSuggestion(suggestion.id, decision, text);
      await load();
      if (decision === 'accept') {
        if (isAboutYou(suggestion)) {
          setNotice({ tone: 'success', message: 'Added to what JuriNex knows about you.' });
          onAboutYouAccepted?.();
        } else {
          setNotice({ tone: 'success', message: 'Added to your standing instructions.' });
          onAccepted?.();
        }
      }
      return { ok: true };
    } catch (err) {
      const error = describeMemoryError(err, 'Could not update that suggestion.');
      if (decision !== 'accept') setNotice({ tone: 'error', error });
      return { ok: false, error };
    } finally {
      setBusyId(null);
    }
  };

  const list = suggestions || [];

  return (
    <div className="mt-2 mb-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
          <h4 className="text-xs font-bold text-gray-800">Noticed across your cases</h4>
        </div>
        <button
          type="button"
          onClick={lookAcrossCases}
          disabled={looking}
          title="Suggest what your cases show about your practice, and rules you keep in more than one case"
          className="flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50"
          style={{ color: '#21C1B6' }}
        >
          <RefreshCw className={`w-3 h-3 ${looking ? 'animate-spin' : ''}`} />
          {looking ? 'Looking…' : 'Look across my cases'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-2">
        What your cases show about your practice, and rules you asked for in more than one case. JuriNex looks once a
        day; nothing is saved until you add it.
      </p>
      {notice && (
        <div className="mb-2">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}
      {list.length === 0 && !notice && <p className="text-[11px] text-gray-400">Nothing to suggest yet.</p>}
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((suggestion) => {
            const aboutYou = isAboutYou(suggestion);
            return (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                scope="user"
                busy={busyId === suggestion.id}
                polishable={!aboutYou}
                acceptLabel={aboutYou ? 'Add to what JuriNex knows about you' : 'Apply everywhere'}
                onAccept={(text) => resolve(suggestion, 'accept', text)}
                onDismiss={() => resolve(suggestion, 'reject')}
              >
                <span className="text-[10px] text-gray-400 block mb-1">
                  {aboutYou ? 'About you · ' : ''}
                  {suggestionOrigin(suggestion)}
                  {suggestion.created_at ? ` · ${formatDate(suggestion.created_at)}` : ''}
                </span>
              </SuggestionCard>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * Settings → Memory. The advocate's switches, a firm block for firm admins, and
 * a "You" block: standing instructions that apply in every case, rules JuriNex
 * noticed across cases, and the professional profile.
 */
const MemorySettingsPane = ({ accountType, onOpenProfile }) => {
  const { settings, effective, loading, error, update, refresh } = useMemorySettings();
  const [pendingFlag, setPendingFlag] = useState(null);
  const universal = useInstructions('user', { enabled: !loading });
  const aboutYou = useAdvocateMemory({ enabled: !loading });
  const isFirmAdmin = String(accountType || '').toUpperCase() === 'FIRM_ADMIN';

  const handleToggle = async (flag, value) => {
    setPendingFlag(flag);
    const result = await update({ [flag]: value });
    setPendingFlag(null);
    if (result.ok) toast.success(`${labelFor(flag)} turned ${value ? 'on' : 'off'}`);
    else toast.error(result.error?.message || 'Could not save your memory settings.');
  };

  // The effective value is the firm's AND the advocate's; on here but off there means the firm said no.
  const firmHint = (flag) => (settings[flag] && !effective[flag] ? FIRM_OFF_HINT : null);

  return (
    <div>
      <p className="text-sm text-gray-500">
        JuriNex keeps what it learns about each case inside that case, and what you tell it about yourself with you, for
        every case. These settings control what it remembers and what it uses when it answers.
      </p>

      {error && (
        <div className="mt-3">
          <MemoryNotice tone="error">{error.message}</MemoryNotice>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-4">Loading memory settings…</p>
      ) : (
        <div className="divide-y divide-gray-100 mt-2">
          <MemoryToggle
            label={MEMORY_MASTER_TOGGLE.label}
            description={MEMORY_MASTER_TOGGLE.description}
            checked={settings.enabled}
            busy={pendingFlag === 'enabled'}
            hint={firmHint('enabled')}
            onChange={(value) => handleToggle('enabled', value)}
          />
          {MEMORY_TOGGLES.map((item) => (
            <MemoryToggle
              key={item.flag}
              label={item.label}
              description={item.description}
              checked={settings[item.flag]}
              busy={pendingFlag === item.flag}
              disabled={!settings.enabled}
              hint={firmHint(item.flag)}
              onChange={(value) => handleToggle(item.flag, value)}
            />
          ))}
        </div>
      )}

      {isFirmAdmin && <FirmMemorySettings onChanged={refresh} />}

      <div className="mt-6 pt-5 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">You</h3>
        <p className="text-sm text-gray-500 mb-4">
          Standing instructions load into every chat in every case, so keep them about how you work: language, style,
          citation habits, things to avoid. Anything about one matter belongs in that case&apos;s instructions.
        </p>

        <AdvocateMemoryList
          memory={aboutYou}
          switchedOff={!loading && (!effective.enabled || !effective.advocate_enabled)}
        />

        <InstructionList
          instructions={universal}
          title="Standing instructions"
          intro="Apply in every case. Switch one off to keep it without using it; inside a case, you can switch one off for that case only."
          placeholder={UNIVERSAL_PLACEHOLDER}
          emptyText="Nothing yet. Add one here. When you ask for the same thing “in all my cases” more than once in chat, JuriNex adds it for you."
        />

        <LearnedSuggestions onAccepted={universal.reload} onAboutYouAccepted={aboutYou.reload} />

        <div className="divide-y divide-gray-100 border-t border-gray-100">
          <div className="py-3 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900">Professional profile</div>
              <div className="text-sm text-gray-500">Your role, courts, practice areas and answer style</div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Open
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemorySettingsPane;
