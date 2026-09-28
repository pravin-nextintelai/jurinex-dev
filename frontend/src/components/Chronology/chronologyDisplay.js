/** Shared chronology display helpers (timeline + PDF/print). */

export function normalizeChronologyText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Day summary repeats event particulars when there is only one event — hide it. */
export function showDaySummary(node) {
  const events = Array.isArray(node?.events) ? node.events : [];
  const summary = String(node?.summary || '').trim();
  if (!summary || events.length <= 1) return false;
  const key = normalizeChronologyText(summary);
  return !events.some((event) => normalizeChronologyText(event.particulars) === key);
}

export function eventCite(event) {
  if (!event) return '';
  const parts = [];
  const page = String(event.sourcePage || '').trim();
  if (page) parts.push(`p. ${page}`);
  const exhibit = String(event.exhibit || '').trim();
  if (exhibit) {
    parts.push(/^exh/i.test(exhibit) ? exhibit : `Exh. ${exhibit}`);
  }
  if (event.forum) parts.push(String(event.forum).trim());
  if (event.caseNumber) parts.push(String(event.caseNumber).trim());
  return parts.filter(Boolean).join(' · ');
}

const ROLE_LABELS = {
  petitioner: "Petitioner's case",
  respondent: "Respondent's case",
  court: 'Court order',
  official: 'Official record',
  impugned: 'Impugned / challenged',
  admitted: 'Admitted',
  disputed: 'Disputed',
};

const PHASE_LABELS = {
  pre_litigation: 'Pre-litigation',
  correspondence: 'Correspondence',
  institution: 'Institution',
  pending: 'Pending litigation',
  pleadings: 'Pleadings',
  interim: 'Interim',
  evidence: 'Evidence',
  listing: 'Listing / stand-over',
  hearing: 'Hearings',
  order: 'Orders / Judgment',
  appeal: 'Appeal / Writ',
  execution: 'Execution',
  other: 'Other',
};

export function phaseLabel(phase) {
  const key = String(phase || '').trim().toLowerCase();
  if (!key) return '';
  return PHASE_LABELS[key] || key.replace(/_/g, ' ');
}

export function roleLabel(role) {
  return ROLE_LABELS[String(role || '').trim().toLowerCase()] || '';
}
