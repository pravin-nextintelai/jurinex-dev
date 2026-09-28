/**
 * Shared vocabulary for the memory UI: the Settings page pane and the case panel.
 *
 * Section ids, tag ids and settings flags mirror the backend
 * (Backend/agentic-document-service/app/services/memory/schemas.py); the labels
 * are what advocates see.
 */

export const MEMORY_SETTINGS_EVENT = 'jurinex:memory-settings-updated';

/** Fired by the case chat once an answer is delivered: `{ folderName, chatId }`. */
export const CASE_CHAT_DONE_EVENT = 'jurinex:case-chat-done';

/** Let the case page find out what memory did after this answer (see useMemoryTurnWatcher). */
export function announceChatTurn(folderName, chatId) {
  if (!folderName || !chatId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CASE_CHAT_DONE_EVENT, { detail: { folderName, chatId } }));
}

export const DEFAULT_MEMORY_SETTINGS = Object.freeze({
  enabled: true,
  write_enabled: true,
  recall_enabled: true,
  instructions_enabled: true,
  sensitive_enabled: true,
  advocate_enabled: true,
});

export const MEMORY_MASTER_TOGGLE = Object.freeze({
  flag: 'enabled',
  label: 'Memory',
  description:
    "Use what JuriNex knows about you, your standing instructions, each case's instructions and what it remembers about a case when it answers.",
});

export const MEMORY_TOGGLES = Object.freeze([
  {
    flag: 'recall_enabled',
    label: 'Search and reference past chats',
    description: 'Allow JuriNex to look up relevant details from earlier chats in the same case.',
  },
  {
    flag: 'write_enabled',
    label: 'Generate memory from chats',
    description: 'Allow JuriNex to remember durable case facts you state while you work.',
  },
  {
    flag: 'instructions_enabled',
    label: 'Apply case instructions',
    description: 'Use the standing instructions you write for each case when answering.',
  },
  {
    flag: 'sensitive_enabled',
    label: 'Include sensitive details in memory',
    description: 'Allow health, financial and family details that are part of a case to be remembered.',
  },
  {
    flag: 'advocate_enabled',
    label: 'Remember me across cases',
    description:
      'Let JuriNex remember what you tell it about your practice, clients and way of working, and use it in every case.',
  },
]);

/** What JuriNex remembers about the advocate, by category. Ids mirror schemas.ADVOCATE_CATEGORIES. */
export const ADVOCATE_CATEGORIES = Object.freeze([
  { id: 'practice', label: 'Practice', description: 'Courts, areas of law and your role', example: 'Mostly appears before the Aurangabad Bench in land matters' },
  { id: 'clients', label: 'Clients', description: 'The kind of clients you act for', example: 'Usually acts for borrowers, not banks' },
  { id: 'work_style', label: 'How you work', description: 'Your team and way of working', example: 'Juniors prepare the first draft' },
  { id: 'background', label: 'Background', description: 'Languages, experience and team', example: 'Twelve years at the bar; works in English and Marathi' },
]);
export const ADVOCATE_MAX_LINES = 40;

export const MEMORY_SECTIONS = Object.freeze([
  { id: 'summary', label: 'Summary', description: 'Parties, stage, last action and open items' },
  { id: 'facts', label: 'Facts', description: 'The chronology and fact pattern' },
  { id: 'parties', label: 'Parties', description: 'People and entities in the matter' },
  { id: 'documents', label: 'Documents', description: 'Processed documents and what each one is' },
  { id: 'drafting_log', label: 'Drafting log', description: 'Drafts produced and the feedback on them' },
  { id: 'decisions', label: 'Decisions', description: 'Strategy choices you have made' },
  { id: 'dates', label: 'Dates', description: 'Hearings, limitation and deadlines' },
]);

export const TAG_STYLES = Object.freeze({
  stated: { label: 'Stated', hint: 'You said or confirmed this', className: 'bg-teal-50 text-teal-700' },
  extracted: { label: 'Document', hint: 'Taken from an uploaded document', className: 'bg-blue-50 text-blue-600' },
  status: { label: 'Status', hint: 'Recorded by JuriNex about the work', className: 'bg-gray-100 text-gray-600' },
});

export const PREFERENCES_MAX_WORDS = 300;
export const INSTRUCTIONS_MAX_CHARS = 4000;
export const LINE_MAX_CHARS = 300;
export const INSTRUCTION_MAX_CHARS = 400;

/** Where an instruction item came from, in words an advocate recognises. */
export const INSTRUCTION_ORIGINS = Object.freeze({
  user: { label: 'Added by you', hint: 'You typed this' },
  chat: { label: 'From chat', hint: 'You gave this instruction in chat and JuriNex saved it' },
  learned: { label: 'Suggested', hint: 'JuriNex suggested this and you accepted it' },
  import: { label: 'Imported', hint: 'Came in with an imported memory file' },
  migrated: { label: 'From your earlier text', hint: 'Moved across from the old instructions box' },
});

export function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Where a memory line came from, in words an advocate recognises. */
export function describeSource(line) {
  const ref = line?.source_ref || {};
  if (ref.document) return `${ref.document}${ref.page ? ` p.${ref.page}` : ''}`;
  switch (ref.kind) {
    case 'chat':
      return ref.folder_name ? `From a chat in ${String(ref.folder_name).replace(/_+/g, ' ').trim()}` : 'From a chat';
    case 'user':
      return 'Added by you';
    case 'import':
      return 'Imported';
    case 'seed':
      return String(ref.source || '').startsWith('cases_row') ? 'From case details' : 'From case records';
    case 'review':
      return 'From reviewing your chat';
    case 'pattern':
      return 'Noticed across your messages';
    default:
      return '';
  }
}

/**
 * How much work a remembered fact is doing: how many answers have carried it.
 *
 * Only facts JuriNex remembers about you are counted, so this is empty for a case
 * memory line. A fact that has never been used is the first one to drop when room
 * runs out, so it is worth seeing before deciding what to remove.
 */
export function describeUse(line) {
  const count = Number(line?.used_count);
  if (!Number.isFinite(count) || typeof line?.used_count === 'undefined' || line?.used_count === null) return '';
  if (count <= 0) return 'not used yet';
  return count === 1 ? 'used in 1 answer' : `used in ${count} answers`;
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const quoted = (text, max = 80) => {
  const clean = String(text || '').trim();
  return `“${clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean}”`;
};

/**
 * One sentence on what memory did after a chat turn, from
 * GET /api/memory/cases/{folder}/turns/{chatId}. Empty when nothing changed.
 */
export function describeTurnActivity(turn) {
  if (!turn?.ready) return '';
  const instructions = Array.isArray(turn.instructions) ? turn.instructions : [];
  const lines = Array.isArray(turn.lines) ? turn.lines : [];
  const suggestions = Array.isArray(turn.suggestions) ? turn.suggestions : [];
  const aboutYou = Array.isArray(turn.advocate) ? turn.advocate : [];
  const evicted = Array.isArray(turn.advocate_evicted) ? turn.advocate_evicted : [];
  const seeded = (Number(turn.seeded?.added) || 0) + (Number(turn.seeded?.updated) || 0);

  const parts = [];
  if (aboutYou.length === 1) {
    parts.push(`remembered about you for every case: ${quoted(aboutYou[0].text)}`);
  } else if (aboutYou.length > 1) {
    parts.push(`remembered ${plural(aboutYou.length, 'thing')} about you for every case`);
  }
  // Overlapping facts were folded together so memory could keep growing.
  const tidied = (Array.isArray(turn.advocate_consolidated) ? turn.advocate_consolidated : [])[0];
  if (tidied?.changed) {
    parts.push(
      `tidied what it knows about you, ${tidied.lines_before} facts into ${tidied.lines_after} (Settings → Memory to undo)`,
    );
  }
  // Space was made by dropping something learned earlier that never got used.
  if (evicted.length === 1) {
    parts.push(`made room by forgetting one thing it had never used: ${quoted(evicted[0].text)}`);
  } else if (evicted.length > 1) {
    parts.push(`made room by forgetting ${plural(evicted.length, 'unused thing')} it had learned`);
  }
  const caseRules = instructions.filter((item) => item.scope !== 'user');
  const universalRules = instructions.filter((item) => item.scope === 'user');
  if (caseRules.length === 1) {
    parts.push(`saved to this case's instructions: ${quoted(caseRules[0].text)}`);
  } else if (caseRules.length > 1) {
    parts.push(`saved ${plural(caseRules.length, 'instruction')} to this case`);
  }
  if (universalRules.length === 1) {
    parts.push(`saved to your standing instructions for every case: ${quoted(universalRules[0].text)}`);
  } else if (universalRules.length > 1) {
    parts.push(`saved ${plural(universalRules.length, 'standing instruction')} for every case`);
  }
  if (lines.length) parts.push(`remembered ${plural(lines.length, 'new detail')}`);
  if (seeded) parts.push(`filled in ${plural(seeded, 'line')} from the case details`);
  const universalSuggestions = suggestions.filter((item) => item.scope === 'user').length;
  const caseSuggestions = suggestions.length - universalSuggestions;
  if (caseSuggestions) parts.push(`has ${plural(caseSuggestions, 'suggestion')} for this case`);
  if (universalSuggestions) {
    parts.push(
      `noticed you ask for this in more than one case and suggests it for all your cases (Settings → Memory)`,
    );
  }
  return parts.length ? `JuriNex ${parts.join('; ')}.` : '';
}

/** The memory panel tab that shows what a turn changed. */
export function turnActivityTab(turn) {
  if (turn?.instructions?.length) return 'instructions';
  if (turn?.suggestions?.length) return 'suggestions';
  return 'memory';
}
