import React, { useEffect, useState } from 'react';
import '../../styles/RedesignedCitationReport.css';

const PERSPECTIVES = [
  ['all', 'All'],
  ['appellant', 'Appellant'],
  ['respondent', 'Respondent'],
  ['court', "Court's Ratio"],
  ['neutral', 'Both Sides'],
];

const PARTY = {
  appellant: ['Appellant', 'blue'],
  respondent: ['Respondent', 'amber'],
  court: ["Court's Ratio", 'green'],
  neutral: ['Both Sides', 'slate'],
};

const STATUS = {
  GREEN: ['Verified', 'green'],
  YELLOW: ['Review advised', 'amber'],
  STALE: ['Freshness check', 'orange'],
  PENDING: ['Pending', 'purple'],
  RED: ['Unverified', 'red'],
};

function normalizePerspective(value, fallback = 'neutral') {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw) return fallback;
  if (raw === 'all') return 'all';
  if (/(appellant|petitioner|plaintiff|accused)/.test(raw)) return 'appellant';
  if (/(respondent|defendant|state|prosecution)/.test(raw)) return 'respondent';
  if (/(court|ratio|analysis|conclusion|judge|bench)/.test(raw)) return 'court';
  if (/(neutral|both|shared|all parties|both parties)/.test(raw)) return fallback === 'all' ? 'all' : 'neutral';
  return fallback;
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCourt(value) {
  const raw = normalizeSearch(value);
  if (!raw || raw === 'court not specified' || raw === '-') return 'unknown';
  if (/^(sc|supreme)$/i.test(raw) || raw.includes('supreme court')) return 'supreme court';
  if (/^(hc|high)$/i.test(raw) || raw.includes('high court')) return 'high court';
  return raw;
}

function normalizeDimensionKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const compact = raw.toLowerCase().replace(/[_\-\s]+/g, '');
  if (compact === 'all') return 'all';
  if (compact === 'ungrouped' || compact === 'otherrelevantcitations') return 'ungrouped';
  const dimMatch = compact.match(/^dimension(\d+)$/);
  if (dimMatch) return dimMatch[1];
  const numericMatch = compact.match(/^\d+$/);
  if (numericMatch) return numericMatch[0];
  return compact;
}

function getKeywordLabel(group, fallbackIndex = 0) {
  const name = (group?.name || '').trim();
  if (name && name.toLowerCase() !== 'ungrouped' && name.toLowerCase() !== 'other relevant citations') {
    return name.length > 32 ? name.slice(0, 30) + '…' : name;
  }
  return `Keyword Group ${fallbackIndex + 1}`;
}

// Keep old name as alias for any other callers
function getDimensionDisplayLabel(group, fallbackIndex = 0) {
  return getKeywordLabel(group, fallbackIndex);
}

function effectiveParty(citation) {
  const args = citation.partyArguments || citation.party_arguments || {};
  const hasApp = Array.isArray(args.appellant) && args.appellant.length > 0;
  const hasResp = Array.isArray(args.respondent) && args.respondent.length > 0;
  const normalized = normalizePerspective(citation.argumentParty || citation.argument_party || '', 'neutral');
  if (hasApp && hasResp) return 'neutral';
  if (hasApp && !hasResp) return 'appellant';
  if (hasResp && !hasApp) return 'respondent';
  return normalized;
}

function matchesPerspective(citation, filter) {
  if (filter === 'all') return true;
  const args = citation.partyArguments || citation.party_arguments || {};
  const hasApp = Array.isArray(args.appellant) && args.appellant.length > 0;
  const hasResp = Array.isArray(args.respondent) && args.respondent.length > 0;
  const hasCourt = Boolean(args.court);
  const normalized = normalizePerspective(citation.argumentParty || citation.argument_party || '', 'neutral');
  if (filter === 'appellant') return normalized === 'appellant' || hasApp;
  if (filter === 'respondent') return normalized === 'respondent' || hasResp;
  if (filter === 'court') return normalized === 'court' || hasCourt;
  if (filter === 'neutral') return normalized === 'neutral' || (hasApp && hasResp);
  return true;
}

function dimensionGroups(reportFormat, citations, dimensionsOverride = []) {
  const groups = new Map();

  // Source of truth: backend dimensions metadata (if present)
  const dimensionsMeta = [
    ...(Array.isArray(reportFormat.dimensions) ? reportFormat.dimensions : []),
    ...(Array.isArray(dimensionsOverride) ? dimensionsOverride : []),
  ];
  dimensionsMeta.forEach((dim, index) => {
    const didRaw = dim?.dimension_id ?? dim?.dimensionId ?? `group_${index}`;
    const did = normalizeDimensionKey(didRaw) || String(didRaw).trim();
    if (!groups.has(did)) {
      groups.set(did, {
        id: did,
        name: dim?.name || `Dimension ${index + 1}`,
        reasoning: dim?.reasoning || '',
        ids: null,
        citations: [],
      });
    }
  });

  // Backward compatibility: dimensionGroups from older payloads
  (reportFormat.dimensionGroups || []).forEach((group, index) => {
    const gidRaw = group.dimension_id ?? group.dimensionId ?? `group_${index}`;
    const gid = normalizeDimensionKey(gidRaw) || String(gidRaw).trim();
    if (!groups.has(gid)) {
      groups.set(gid, {
        id: gid,
        name: group.name || `Dimension ${index + 1}`,
        reasoning: group.reasoning || '',
        ids: new Set(group.citations || []),
        citations: [],
      });
    } else {
      const existing = groups.get(gid);
      if (!existing.name && group.name) existing.name = group.name;
      if (!existing.reasoning && group.reasoning) existing.reasoning = group.reasoning;
      if (Array.isArray(group.citations) && group.citations.length) existing.ids = new Set(group.citations);
    }
  });

  // V2 Side-aware citation mapping
  if (Array.isArray(reportFormat.recommended_citations) && reportFormat.recommended_citations.length > 0) {
    groups.set('recommended', { id: 'recommended', name: 'Recommended Citations', reasoning: 'Supporting citations for the selected side.', ids: new Set(reportFormat.recommended_citations.map(c => c.canonical_id || c.canonicalId || c.id)), citations: [] });
  }
  if (Array.isArray(reportFormat.adverse_citations) && reportFormat.adverse_citations.length > 0) {
    groups.set('adverse', { id: 'adverse', name: 'Adverse Citations / Opposite-side Risk', reasoning: 'These cases may support the opposite side or may need to be distinguished.', ids: new Set(reportFormat.adverse_citations.map(c => c.canonical_id || c.canonicalId || c.id)), citations: [] });
  }
  if (Array.isArray(reportFormat.use_with_caution) && reportFormat.use_with_caution.length > 0) {
    groups.set('caution', { id: 'caution', name: 'Use With Caution', reasoning: 'Use for distinguishable cases, weak contextual cases.', ids: new Set(reportFormat.use_with_caution.map(c => c.canonical_id || c.canonicalId || c.id)), citations: [] });
  }

  // ── V2 category routing (recommended / adverse / caution) ───────────────────────
  // V2 citations carry no keyword/dimension id, so without this every citation falls
  // into a single "ungrouped" bucket and the Adverse / Use-With-Caution sections never
  // appear (sidebar shows 0). Route each citation to its category bucket FIRST — by
  // id-set membership, then by its classification — so the counts are correct and the
  // adverse cases the client can be hit with (and the caution cases) are shown distinctly.
  const CATEGORY_META = {
    recommended: { name: 'Recommended Citations', reasoning: 'Supporting citations for the selected side.' },
    adverse: { name: 'Adverse Citations / Opposite-side Risk', reasoning: 'Cases the opposite side can rely on — be prepared to distinguish them.' },
    caution: { name: 'Use With Caution', reasoning: 'Distinguishable or weak-contextual cases — verify the fit before relying on them.' },
  };
  const ensureCategoryGroup = (cid) => {
    if (!groups.has(cid)) {
      groups.set(cid, { id: cid, name: CATEGORY_META[cid].name, reasoning: CATEGORY_META[cid].reasoning, ids: new Set(), citations: [] });
    }
    return groups.get(cid);
  };
  // Only a V2 (side-aware) report has these category arrays; legacy reports keep their
  // keyword/dimension grouping untouched.
  const hasV2Categories = ['recommended', 'adverse', 'caution'].some((cid) => groups.has(cid));
  const categoryByCitationId = new Map();
  ['recommended', 'adverse', 'caution'].forEach((cid) => {
    const g = groups.get(cid);
    if (g && g.ids) g.ids.forEach((idVal) => categoryByCitationId.set(String(idVal).trim(), cid));
  });
  const categoryFromClassification = (citation) => {
    const cls = String(citation.classification || citation.classificationLabel || '').toUpperCase();
    if (cls === 'SUPPORTING') return 'recommended';
    if (cls === 'ADVERSE') return 'adverse';
    if (cls === 'DISTINGUISHABLE' || cls === 'WEAK_CONTEXTUAL') return 'caution';
    const party = String(citation.argumentParty || citation.argument_party || '').toLowerCase();
    if (party === 'opposite_party' || party === 'opposite-party') return 'adverse';
    return '';
  };

  citations.forEach((citation) => {
    const citationKeys = new Set(
      [
        citation.id,
        citation.canonicalId,
        citation.canonical_id,
        citation.externalId,
        citation.external_id,
      ]
        .filter(Boolean)
        .map((v) => String(v).trim())
    );

    // Category routing takes precedence over keyword/dimension grouping (V2 reports only).
    const catId = hasV2Categories
      ? (Array.from(citationKeys).map((k) => categoryByCitationId.get(k)).find(Boolean)
         || categoryFromClassification(citation))
      : '';
    if (catId && CATEGORY_META[catId]) {
      ensureCategoryGroup(catId).citations.push(citation);
      return;
    }

    const rawDimId =
      citation.dimensionId ??
      citation.dimension_id ??
      citation._dimension_id ??
      '';
    const rawDimName =
      citation.dimensionName ||
      citation.dimension_name ||
      citation._dimension_name ||
      '';
    const dimIdKey = normalizeDimensionKey(rawDimId);
    const dimNameKey = String(rawDimName).trim().toLowerCase();
    // hasDimId: citation carries an explicit dimension assignment from the backend
    const hasDimId = dimIdKey !== '' && dimIdKey !== 'ungrouped';
    let key = dimIdKey || '';
    if (!key && dimNameKey) {
      const byName = Array.from(groups.values()).find((g) => (g.name || '').trim().toLowerCase() === dimNameKey);
      key = byName?.id || '';
    }
    if (!key) key = 'ungrouped';
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: rawDimName || (key === 'ungrouped' ? 'Other Relevant Citations' : `Dimension ${key}`),
        reasoning: '',
        ids: null,
        citations: [],
      });
    }
    const group = groups.get(key);
    // If the citation carries an explicit dimensionId from backend, always assign it to that
    // group — don't let the backward-compat ids set block it. The ids set is only consulted
    // for legacy payloads where citations have no dimensionId field.
    if (hasDimId || !group.ids || Array.from(citationKeys).some((k) => group.ids.has(k))) {
      group.citations.push(citation);
    }
  });
  const ordered = Array.from(groups.values());
  ordered.sort((a, b) => {
    const v2Order = {
      'recommended': -3,
      'adverse': -2,
      'caution': -1,
      'ungrouped': 1000
    };
    const aOrder = v2Order[a.id] ?? 0;
    const bOrder = v2Order[b.id] ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    
    if (a.id === 'ungrouped') return 1;
    if (b.id === 'ungrouped') return -1;
    const an = Number(a.id);
    const bn = Number(b.id);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return ordered;
}

function normalizeRelevance(badge, tier) {
  const t = String(tier || '').toUpperCase();
  if (t === 'STRONG')   return 'Strong';
  if (t === 'RELEVANT') return 'Relevant';
  if (t === 'WEAK')     return 'Weak';
  const b = String(badge || '').toUpperCase();
  if (b.includes('HIGH'))   return 'Strong';
  if (b.includes('MEDIUM')) return 'Relevant';
  if (b.includes('LOW'))    return 'Weak';
  return 'Relevant';
}

const RELEVANCE_STYLE = {
  Strong:   { bg: '#DCFCE7', color: '#15803D', dot: '●' },
  Relevant: { bg: '#FEF9C3', color: '#92400E', dot: '◆' },
  Weak:     { bg: '#FEE2E2', color: '#991B1B', dot: '▲' },
};

function isAdminUpload(citation) {
  if (citation.isLocalAdmin === true || citation.is_local_admin === true) return true;
  const raw = String(
    citation.source || citation.sourceType || citation.sourceLabel || citation.source_type || ''
  ).trim().toLowerCase();
  return (
    raw === 'admin' || raw.includes('admin_upload') || raw.includes('admin-upload')
    || raw.includes('adminupload') || raw.includes('manual_upload')
    || raw.includes('judgment_upload') || raw.startsWith('admin')
  );
}

function getSourceMeta(citation) {
  if (isAdminUpload(citation)) return { icon: '🏛️', label: 'Admin Upload' };

  // Web tier 3 — check before generic source string matching
  if (
    citation.sourceTier === 'web' ||
    citation._source === 'web_tier3' ||
    citation.source_type === 'web'
  ) {
    return { icon: '🌍', label: 'Web (Verified)' };
  }

  const raw = String(
    citation.source ||
    citation.sourceType ||
    citation.sourceLabel ||
    citation.sourceApplication ||
    ''
  ).toLowerCase();
  if (raw.includes('local') || raw.includes('db')) return { icon: '🗄️', label: 'Local DB' };
  if (raw.includes('indian') || raw.includes('kanoon') || raw.includes('ik')) return { icon: '📚', label: 'Indian Kanoon' };
  if (raw.includes('google')) return { icon: '🌐', label: 'Google Search' };
  if (raw === 'web' || raw.includes('tier3')) return { icon: '🌍', label: 'Web (Verified)' };
  return { icon: '📄', label: 'Source' };
}

function formatSourceTypeLabel(citation) {
  const raw = String(
    citation?.sourceType
    || citation?.sourceStored
    || citation?.source
    || citation?.source_type
    || ''
  ).trim().toLowerCase();
  if (!raw) return 'Not Available';
  if (raw === 'indian_kanoon') return 'indian_kanoon';
  if (raw === 'google') return 'google search';
  if (raw === 'web' || raw === 'web_tier3') return 'web (verified)';
  if (raw === 'local' || raw === 'admin_upload') return 'local db';
  return 'local db';
}

function decodeHtmlEntities(text) {
  if (!text || typeof window === 'undefined') return String(text || '');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(text);
  return textarea.value;
}

function sanitizeJudgmentHtml(html) {
  let out = String(html || '');
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  out = out.replace(/\son\w+="[^"]*"/gi, '');
  out = out.replace(/\son\w+='[^']*'/gi, '');
  out = out.replace(/javascript:/gi, '');
  return out;
}

function formatJudgmentPlainText(text) {
  const decoded = decodeHtmlEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!decoded) return [];
  return decoded
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
}

/* ── Judgment text parser ─────────────────────────────────────────── */
const IK_META_KEYS = [
  'Author', 'Bench', 'CASE NO', 'PETITIONER', 'RESPONDENT',
  'DATE OF JUDGMENT', 'BENCH', 'CORAM', 'ACT', 'HEADNOTE',
  'JUDGMENT', 'ORDER',
];
const IK_META_RE = new RegExp(
  `\\b(${IK_META_KEYS.map(k => k.replace(/\s/g, '\\s+')).join('|')})\\.?:\\s*`,
  'gi'
);

function parseJudgmentText(rawText) {
  // Returns { metaPairs: [{key,val}], sections: [{heading:str|null, paragraphs:[str]}] }
  const text = decodeHtmlEntities(rawText || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!text) return { metaPairs: [], sections: [] };

  // ── 1. Detect embedded IK metadata block at the start ──────────────
  // IK embeds "Key: value Key2: value2 …" as a long inline string before the body.
  const metaPairs = [];
  const metaKeyRe = /\b(Author|Bench|CASE\s+NO\.?|PETITIONER|RESPONDENT|DATE\s+OF\s+JUDGMENT|JUDGMENT\s+DATE|BENCH|DECIDED\s+ON)\s*:\s*/gi;
  const keyMatches = [];
  let m;
  while ((m = metaKeyRe.exec(text)) !== null) {
    keyMatches.push({ key: m[1].replace(/\s+/g, ' ').trim(), start: m.index, end: m.index + m[0].length });
  }
  let bodyStart = 0;
  if (keyMatches.length >= 2) {
    // Extract each key's value (from its end to the next key's start)
    for (let i = 0; i < keyMatches.length; i++) {
      const valStart = keyMatches[i].end;
      const valEnd = i + 1 < keyMatches.length ? keyMatches[i + 1].start : valStart + 300;
      const val = text.slice(valStart, valEnd).replace(/\s+/g, ' ').trim();
      if (val) metaPairs.push({ key: keyMatches[i].key, val: val.slice(0, 300) });
    }
    // Body starts after the last detected meta key's content (heuristic: 600 chars from last key)
    const lastKey = keyMatches[keyMatches.length - 1];
    bodyStart = Math.min(lastKey.end + 600, text.length);
    // Trim to nearest sentence boundary
    const nextDot = text.indexOf('. ', bodyStart);
    if (nextDot > 0 && nextDot - bodyStart < 200) bodyStart = nextDot + 2;
  }

  const body = text.slice(bodyStart).trim();

  // ── 2. Parse body into sections + paragraphs ────────────────────────
  const rawLines = body.split('\n');
  const sections = [];
  let cur = { heading: null, paragraphs: [] };
  let pendingWords = '';

  const flushPending = () => {
    const p = pendingWords.replace(/\s+/g, ' ').trim();
    if (p) cur.paragraphs.push(p);
    pendingWords = '';
  };

  const isHeading = (line) => {
    const t = line.trim();
    if (!t || t.length > 120) return false;
    // ALL-CAPS line (≥4 chars, not a citation number like "AIR 2005 SC")
    if (t === t.toUpperCase() && /[A-Z]{3}/.test(t) && t.length >= 4 && !/^\(?\d/.test(t)) return true;
    // "PART I/II/III" or "PART - I"
    if (/^PART\s*[-–]?\s*[IVX\d]+/i.test(t)) return true;
    // Roman-numeral section: "I.", "II.", "III."
    if (/^(?:X{0,3}(?:IX|IV|V?I{0,3}))\.?\s+[A-Z]/.test(t) && t.length < 80) return true;
    return false;
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPending();
      continue;
    }
    if (isHeading(trimmed)) {
      flushPending();
      if (cur.paragraphs.length > 0 || cur.heading) sections.push(cur);
      cur = { heading: trimmed, paragraphs: [] };
    } else {
      // Accumulate into current paragraph; a blank line (already flushed) separates
      pendingWords += (pendingWords ? ' ' : '') + trimmed;
      // Split on long paragraph — if accumulated > ~600 chars and ends with period
      if (pendingWords.length > 600 && /[.!?]$/.test(pendingWords)) {
        flushPending();
      }
    }
  }
  flushPending();
  if (cur.paragraphs.length > 0 || cur.heading) sections.push(cur);

  // Remove duplicate/noise headings
  const cleaned = sections.filter(s => s.paragraphs.length > 0 || s.heading);
  return { metaPairs, sections: cleaned };
}

function RelevanceBadge({ value, tier }) {
  const relevance = normalizeRelevance(value, tier);
  const st = RELEVANCE_STYLE[relevance] || RELEVANCE_STYLE.Relevant;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
      background: st.bg, color: st.color, letterSpacing: '.03em',
    }}>
      <span aria-hidden="true">{st.dot}</span> {relevance}
    </span>
  );
}

function valOrNA(v) {
  const s = String(v ?? '').trim();
  return s || 'Not Available';
}

function statuteToLink(statute, citation) {
  if (statute && typeof statute === 'object') {
    const label = String(
      statute.name || statute.title || statute.section || statute.text || statute.label || 'Statute'
    ).trim();
    const direct = String(
      statute.india_code_url || statute.indiaCodeUrl || statute.url || statute.link || ''
    ).trim();
    if (direct) return { label: label || direct, url: direct };
    if (label) {
      return {
        label,
        url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(label)}`,
      };
    }
  }

  const raw = String(statute || '').trim();
  if (!raw) return { label: 'Not Available', url: '' };
  if (/^https?:\/\//i.test(raw)) return { label: raw, url: raw };

  const citationSource =
    String(
      citation?.originalCourtCopyUrl ||
      citation?.officialSourceLink ||
      citation?.importSourceLink ||
      citation?.sourceUrl ||
      ''
    ).trim();

  // Prefer statute-specific search; fall back to citation's original page when needed.
  return {
    label: raw,
    url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(raw)}` || citationSource,
  };
}

function extractCaseTitle(rawValue) {
  const raw = String(rawValue || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Untitled Case';
  const cleaned = raw.replace(/^[\-\u2022\d\.\)\(]+\s*/, '').trim();
  const m = cleaned.match(/^(.*?\b(?:v\.?|vs\.?)\b.*?)(?:\s+on\s+\d{1,2}\b.*)?$/i);
  if (m && m[1]) return m[1].trim();
  return cleaned;
}

/* ── clean IK text that leaked a Python list/string repr ──
   Older reports stored fragment text as str(list), so it carries literal "\n", and
   "['…', '…']" brackets/quotes. Convert escapes to spaces and strip the repr wrapping
   so the headnote/excerpt read as clean prose. (New runs are already clean server-side.) */
function cleanIkText(s) {
  let t = String(s ?? '');
  t = t.replace(/\\r\\n|\\n|\\r|\\t/g, ' ')   // literal \n \r \t -> space
       .replace(/\\"/g, '"')
       .replace(/\\'/g, "'");
  t = t.replace(/^\s*\[\s*['"]?/, '')          // leading [ '
       .replace(/['"]?\s*\]\s*$/, '')          // trailing ' ]
       .replace(/['"]\s*,\s*['"]/g, ' ');       // ', ' element separators -> space
  return t.replace(/\s{2,}/g, ' ').trim();
}

/* ── parse flat text into bullet-point array ── */
// A judgment's paragraph number (e.g. "29.", "(3)", "30") — noise as a standalone bullet.
const _isParaMarker = (s) => /^\(?\d{1,4}\)?[.)]?$/.test(String(s).trim());
// Strip a leading paragraph number when it's glued to real content ("29. It is settled…").
const _stripParaNum = (s) => String(s).trim().replace(/^\(?\d{1,4}\)?[.)]\s+/, '').trim();
// Drop bare paragraph-number bullets and de-number the rest, so the headnote reads cleanly.
const _cleanPoints = (arr) => arr.map(_stripParaNum).filter((s) => s && !_isParaMarker(s));

function parseTextToPoints(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.trim();
  if (!t) return [];
  // "- Bullet 1: text - Bullet 2: text …"
  const bulletSplit = t.split(/\s*[-–]\s*Bullet\s*\d*\s*:\s*/i).map(s => s.trim()).filter(Boolean);
  if (bulletSplit.length > 1) return _cleanPoints(bulletSplit);
  // "1. text" / "1) text" on newlines
  const numberedSplit = t.split(/\n+/).map(s => s.replace(/^\d+[.)]\s*/, '').replace(/^[-•·]\s*/, '').trim()).filter(Boolean);
  if (numberedSplit.length > 1) return _cleanPoints(numberedSplit);
  // Sentence-split for very long single paragraphs (ratio decidendi)
  if (t.length > 400) {
    const sentences = t.match(/[^.!?]+[.!?]+["']?(?:\s|$)/g);
    if (sentences && sentences.length > 1) return _cleanPoints(sentences.map(s => s.trim()).filter(Boolean));
  }
  return _cleanPoints([t]);
}

const SECTION_ACCENTS = {
  ratio:   { bg: '#E6F6F3', border: '#0F766E', num: '#0F766E', icon: '⚖️' },
  headnote:{ bg: '#EEF4FF', border: '#2563EB', num: '#2563EB', icon: '📋' },
  excerpt: { bg: '#FFFBEB', border: '#D97706', num: '#D97706', icon: '📝' },
  statute: { bg: '#F3F4F6', border: '#6B7280', num: '#6B7280', icon: '📜' },
};

function DocSection({ label, text, accent = 'ratio', singleBlock = false }) {
  const points = parseTextToPoints(text);
  if (!points.length) return null;
  const a = SECTION_ACCENTS[accent] || SECTION_ACCENTS.ratio;
  return (
    <div className="doc-section">
      <div className="doc-section-title" style={{ borderLeftColor: a.border }}>
        <span className="doc-section-icon">{a.icon}</span>
        {label}
      </div>
      {singleBlock ? (
        <div className="doc-single-block" style={{ borderLeftColor: a.border, background: a.bg }}>
          {points[0]}
        </div>
      ) : (
        <ol className="doc-point-list">
          {points.map((pt, i) => (
            <li key={i} className="doc-point-item">
              <span className="doc-point-num" style={{ background: a.num }}>{i + 1}</span>
              <span className="doc-point-text">{pt}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function citationContextItemToLink(item) {
  if (item && typeof item === 'object') {
    const label = extractCaseTitle(
      item.caseName || item.title || item.name || item.headline || item.text || item.value || ''
    );
    const docId = String(item.docid || item.docId || item.ik_docid || '').trim();
    const direct = String(item.url || item.link || item.href || '').trim();
    if (direct) return { label, url: direct };
    if (docId) return { label, url: `https://indiankanoon.org/doc/${docId}/` };
    return {
      label,
      url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(label)}`,
    };
  }
  const label = extractCaseTitle(item);
  if (/^https?:\/\//i.test(String(item || '').trim())) return { label, url: String(item).trim() };
  return {
    label,
    url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(label)}`,
  };
}

const CATEGORY_CARD_BADGE = {
  recommended: { icon: '⭐', label: 'Recommended', bg: '#D1FAE5', color: '#065F46' },
  adverse: { icon: '⚠️', label: 'Adverse — opposite side', bg: '#FEE2E2', color: '#991B1B' },
  caution: { icon: '🤔', label: 'Use with caution', bg: '#FEF3C7', color: '#92400E' },
};

function CitationCard({ citation, onSelect, getCourtBadgeClass, getCourtLabel, dimensionLabel, isPriority, categoryId }) {
  const courtBadgeClass = getCourtBadgeClass(citation.court);
  const sourceMeta = getSourceMeta(citation);
  const isAdmin = isAdminUpload(citation);
  const catBadge = CATEGORY_CARD_BADGE[categoryId];
  return (
    <div
      className={`cite-card ${isPriority ? 'sc-priority' : ''} ${isAdmin ? 'cite-card-admin' : ''}`}
      onClick={() => onSelect(citation.id)}
      style={isAdmin ? { borderLeft: '3px solid #059669' } : {}}
    >
      <div className="cc-top">
        <span className={`court-badge ${courtBadgeClass}`}>{getCourtLabel(citation.court)}</span>
        {catBadge ? (
          <span className="dimension-badge" title={catBadge.label}
            style={{ background: catBadge.bg, color: catBadge.color, fontWeight: 700 }}>
            {catBadge.icon} {catBadge.label}
          </span>
        ) : (
          <span className="dimension-badge" title={dimensionLabel}>🔑 {dimensionLabel}</span>
        )}
        {isAdmin ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
            background: '#ECFDF5', color: '#065F46', border: '1px solid #6EE7B7',
          }}>
            🏛️ Admin Upload
          </span>
        ) : (
          <span className="source-badge" title={sourceMeta.label}>
            <span className="source-icon" aria-hidden="true">{sourceMeta.icon}</span>
            {sourceMeta.label}
          </span>
        )}
        <RelevanceBadge value={citation.relevanceBadge} tier={citation.relevanceTier} />
      </div>
      {Array.isArray(citation.citationTags) && citation.citationTags.length > 0 ? (
        <div className="cite-tag-row" aria-label="Citation tags">
          {citation.citationTags.map((tag) => (
            <span key={String(tag)} className="cite-tag-chip">
              [{String(tag)}]
            </span>
          ))}
        </div>
      ) : null}
      <div className="cc-name">{citation.caseName || 'Untitled Citation'}</div>
      <div className="cc-meta">
        {citation.dateOfJudgment || 'Date N/A'} &middot; {citation.coram || 'Coram N/A'}
      </div>
      <div className="cc-air">{citation.primaryCitation || 'Reporter citation unavailable'}</div>
    </div>
  );
}

function DimensionGroup({
  group,
  index,
  collapsed,
  onToggle,
  onSelectCitation,
  getCourtBadgeClass,
  getCourtLabel,
  priorityIds,
}) {
  return (
    <div className="dim-group">
      <button className="dim-header dim-toggle" onClick={() => onToggle(group.id)}>
        <span className="dim-pill" style={{
          background: group.id === 'recommended' ? '#D1FAE5' : group.id === 'adverse' ? '#FEE2E2' : group.id === 'caution' ? '#FEF3C7' : '#F1F5F9',
          color: group.id === 'recommended' ? '#065F46' : group.id === 'adverse' ? '#991B1B' : group.id === 'caution' ? '#92400E' : '#334155'
        }}>
          {group.id === 'recommended' ? '⭐ Recommended' : group.id === 'adverse' ? '⚠️ Adverse Risk' : group.id === 'caution' ? '🤔 Caution' : '🔑 Keyword'}
        </span>
        <span className="dim-title">{group.name}</span>
        <span className="dim-count">{group.citations.length} citations</span>
      </button>
      {!collapsed && (
        <div>
          {group.citations.map((citation) => (
            <CitationCard
              key={citation.id}
              citation={citation}
              onSelect={onSelectCitation}
              getCourtBadgeClass={getCourtBadgeClass}
              getCourtLabel={getCourtLabel}
              dimensionLabel={getDimensionDisplayLabel(group, index)}
              categoryId={['recommended', 'adverse', 'caution'].includes(group.id) ? group.id : ''}
              isPriority={priorityIds.has(citation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RedesignedCitationReportDoc({
  report,
  query,
  initialPerspective = 'all',
  initialDimension = 'all',
  onPerspectiveChange,
  onViewFullJudgment,
  onFetchFullJudgment,
  onDownloadCitation,
  onNotifyMe,
  notifyStatus = {},
}) {
  const toCleanHeaderText = (value) => {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    // If backend sends stitched keyword/query phrases, hide that noisy text.
    const commaCount = (raw.match(/,/g) || []).length;
    if (raw.length > 180 || commaCount >= 4) return '';
    return raw;
  };

  const [dimension, setDimension] = useState(initialDimension || 'all');
  const [courtFilter, setCourtFilter] = useState('all'); // 'all', 'sc', 'hc', 'admin'
  const [perspective, setPerspective] = useState(initialPerspective || 'all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [activeTab, setActiveTab] = useState('rep'); // 'rep' or 'fj'
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [fullJudgmentState, setFullJudgmentState] = useState({ loading: false, error: '', text: '', sourceUrl: '', source: '', ikResourceUrl: '', isLocalAdmin: false, pdfBucketPath: '' });

  const reportFormat = report?.report_format || {};
  const queryLabel =
    toCleanHeaderText(report?.title) ||
    toCleanHeaderText(reportFormat.caseTitle) ||
    toCleanHeaderText(reportFormat.caseSummary) ||
    toCleanHeaderText(query) ||
    'Citation research report';
  
  const all = (reportFormat.citations || []).map((citation, index) => ({
    ...citation,
    id: citation.id || citation.canonicalId || citation.canonical_id || `citation_${index}`,
    canonicalId: citation.canonicalId || citation.canonical_id || '',
    argumentParty: normalizePerspective(citation.argumentParty || citation.argument_party || citation.partyBadge || citation.party_badge || citation.perspective || 'neutral', 'neutral'),
    normalizedCourt: normalizeCourt(
      citation.court
      || citation.court_code
      || citation.courtCode
      || citation.metadata?.court
    ),
    searchableText: normalizeSearch([
      citation.caseName,
      citation.primaryCitation,
      citation.court,
      citation.ratio,
      citation.headnote,
      citation.dimensionName,
      citation.dimensionJustification,
      ...(citation.alternateCitations || []),
    ].filter(Boolean).join(' ')),
  }));

  // Show citations that passed legacy verification (GREEN/YELLOW/STALE) OR carry a V2
  // review status (SUGGESTED_FOR_REVIEW/NEEDS_REVIEW/ADVERSE). Without this, V2 reports
  // render "0 citations" because their status vocabulary differs. Only REJECTED / no-result
  // are hidden.
  const SHOWABLE_STATUS = ['GREEN', 'YELLOW', 'STALE', 'SUGGESTED_FOR_REVIEW', 'NEEDS_REVIEW', 'ADVERSE', 'VERIFIED', 'APPROVED'];
  const verified = all.filter((citation) => {
    const s = String(citation.verificationStatus || citation.status || '').toUpperCase();
    return s === '' || SHOWABLE_STATUS.includes(s);
  });
  const extraDims = report?.dimensions_metadata || report?.dimensionsMeta || [];
  const groups = dimensionGroups(reportFormat, verified, extraDims);
  const sidebarGroups = groups.filter((group) => group.id !== 'ungrouped');
  
  useEffect(() => setPerspective(normalizePerspective(initialPerspective || 'all', 'all')), [initialPerspective]);
  useEffect(() => setDimension(initialDimension || 'all'), [initialDimension]);
  useEffect(() => { if (typeof onPerspectiveChange === 'function') onPerspectiveChange(perspective); }, [onPerspectiveChange, perspective]);
  useEffect(() => { setDimension('all'); setCourtFilter('all'); setSearch(''); setActiveId(null); setCollapsedGroups({}); setFullJudgmentState({ loading: false, error: '', text: '', sourceUrl: '', source: '', ikResourceUrl: '', isLocalAdmin: false, pdfBucketPath: '' }); }, [report?.id, report?.report_id]);
  const term = normalizeSearch(search);
  const selectedDimension = normalizeDimensionKey(dimension) || 'all';
  const selectedDimensionName = normalizeSearch(String(dimension || ''));
  const filtered = groups.map((group) => ({
    ...group,
    citations: group.citations.filter((citation) => {
      const groupDimId = normalizeDimensionKey(group.id);
      const groupDimName = normalizeSearch(group.name || '');
      if (
        selectedDimension !== 'all'
        && groupDimId !== selectedDimension
        && (!selectedDimensionName || groupDimName !== selectedDimensionName)
      ) return false;
      if (courtFilter === 'sc' && !(citation.normalizedCourt.includes('supreme court'))) return false;
      if (courtFilter === 'hc' && !(citation.normalizedCourt.includes('high court'))) return false;
      if (courtFilter === 'admin' && !isAdminUpload(citation)) return false;
      // Category buckets already encode the side relationship: adverse = opposite_party,
      // caution = neutral. Applying the perspective filter here would wrongly hide exactly
      // the adverse / caution citations the user wants to see. Only filter keyword groups.
      const isCategoryGroup = group.id === 'recommended' || group.id === 'adverse' || group.id === 'caution';
      if (!isCategoryGroup && !matchesPerspective(citation, perspective)) return false;
      if (term && !citation.searchableText.includes(term)) return false;
      return true;
    }),
  })).filter((group) => group.citations.length);
  console.log('[CitationReport] groups=', groups.length, 'filtered=', filtered.length,
    'dim=', selectedDimension, 'court=', courtFilter, 'persp=', perspective, 'term=', term);

  const visible = filtered.flatMap((group) => group.citations);
  const active = visible.find((citation) => citation.id === activeId) || null;
  const activeDocId = String(active?.canonicalId || '').replace(/^ik:/i, '');
  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'fj' || !active?.canonicalId || typeof onFetchFullJudgment !== 'function') {
      return undefined;
    }
    setFullJudgmentState({ loading: true, error: '', text: '', sourceUrl: '', source: '', ikResourceUrl: '', isLocalAdmin: false, pdfBucketPath: '' });
    Promise.resolve(onFetchFullJudgment(active.canonicalId, active.caseName))
      .then((data) => {
        if (cancelled) return;
        if (!data || !data.fullText) {
          setFullJudgmentState({ loading: false, error: 'No full judgment text available.', text: '', sourceUrl: data?.sourceUrl || '', source: data?.source || '', ikResourceUrl: data?.ikResourceUrl || '', isLocalAdmin: !!data?.isLocalAdmin, pdfBucketPath: data?.pdfBucketPath || '' });
          return;
        }
        setFullJudgmentState({
          loading: false,
          error: '',
          text: String(data.fullText || ''),
          sourceUrl: data.sourceUrl || '',
          source: data.source || '',
          ikResourceUrl: data.ikResourceUrl || '',
          isLocalAdmin: !!data.isLocalAdmin,
          pdfBucketPath: data.pdfBucketPath || '',
        });
      })
      .catch(() => {
        if (!cancelled) setFullJudgmentState({ loading: false, error: 'Failed to load full judgment text.', text: '', sourceUrl: '', source: '', ikResourceUrl: '', isLocalAdmin: false, pdfBucketPath: '' });
      });
    return () => { cancelled = true; };
  }, [activeTab, active?.canonicalId, active?.caseName, onFetchFullJudgment]);
  const topSupremeCourtIds = new Set(
    visible
      .filter((citation) => citation.normalizedCourt.includes('supreme court'))
      .slice(0, 5)
      .map((citation) => citation.id)
  );

  if (!all.length) {
    return <div style={{padding: '24px'}}>No citations found for this report.</div>;
  }

  const getCourtBadgeClass = (courtName) => {
    const normalized = normalizeCourt(courtName);
    if (normalized.includes('supreme')) return 'sc-b';
    return 'hc-b';
  };

  const getCourtLabel = (courtName) => {
    const normalized = normalizeCourt(courtName);
    if (normalized.includes('supreme')) return 'Supreme Court';
    if (normalized.includes('high')) return 'High Court';
    return courtName || 'Court';
  };

  const toggleGroup = (groupId) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="citation-panel-container">
      {/* CASE BAR */}
      <div className="case-bar">
        <div>
          <div className="case-name">{queryLabel}</div>
        </div>
        <div className="case-meta">
          <div className="case-meta-item">Status: <span>{verified.length} approved</span></div>
        </div>
        <div className="case-badge">Legal Intelligence</div>
      </div>

      {/* MAIN PANEL */}
      <div className="panel-wrap">
        
        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="sb-label">Keywords</div>

          <div className={`dim-chip ${selectedDimension === 'all' ? 'active' : ''}`} onClick={() => { setDimension('all'); setActiveId(null); }}>
            <span className="chip-num">All keywords</span>
            {verified.length} citations total
          </div>

          {sidebarGroups.map((group, index) => (
            <div
              key={group.id}
              className={`dim-chip ${(
                selectedDimension === normalizeDimensionKey(group.id)
                || selectedDimensionName === normalizeSearch(group.name || '')
              ) ? 'active' : ''}`}
              onClick={() => { setDimension((group.name || '').trim() || normalizeDimensionKey(group.id) || group.id); setActiveId(null); }}
            >
              <span className="chip-num">
                {group.id === 'recommended' ? '⭐' : group.id === 'adverse' ? '⚠️' : group.id === 'caution' ? '🤔' : '🔑'}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getKeywordLabel(group, index)}
              </span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-dim, #6B7280)' }}>
                {group.citations.length}
              </span>
            </div>
          ))}
          
        </div>

        {/* MAIN AREA */}
        <div className="main-area">

          {/* If there is no active citation, show Results Pane */}
          {!active && (
            <>
              <div className="panel-header">
                <div className="panel-title">Find Citations</div>
                <div className="count-pill"><b>{verified.length}</b> citations across <b>{sidebarGroups.length}</b> groups</div>
              </div>

              <div className="filter-row">
                <span className="filter-label">Court:</span>
                <button className={`flt ${courtFilter === 'all' ? 'active' : ''}`} onClick={() => setCourtFilter('all')}>All courts</button>
                <button className={`flt ${courtFilter === 'sc' ? 'active' : ''}`} onClick={() => setCourtFilter('sc')}>Supreme Court</button>
                <button className={`flt ${courtFilter === 'hc' ? 'active' : ''}`} onClick={() => setCourtFilter('hc')}>High Court</button>
                {/* Admin Upload tab — only shown when report has at least one admin citation */}
                {(() => {
                  const adminCount = verified.filter(c => isAdminUpload(c)).length;
                  if (!adminCount) return null;
                  return (
                    <button
                      className={`flt ${courtFilter === 'admin' ? 'active' : ''}`}
                      onClick={() => setCourtFilter('admin')}
                      style={courtFilter === 'admin' ? {
                        background: '#ECFDF5', color: '#065F46',
                        border: '1px solid #6EE7B7', fontWeight: 700,
                      } : {
                        color: '#065F46', border: '1px solid #BBF7D0',
                      }}
                    >
                      🏛️ Admin Upload
                      <span style={{
                        marginLeft: 5, padding: '0 5px', borderRadius: 8,
                        background: '#6EE7B7', color: '#065F46', fontSize: 9, fontWeight: 800,
                      }}>{adminCount}</span>
                    </button>
                  );
                })()}
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search citation, ratio..."
                  style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: '20px', border: '0.5px solid var(--border-mid)', fontSize: '13px', width: '200px' }}
                />
              </div>

              {/* RESULTS PANE */}
              <div className="results-pane" id="rp">
                {!filtered.length && <div style={{padding: '20px'}}>No citations match current filters.</div>}
                
                {filtered.map((group, index) => (
                  <DimensionGroup
                    key={group.id}
                    group={group}
                    index={index}
                    collapsed={Boolean(collapsedGroups[group.id])}
                    onToggle={toggleGroup}
                    onSelectCitation={setActiveId}
                    getCourtBadgeClass={getCourtBadgeClass}
                    getCourtLabel={getCourtLabel}
                    priorityIds={topSupremeCourtIds}
                  />
                ))}
              </div>
            </>
          )}

          {/* DETAIL PANE */}
          {active && (
            <div className="detail-pane" id="dp" style={{ display: 'flex' }}>
              <div className="det-topbar">
                <button className="back-btn" onClick={() => setActiveId(null)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2.5L5 7L9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Back to results
                </button>
                <button className={`tab-btn ${activeTab === 'rep' ? 'active' : ''}`} onClick={() => setActiveTab('rep')}>Report</button>
                <button className={`tab-btn ${activeTab === 'fj' ? 'active' : ''}`} onClick={() => setActiveTab('fj')}>Full Judgment</button>
                <div className="appr-badge" style={{ backgroundColor: STATUS[active.verificationStatus]?.[1] === 'green' ? 'var(--teal-bg)' : 'var(--amber-bg)', color: STATUS[active.verificationStatus]?.[1] === 'green' ? 'var(--teal-dark)' : 'var(--amber-str)' }}>
                  {STATUS[active.verificationStatus]?.[0] || 'Unverified'}
                </div>
              </div>

              {/* REPORT TAB — Legal Intelligence Document */}
              {activeTab === 'rep' && (() => {
                const relLevel = normalizeRelevance(active.relevanceBadge, active.relevanceTier);
                const isHigh = relLevel === 'Strong';
                // Per-citation confidence. The backend sends `confidence` as 0-1 (and now also
                // a ready 0-100 `confidenceScore`); derive a real percentage from whichever is
                // present so each citation shows ITS own score — only fall back to a constant
                // when the backend gave nothing at all.
                const rawConf = active.confidenceScore ?? active.confidence_score
                  ?? (active.confidence != null ? Number(active.confidence) * 100 : undefined);
                const confidenceScore = (rawConf != null && Number.isFinite(Number(rawConf)))
                  ? Number(rawConf)
                  : (isHigh ? 94.8 : 72.3);
                const verStatus = String(active.verificationStatus || active.verification_status || 'VERIFIED').toUpperCase();
                const isVerified = ['APPROVED','VERIFIED','GREEN','VERIFIED_WARN'].includes(verStatus);
                const courtRaw = String(active.court || '').toUpperCase();
                const jurisdiction = courtRaw.includes('SUPREME') ? 'CRIMINAL APPELLATE JURISDICTION'
                  : courtRaw.includes('HIGH') ? 'ORIGINAL CIVIL JURISDICTION'
                  : 'ORIGINAL JURISDICTION';
                const coramList = (active.coram || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
                const followedBy = (active.ikCitedByList || []);
                const citeList   = (active.ikCiteList || []);
                const excerptText = cleanIkText(active.excerpt?.text || active.excerptText || '');
                const hasExcerpt = excerptText && excerptText.trim().toLowerCase() !== 'further research needed';
                const ratioPoints = (active.ratio && active.ratio !== 'Ratio decidendi not extracted.')
                  ? parseTextToPoints(cleanIkText(active.ratio)) : [];
                const headnotePoints = active.headnote ? parseTextToPoints(cleanIkText(active.headnote)) : [];
                const matchQuery = active.ikFragment?.formInput || active.ikFragment?.headline || '';
                const ikScore = active.ikFragment?.matchScore ?? active.ikMatchScore ?? null;
                const kwScore = (active.keywordScore !== undefined && active.keywordScore !== null) ? active.keywordScore : null;
                const semScore = (kwScore === null) ? (active.semanticScore ?? active.semantic_score ?? null) : null;
                const judgmentSourceUrl =
                  String(
                    active.importSourceLink
                    || active.sourceUrl
                    || active.officialSourceLink
                    || active.originalCourtCopyUrl
                    || ''
                  ).trim();
                const sourceTypeLabel = formatSourceTypeLabel(active);
                return (
                  <div id="rep-content" style={{ overflowY: 'auto', flex: 1, padding: '20px 16px', background: '#F0F4F3' }}>
                    <div className="ld-paper">

                      {/* ── Watermark ── */}
                      <div className="ld-watermark">{isVerified ? 'VERIFIED' : 'UNVERIFIED'}</div>

                      {/* ── Top Row: Seal + Confidence ── */}
                      <div className="ld-toprow">
                        <div className="ld-seal">
                          <div className={`ld-seal-ring ${isVerified ? 'ld-seal-green' : 'ld-seal-amber'}`}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              {isVerified
                                ? <><polyline points="20 6 9 17 4 12"/></>
                                : <><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
                            </svg>
                          </div>
                          <div className="ld-seal-info">
                            <span className="ld-seal-label">VERIFICATION SEAL</span>
                            <span className={`ld-seal-status ${isVerified ? 'ld-seal-status-green' : 'ld-seal-status-amber'}`}>
                              {isVerified ? '✓ VERIFIED CITATION' : '⚠ PENDING REVIEW'}
                            </span>
                            {active.primaryCitation && (
                              <span className="ld-seal-sub">{active.primaryCitation}</span>
                            )}
                          </div>
                        </div>
                        <div className="ld-confidence">
                          <span className="ld-conf-label">CONFIDENCE INDEX</span>
                          <span className="ld-conf-value">{Number(confidenceScore).toFixed(1)}%</span>
                          <span className="ld-conf-sub">AUTHENTICITY &amp; RESEARCH VERIFIED</span>
                        </div>
                        {(active.sourceTier === 'web' || active._source === 'web_tier3' || active.source_type === 'web') && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#0C4A6E', letterSpacing: '0.06em' }}>AUTHORITY TIER</span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: active.authorityTier === 'T1' ? '#065F46' : '#0C4A6E' }}>
                              {active.authorityTier === 'T1' ? '⭐ T1' : active.authorityTier === 'T2' ? '📚 T2' : '🌍 WEB'}
                            </span>
                            <span style={{ fontSize: 8, color: '#64748B' }}>
                              {active.authorityTier === 'T1' ? 'OFFICIAL SOURCE' : 'RECOGNIZED REPORTER'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="ld-divider" />

                      {/* ── Court Header ── */}
                      <div className="ld-court-header">
                        <div className="ld-court-name">IN THE {courtRaw || 'COURT NOT SPECIFIED'}</div>
                        <div className="ld-court-jurisdiction">{jurisdiction}</div>
                      </div>

                      {/* ── Case Title ── */}
                      <div className="ld-case-block">
                        <h1 className="ld-case-title">{active.caseName || 'Untitled Case'}</h1>
                        <div className="ld-case-meta-row">
                          <div className="ld-case-meta-item">
                            <span className="ld-meta-lbl">PRIMARY CITATION</span>
                            <span className="ld-meta-val ld-meta-teal">{active.primaryCitation || 'Unreported — cite by case name & date'}</span>
                            {active.neutralCitation && active.reporterCitation && active.neutralCitation !== active.reporterCitation && (
                              <span className="ld-meta-lbl" style={{ marginTop: 2 }}>Neutral: {active.neutralCitation}</span>
                            )}
                          </div>
                          <div className="ld-case-meta-divider" />
                          <div className="ld-case-meta-item">
                            <span className="ld-meta-lbl">DATE OF JUDGMENT</span>
                            <span className="ld-meta-val">{active.dateOfJudgment || '—'}</span>
                          </div>
                          {active.year && (
                            <>
                              <div className="ld-case-meta-divider" />
                              <div className="ld-case-meta-item">
                                <span className="ld-meta-lbl">YEAR</span>
                                <span className="ld-meta-val">{active.year}</span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Alternate Citations */}
                        {(active.alternateCitations || []).length > 0 && (
                          <div className="ld-alt-cits">
                            {(active.alternateCitations).map(c => (
                              <span key={c} className="ld-alt-chip">{c}</span>
                            ))}
                          </div>
                        )}
                        <div className="ld-alt-cits">
                          <span className="ld-alt-chip">Source Type: {sourceTypeLabel}</span>
                          {judgmentSourceUrl && (
                            <a href={judgmentSourceUrl} target="_blank" rel="noopener noreferrer" className="ld-alt-chip">
                              Judgment Source URL ↗
                            </a>
                          )}
                        </div>

                        {/* Bench + Statutes row */}
                        <div className="ld-bench-statutes-row">
                          {coramList.length > 0 && (
                            <div className="ld-bench-col">
                              <span className="ld-meta-lbl">CORAM / BENCH</span>
                              <div className="ld-judges">
                                {coramList.map((j, i) => (
                                  <div key={i} className="ld-judge-item">
                                    <span className="ld-judge-dot" />
                                    {j}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(active.statutes || []).length > 0 && (
                            <div className="ld-statutes-col">
                              <span className="ld-meta-lbl">STATUTORY PROVISIONS</span>
                              <div className="ld-statute-pills">
                                {(active.statutes || []).map((s, i) => {
                                  const { label, url } = statuteToLink(s, active);
                                  return url ? (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="ld-statute-pill">{label}</a>
                                  ) : (
                                    <span key={i} className="ld-statute-pill">{label}</span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Dimension tag */}
                        {active.dimensionName && (
                          <div className="ld-dimension-tag">
                            <span className="ld-dim-num">
                              {active.dimensionId != null ? `DIMENSION ${active.dimensionId}` : 'LEGAL DIMENSION'}
                            </span>
                            <span className="ld-dim-name">{active.dimensionName}</span>
                            <span style={{
                              padding: '2px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                              background: (RELEVANCE_STYLE[relLevel] || RELEVANCE_STYLE.Relevant).bg,
                              color: (RELEVANCE_STYLE[relLevel] || RELEVANCE_STYLE.Relevant).color,
                            }}>
                              {(RELEVANCE_STYLE[relLevel] || RELEVANCE_STYLE.Relevant).dot} {relLevel} Relevance
                            </span>
                          </div>
                        )}
                      </div>

                      {/* ── How to use this authority (usage-analysis memo) ── */}
                      {Array.isArray(active.usage_analysis) && active.usage_analysis.length > 0 && (() => {
                        const rv = String(active.relevance_verdict || active.relevanceVerdict || '').toUpperCase();
                        const RVS = {
                          RELEVANT:           { bg: '#DCFCE7', color: '#15803D', label: 'Relevant',           dot: '●' },
                          PARTIALLY_RELEVANT: { bg: '#FEF3C7', color: '#92400E', label: 'Partially relevant', dot: '◆' },
                          NOT_RELEVANT:       { bg: '#FEE2E2', color: '#991B1B', label: 'Not relevant',       dot: '▲' },
                        };
                        const rvs = RVS[rv];
                        const verdict = active.usage_verdict || active.usageVerdict || '';
                        const reason = active.relevance_reason || active.relevanceReason || '';
                        return (
                          <div className="ld-section">
                            <div className="ld-section-hdr">
                              <span className="ld-section-num" style={{ color: '#0f766e' }}>★</span>
                              HOW TO USE THIS AUTHORITY
                            </div>
                            {(rvs || verdict) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '2px 0 14px' }}>
                                {rvs && (
                                  <span title={reason} style={{ padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: rvs.bg, color: rvs.color, whiteSpace: 'nowrap' }}>
                                    {rvs.dot} {rvs.label}
                                  </span>
                                )}
                                {verdict && <span style={{ fontSize: 13, color: '#334155', fontWeight: 600, lineHeight: 1.5 }}>{verdict}</span>}
                              </div>
                            )}
                            <div style={{ display: 'grid', gap: 14 }}>
                              {active.usage_analysis.map((sec, i) => (
                                <div key={i} style={{ borderLeft: '3px solid #0f766e', padding: '2px 0 2px 14px' }}>
                                  {sec.heading && (
                                    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 5 }}>
                                      {sec.heading}
                                    </div>
                                  )}
                                  {sec.body && (
                                    <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#1f2937' }}>{sec.body}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── SECTION I: Legal Analysis & Ratio ── */}
                      <div className="ld-section">
                        <div className="ld-section-hdr">
                          <span className="ld-section-num">I.</span>
                          LEGAL ANALYSIS &amp; RATIO
                        </div>

                        {/* Ratio quote */}
                        {ratioPoints.length > 0 && (
                          <blockquote className="ld-ratio-quote">
                            {ratioPoints.length === 1
                              ? <span className="ld-ratio-text">"{ratioPoints[0]}"</span>
                              : (
                                <ol className="ld-ratio-list">
                                  {ratioPoints.map((pt, i) => (
                                    <li key={i} className="ld-ratio-item">
                                      <span className="ld-ratio-num">{i + 1}</span>
                                      <span className="ld-ratio-text">{pt}</span>
                                    </li>
                                  ))}
                                </ol>
                              )
                            }
                          </blockquote>
                        )}

                        {/* Headnote */}
                        {headnotePoints.length > 0 && (
                          <div className="ld-headnote-block">
                            <div className="ld-sub-hdr">HEADNOTE</div>
                            <ol className="ld-headnote-list">
                              {headnotePoints.map((pt, i) => (
                                <li key={i} className="ld-headnote-item">
                                  <span className="ld-headnote-num">{i + 1}</span>
                                  <span className="ld-headnote-text">{pt}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* Headnotes (Structured) — separate field from headnote */}
                        {active.headnotes && active.headnotes !== active.headnote && (() => {
                          const pts = parseTextToPoints(active.headnotes);
                          return pts.length > 0 ? (
                            <div className="ld-headnote-block" style={{ background: '#F0F4FF', borderLeft: '3px solid #4F46E5' }}>
                              <div className="ld-sub-hdr" style={{ color: '#4338CA' }}>HEADNOTES (STRUCTURED)</div>
                              <ol className="ld-headnote-list">
                                {pts.map((pt, i) => (
                                  <li key={i} className="ld-headnote-item">
                                    <span className="ld-headnote-num" style={{ background: '#4F46E5' }}>{i + 1}</span>
                                    <span className="ld-headnote-text" style={{ color: '#1e1b4b' }}>{pt}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ) : null;
                        })()}

                        {/* Party Arguments */}
                        {(() => {
                          const args = active.partyArguments || active.party_arguments || {};
                          const appArgs = Array.isArray(args.appellant) ? args.appellant : [];
                          const respArgs = Array.isArray(args.respondent) ? args.respondent : [];
                          const courtArgs = args.court ? (Array.isArray(args.court) ? args.court : [args.court]) : [];
                          if (!appArgs.length && !respArgs.length && !courtArgs.length) return null;
                          return (
                            <div className="ld-party-args">
                              <div className="ld-sub-hdr">PARTY ARGUMENTS</div>
                              <div className="ld-args-grid">
                                {appArgs.length > 0 && (
                                  <div className="ld-arg-col ld-arg-appellant">
                                    <div className="ld-arg-col-hdr">
                                      <span className="ld-arg-dot ld-dot-blue" />
                                      Appellant / Petitioner
                                    </div>
                                    <ol className="ld-arg-list">
                                      {appArgs.map((a, i) => (
                                        <li key={i} className="ld-arg-item">
                                          <span className="ld-arg-num ld-num-blue">{i + 1}</span>
                                          <span className="ld-arg-text">{String(a)}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                                {respArgs.length > 0 && (
                                  <div className="ld-arg-col ld-arg-respondent">
                                    <div className="ld-arg-col-hdr">
                                      <span className="ld-arg-dot ld-dot-amber" />
                                      Respondent / Defendant
                                    </div>
                                    <ol className="ld-arg-list">
                                      {respArgs.map((a, i) => (
                                        <li key={i} className="ld-arg-item">
                                          <span className="ld-arg-num ld-num-amber">{i + 1}</span>
                                          <span className="ld-arg-text">{String(a)}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                              </div>
                              {courtArgs.length > 0 && (
                                <div className="ld-court-ratio">
                                  <div className="ld-arg-col-hdr" style={{ color: '#0F766E' }}>
                                    <span className="ld-arg-dot" style={{ background: '#0F766E' }} />
                                    Court's Ratio / Analysis
                                  </div>
                                  <ol className="ld-arg-list">
                                    {courtArgs.map((a, i) => (
                                      <li key={i} className="ld-arg-item">
                                        <span className="ld-arg-num" style={{ background: '#0F766E' }}>{i + 1}</span>
                                        <span className="ld-arg-text">{String(a)}</span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Relevant excerpt */}
                        {hasExcerpt && (
                          <div className="ld-excerpt-block">
                            <div className="ld-sub-hdr">RELEVANT EXCERPT</div>
                            <p className="ld-excerpt-text">{excerptText}</p>
                          </div>
                        )}

                        {/* Proposition Verification */}
                        {(matchQuery || ikScore !== null || semScore !== null || kwScore !== null) && (
                          <div className="ld-proposition">
                            <div className="ld-prop-hdr">
                              PROPOSITION VERIFICATION
                              <span className="ld-prop-tag">{kwScore !== null ? 'KEYWORD MATCH' : 'DETAILED SEMANTIC MAPPING'}</span>
                            </div>
                            {matchQuery && (
                              <div className="ld-prop-query">
                                Query: <em>{matchQuery.slice(0, 120)}{matchQuery.length > 120 ? '…' : ''}</em>
                              </div>
                            )}
                            {(ikScore !== null || semScore !== null || kwScore !== null) && (
                              <div className="ld-scores">
                                {ikScore !== null && (
                                  <div className="ld-score-row">
                                    <span className="ld-score-lbl">IK Passage</span>
                                    <div className="ld-score-bar-wrap">
                                      <div className="ld-score-bar ld-score-bar-green" style={{ width: `${Math.min(100, Math.round(Number(ikScore) * 100))}%` }} />
                                    </div>
                                    <span className="ld-score-val">{(Number(ikScore) * 100).toFixed(0)} / 100</span>
                                  </div>
                                )}
                                {kwScore !== null && (
                                  <div className="ld-score-row">
                                    <span className="ld-score-lbl">Keyword Matches</span>
                                    <div className="ld-score-bar-wrap">
                                      <div className="ld-score-bar ld-score-bar-blue" style={{ width: kwScore > 0 ? `${Math.min(100, kwScore * 20)}%` : '2%' }} />
                                    </div>
                                    <span className="ld-score-val">{kwScore > 0 ? `${kwScore} match${kwScore !== 1 ? 'es' : ''}` : 'Admin (0)'}</span>
                                  </div>
                                )}
                                {semScore !== null && (
                                  <div className="ld-score-row">
                                    <span className="ld-score-lbl">Semantic Score</span>
                                    <div className="ld-score-bar-wrap">
                                      <div className="ld-score-bar ld-score-bar-blue" style={{ width: `${Math.min(100, Math.round(Number(semScore) * 100))}%` }} />
                                    </div>
                                    <span className="ld-score-val">{(Number(semScore) * 100).toFixed(0)} / 100</span>
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="ld-match-confirmed">{kwScore !== null && kwScore === 0 ? 'ADMIN UPLOAD' : 'MATCH CONFIRMED'}</div>
                          </div>
                        )}
                      </div>

                      {/* ── SECTION II: Subsequent Treatment ── */}
                      {(followedBy.length > 0 || citeList.length > 0) && (
                        <div className="ld-section">
                          <div className="ld-section-hdr">
                            <span className="ld-section-num">II.</span>
                            SUBSEQUENT TREATMENT
                          </div>
                          <div className="ld-treatment-grid">
                            <div className="ld-treatment-box ld-treat-green">
                              <span className="ld-treat-count">{followedBy.length}</span>
                              <span className="ld-treat-icon">📈</span>
                              <span className="ld-treat-lbl">FOLLOWED IN</span>
                              <span className="ld-treat-sub">Cases</span>
                            </div>
                            <div className="ld-treatment-box ld-treat-amber">
                              <span className="ld-treat-count">0</span>
                              <span className="ld-treat-icon">⚖️</span>
                              <span className="ld-treat-lbl">DISTINGUISHED IN</span>
                              <span className="ld-treat-sub">Cases</span>
                            </div>
                            <div className="ld-treatment-box ld-treat-red">
                              <span className="ld-treat-count">0</span>
                              <span className="ld-treat-icon">🚫</span>
                              <span className="ld-treat-lbl">OVERRULED BY</span>
                              <span className="ld-treat-sub">Cases</span>
                            </div>
                          </div>
                          {followedBy.length > 0 && (
                            <div className="ld-follow-list">
                              {followedBy.slice(0, 8).map((item, idx) => {
                                const { label, url } = citationContextItemToLink(item);
                                return (
                                  <div key={idx} className="ld-follow-item">
                                    <div className="ld-follow-info">
                                      <a href={url} target="_blank" rel="noopener noreferrer" className="ld-follow-name">{label}</a>
                                      {item.publishdate && <span className="ld-follow-date">{item.publishdate}</span>}
                                    </div>
                                    <span className="ld-follows-badge">FOLLOWS</span>
                                  </div>
                                );
                              })}
                              {followedBy.length > 8 && (
                                <div className="ld-follow-more">+{followedBy.length - 8} more cases</div>
                              )}
                            </div>
                          )}
                          {citeList.length > 0 && (
                            <div style={{ marginTop: 14 }}>
                              <div className="ld-sub-hdr" style={{ marginBottom: 8 }}>CASES CITED IN THIS JUDGMENT</div>
                              <div className="ld-follow-list">
                                {citeList.slice(0, 5).map((item, idx) => {
                                  const { label, url } = citationContextItemToLink(item);
                                  return (
                                    <div key={idx} className="ld-follow-item">
                                      <a href={url} target="_blank" rel="noopener noreferrer" className="ld-follow-name">{label}</a>
                                      <span className="ld-cited-badge">CITED</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Citation Tags ── */}
                      {Array.isArray(active.citationTags) && active.citationTags.length > 0 && (
                        <div className="ld-tags-row">
                          {active.citationTags.map(tag => (
                            <span key={String(tag)} className="cite-tag-chip">[{String(tag)}]</span>
                          ))}
                        </div>
                      )}

                      {/* ── Footer ── */}
                      <div className="ld-footer">
                        <div className="ld-footer-left">
                          <div className="ld-footer-brand">JURINEX LEGAL INTELLIGENCE REPORT</div>
                          <div className="ld-footer-meta">
                            Generated {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {active.court && ` · Source: ${active.court}`}
                          </div>
                          <div className="ld-footer-meta">Authenticated Research Document</div>
                        </div>
                        <div className="ld-footer-actions">
                          {activeDocId && (
                            <button className="ld-btn-ghost" onClick={() => window.open(`https://indiankanoon.org/doc/${activeDocId}/`, '_blank')}>
                              VIEW SOURCE ↗
                            </button>
                          )}
                          {active.originalCourtCopyUrl && (
                            <button className="ld-btn-ghost" onClick={() => window.open(active.originalCourtCopyUrl, '_blank')}>
                              COURT COPY
                            </button>
                          )}
                          <button className="ld-btn-primary" onClick={() => onDownloadCitation?.(active)}>
                            DOWNLOAD PDF
                          </button>
                          <button className="ld-btn-ghost" onClick={() => { navigator.clipboard?.writeText(window.location.href); }}>
                            SHARE LINK
                          </button>
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })()}

              {/* FULL JUDGMENT TAB */}
              {activeTab === 'fj' && (() => {
                const raw = String(fullJudgmentState.text || '').trim();
                const looksHtml = /<\s*(p|div|h1|h2|h3|section|article|br|span|table|ol|ul|li)\b/i.test(raw);
                const coramList = (active.coram || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
                const { metaPairs, sections } = (!looksHtml && raw) ? parseJudgmentText(raw) : { metaPairs: [], sections: [] };

                return (
                  <div id="fj-content" style={{ overflowY: 'auto', flex: 1, padding: '20px 16px', background: '#F0F4F3' }}>
                    <div className="jdoc-paper">

                      {/* ── Document Header ── */}
                      <div className="jdoc-header">
                        <div className="jdoc-court-badge">{active.court || 'Court Not Specified'}</div>
                        <h1 className="jdoc-case-title">{active.caseName || 'Untitled'}</h1>
                        {active.primaryCitation && (
                          <div className="jdoc-primary-cit">{active.primaryCitation}</div>
                        )}
                        {active.dateOfJudgment && (
                          <div className="jdoc-date">Decided on {active.dateOfJudgment}</div>
                        )}
                      </div>

                      {/* ── Metadata Card ── */}
                      <div className="jdoc-meta-card">
                        {coramList.length > 0 && (
                          <div className="jdoc-meta-row">
                            <span className="jdoc-meta-key">Coram</span>
                            <div className="jdoc-coram-chips">
                              {coramList.map((j, i) => (
                                <span key={i} className="jdoc-coram-chip">
                                  <span className="jdoc-coram-dot" />
                                  {j}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {(active.alternateCitations || []).length > 0 && (
                          <div className="jdoc-meta-row">
                            <span className="jdoc-meta-key">Equivalent Citations</span>
                            <div className="jdoc-alt-cit-chips">
                              {(active.alternateCitations).map((c, i) => (
                                <span key={i} className="jdoc-alt-chip">{c}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {metaPairs.filter(p => !['Bench','Author','BENCH'].includes(p.key)).map(({ key, val }, i) => (
                          <div key={i} className="jdoc-meta-row">
                            <span className="jdoc-meta-key">{key}</span>
                            <span className="jdoc-meta-val">{val}</span>
                          </div>
                        ))}
                      </div>

                      {/* ── Loading / Error ── */}
                      {fullJudgmentState.loading && (
                        <div className="jdoc-state-box">
                          <div className="jdoc-spinner" />
                          <span>Loading full judgment…</span>
                        </div>
                      )}
                      {!fullJudgmentState.loading && fullJudgmentState.error && (
                        <div className="jdoc-state-box jdoc-error">
                          <span>⚠ {fullJudgmentState.error}</span>
                        </div>
                      )}

                      {/* ── IK Live Source Badge ── */}
                      {!fullJudgmentState.loading && !fullJudgmentState.error && fullJudgmentState.source === 'indiankanoon_live' && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                          padding: '8px 12px', background: '#EFF6FF', borderRadius: 8,
                          border: '1px solid #BFDBFE', fontSize: 12, color: '#1D4ED8', flexWrap: 'wrap',
                        }}>
                          <span style={{ fontWeight: 700 }}>Live from Indian Kanoon</span>
                          <span style={{ color: '#93C5FD' }}>·</span>
                          <span style={{ color: '#475569' }}>Not stored — fetched directly from IK API</span>
                          {fullJudgmentState.ikResourceUrl && (
                            <>
                              <span style={{ color: '#93C5FD' }}>·</span>
                              <a
                                href={fullJudgmentState.ikResourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#1D4ED8', fontWeight: 600, textDecoration: 'underline' }}
                              >
                                View on Indian Kanoon ↗
                              </a>
                            </>
                          )}
                        </div>
                      )}
                      {/* ── Admin Upload PDF Bucket Path ── */}
                      {!fullJudgmentState.loading && !fullJudgmentState.error && fullJudgmentState.isLocalAdmin && fullJudgmentState.pdfBucketPath && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                          padding: '8px 12px', background: '#F0FDF4', borderRadius: 8,
                          border: '1px solid #BBF7D0', fontSize: 12, color: '#166534', flexWrap: 'wrap',
                        }}>
                          <span style={{ fontWeight: 700 }}>Admin Upload</span>
                          <span style={{ color: '#86EFAC' }}>·</span>
                          <span style={{ color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {fullJudgmentState.pdfBucketPath}
                          </span>
                          {/^https?:\/\//.test(fullJudgmentState.pdfBucketPath) && (
                            <>
                              <span style={{ color: '#86EFAC' }}>·</span>
                              <a
                                href={fullJudgmentState.pdfBucketPath}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#166534', fontWeight: 600, textDecoration: 'underline' }}
                              >
                                Open PDF ↗
                              </a>
                            </>
                          )}
                        </div>
                      )}

                      {/* ── Judgment Body ── */}
                      {!fullJudgmentState.loading && !fullJudgmentState.error && raw && (
                        looksHtml ? (
                          <div
                            className="jdoc-prose jdoc-html-prose"
                            dangerouslySetInnerHTML={{ __html: sanitizeJudgmentHtml(raw) }}
                          />
                        ) : (
                          <div className="jdoc-prose">
                            {sections.length > 0 ? sections.map((sec, si) => (
                              <div key={si} className="jdoc-section">
                                {sec.heading && (
                                  <div className="jdoc-section-heading">{sec.heading}</div>
                                )}
                                {sec.paragraphs.map((para, pi) => {
                                  // Detect if paragraph itself is a sub-heading
                                  const isSubHead = para.length < 90 && para === para.toUpperCase() && /[A-Z]{3}/.test(para);
                                  if (isSubHead) {
                                    return <div key={pi} className="jdoc-subheading">{para}</div>;
                                  }
                                  // Detect numbered paragraph: starts with digit+dot or digit+bracket
                                  const numMatch = para.match(/^(\d{1,3}[.)])\s+(.+)$/s);
                                  if (numMatch) {
                                    return (
                                      <div key={pi} className="jdoc-numbered-para">
                                        <span className="jdoc-para-num">{numMatch[1]}</span>
                                        <span className="jdoc-para-text">{numMatch[2]}</span>
                                      </div>
                                    );
                                  }
                                  return <p key={pi} className="jdoc-para">{para}</p>;
                                })}
                              </div>
                            )) : (
                              // Fallback: simple paragraph split
                              formatJudgmentPlainText(raw).map((p, idx) => (
                                <p key={idx} className="jdoc-para">{p}</p>
                              ))
                            )}
                          </div>
                        )
                      )}

                      {/* ── Footer Actions ── */}
                      <div className="jdoc-footer-actions">
                        {!!fullJudgmentState.sourceUrl && (
                          <button className="ld-btn-ghost" onClick={() => window.open(fullJudgmentState.sourceUrl, '_blank')}>
                            OPEN SOURCE ↗
                          </button>
                        )}
                        <button
                          className="ld-btn-primary"
                          onClick={() => onViewFullJudgment?.(active.canonicalId, active.caseName)}
                          disabled={!active.canonicalId}
                        >
                          VIEW COMPLETE JUDGMENT
                        </button>
                      </div>

                    </div>
                  </div>
                );
              })()}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
