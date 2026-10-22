const DEEP_SOURCE_TYPE = 'deep_research_web';
const DEEP_META_TYPE = 'deep_research_meta';

export function safeDeepResearchUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Reconcile live Deep Research text with the canonical answer emitted by the
 * backend's SSE `done` event. A string `doneAnswer` always wins, including an
 * intentionally shorter or empty answer after server-side link validation.
 */
export function reconcileDeepResearchStreamText(streamedText, doneAnswer) {
  if (typeof doneAnswer === 'string') return doneAnswer;
  if (typeof streamedText === 'string') return streamedText;
  return streamedText == null ? '' : String(streamedText);
}

/**
 * Apply an SSE answer chunk. Snapshot replacement is an explicit Deep Research
 * contract; all other streams retain the existing append-only behavior.
 */
export function mergeResearchStreamChunk(streamedText, chunkText, isDeepResearch, replace) {
  const current = typeof streamedText === 'string' ? streamedText : String(streamedText ?? '');
  const incoming = typeof chunkText === 'string' ? chunkText : String(chunkText ?? '');
  return isDeepResearch === true && replace === true ? incoming : current + incoming;
}

export function isDeepResearchSource(source) {
  return Boolean(
    source
    && source.source_type === DEEP_SOURCE_TYPE
    && source.validation_status === 'valid'
    && safeDeepResearchUrl(source.canonical_url || source.url),
  );
}

export function isDeepResearchMarker(value) {
  return Boolean(value && value.source_type === DEEP_META_TYPE && value.deep_research === true);
}

export function normalizeDeepResearchSources(input) {
  const seen = new Set();
  const sources = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isDeepResearchSource(raw)) continue;
    const url = safeDeepResearchUrl(raw.canonical_url || raw.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const hostname = new URL(url).hostname;
    sources.push({
      ...raw,
      source_id: String(raw.source_id || `S${sources.length + 1}`),
      title: String(raw.title || raw.publisher || hostname).slice(0, 240),
      domain: hostname,
      authority_label: String(raw.authority_label || 'Validated web source'),
      canonical_url: url,
      claim_ids: Array.isArray(raw.claim_ids) ? raw.claim_ids.map(String) : [],
    });
  }
  return sources;
}

export function isDeepResearchMessage(message) {
  if (message?.deep_research === true || message?.method === 'deep_research') return true;
  return (Array.isArray(message?.citations) ? message.citations : []).some(
    (citation) => citation?.source_type === DEEP_SOURCE_TYPE || isDeepResearchMarker(citation),
  );
}

export { DEEP_META_TYPE, DEEP_SOURCE_TYPE };
