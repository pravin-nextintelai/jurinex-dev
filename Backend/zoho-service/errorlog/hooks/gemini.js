'use strict';
/**
 * Gemini SDK hook for @google/genai (Models.prototype.*Internal, which the
 * public generateContent/… arrow functions and Chat delegate to) and the legacy
 * @google/generative-ai (GenerativeModel / ChatSession prototypes).
 */
const { CAT, SEV } = require('../classify');
const { truncate } = require('../sanitize');
const { runInSdk } = require('./http');

const PROVIDER = 'GEMINI';
const BLOCK_FINISH = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'OTHER', 'SPII', 'LANGUAGE', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'IMAGE_OTHER', 'MODEL_ARMOR', 'JAILBREAK']);
const INVALID_FINISH = new Set(['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL']);
const UNSPECIFIED = new Set([null, undefined, '', 'FINISH_REASON_UNSPECIFIED', 'BLOCKED_REASON_UNSPECIFIED', 'STOP', '0', 0]);

function enumName(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return (s.includes('.') ? s.split('.').pop() : s).toUpperCase() || null;
}

function usage(resp) {
  const um = resp && (resp.usageMetadata || resp.usage_metadata);
  if (!um) return null;
  const out = {};
  for (const k of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount']) {
    if (Number.isInteger(um[k])) out[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = um[k];
  }
  return Object.keys(out).length ? out : null;
}

function partsOf(c) { return (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : []; }

function hasContent(resp) {
  for (const c of (resp && resp.candidates) || []) {
    for (const p of partsOf(c)) {
      if (typeof p.text === 'string' && p.text.trim()) return true;
      if (p.functionCall || p.inlineData || p.executableCode || p.codeExecutionResult || p.fileData) return true;
    }
  }
  return false;
}

function textChars(resp) {
  let n = 0;
  for (const c of (resp && resp.candidates) || []) for (const p of partsOf(c)) if (typeof p.text === 'string') n += p.text.length;
  return n;
}

function parseApiError(err) {
  let status = Number(err && (err.status || err.code || (err.response && err.response.status)));
  if (!Number.isInteger(status) || status < 100 || status > 599) status = null;
  let code = null;
  const msg = String((err && err.message) || '');
  const m = /"status"\s*:\s*"([A-Z_]+)"/.exec(msg);
  if (m) code = m[1];
  if (!code && err && typeof err.statusText === 'string' && err.statusText) code = err.statusText.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (!code && err && Array.isArray(err.errorDetails) && err.errorDetails[0] && err.errorDetails[0].reason) code = String(err.errorDetails[0].reason);
  if (!code && err && typeof err.code === 'string' && !/^\d+$/.test(err.code)) code = err.code;
  return { status, code, message: msg };
}

class GeminiHook {
  constructor(recorder, cfg) { this.recorder = recorder; this.cfg = cfg; }

  recordError(err, { model, sdkMethod, started }) {
    try {
      const { status, code, message } = parseApiError(err);
      const ev = this.recorder.eventExternal({
        provider: PROVIDER, url: null, methodName: `genai.${sdkMethod}`, status, errorCode: code,
        responseText: truncate(message, 2000), err, model, latencyMs: Date.now() - started,
      });
      this.recorder.record(ev);
    } catch (_) { /* never throw */ }
  }

  inspect(resp, { model, sdkMethod, started, streamed = false, sawContent = null }) {
    try {
      if (!resp && !streamed) return;
      const candidates = (resp && resp.candidates) || [];
      const finish = new Set(candidates.map((c) => enumName(c.finishReason || c.finish_reason)).filter(Boolean));
      const pf = resp && (resp.promptFeedback || resp.prompt_feedback);
      let block = pf ? enumName(pf.blockReason || pf.block_reason) : null;
      if (UNSPECIFIED.has(block)) block = null;
      const content = streamed ? !!sawContent : hasContent(resp);
      const payload = { finish_reasons: Array.from(finish).sort(), candidates: candidates.length, streamed };
      const tok = usage(resp); if (tok) payload.tokens = tok;
      if (this.cfg.storeAiContent && resp) { try { payload.output_preview = truncate(typeof resp.text === 'function' ? resp.text() : resp.text, 500); } catch (_) { /* ignore */ } } else payload.output_chars = textChars(resp);

      let category = null; let severity = null; let code = null; let errorType = null; let message = null;
      const pick = (set) => Array.from(finish).filter((f) => set.has(f)).sort()[0];
      if (block) { category = CAT.AI_SAFETY; severity = SEV.WARNING; code = block; errorType = 'GeminiPromptBlocked'; message = `prompt blocked: ${block}`; if (pf && pf.blockReasonMessage) payload.block_reason_message = truncate(pf.blockReasonMessage, 300); }
      else if (pick(BLOCK_FINISH)) { code = pick(BLOCK_FINISH); category = CAT.AI_SAFETY; severity = SEV.WARNING; errorType = 'GeminiSafetyBlock'; message = `response stopped: finish_reason=${code}`; }
      else if (pick(INVALID_FINISH)) { code = pick(INVALID_FINISH); category = CAT.AI_INVALID; severity = SEV.WARNING; errorType = 'GeminiInvalidOutput'; message = `finish_reason=${code}`; }
      else if (finish.has('MAX_TOKENS')) { code = 'MAX_TOKENS'; category = CAT.AI_EMPTY; severity = SEV.WARNING; errorType = 'GeminiMaxTokens'; message = 'response truncated: finish_reason=MAX_TOKENS'; payload.partial = content; }
      else if (!candidates.length || !content) { code = candidates.length ? 'EMPTY_RESPONSE' : 'NO_CANDIDATES'; category = CAT.AI_EMPTY; severity = SEV.ERROR; errorType = 'GeminiEmptyResponse'; message = 'no text or function call in a successful response'; }
      if (!category) return;
      const ev = this.recorder.eventExternal({ provider: PROVIDER, url: null, methodName: `genai.${sdkMethod}`, errorCode: code, model, latencyMs: Date.now() - started, category, severity, payload, errorType, message });
      this.recorder.record(ev);
    } catch (_) { /* never throw */ }
  }

  wrapStream(gen, meta) {
    const hook = this;
    let saw = false; let last = null; let done = false;
    return (async function* errorlogStream() {
      try {
        for await (const chunk of gen) {
          last = chunk;
          if (!saw && hasContent(chunk)) saw = true;
          yield chunk;
        }
      } catch (err) {
        if (!done) { done = true; hook.recordError(err, Object.assign({}, meta, { sdkMethod: `${meta.sdkMethod}[stream]` })); }
        throw err;
      }
      if (!done) { done = true; hook.inspect(last, Object.assign({}, meta, { sdkMethod: `${meta.sdkMethod}[stream]`, streamed: true, sawContent: saw })); }
    }());
  }
}

function modelOf(self, params) {
  const m = (params && typeof params === 'object' && params.model) || (self && (self.model || self.modelName)) || null;
  return m ? String(m).replace(/^models\//, '').slice(0, 100) : null;
}

/**
 * kind: 'generate' (Promise<response>), 'stream' (Promise<AsyncGenerator>),
 * 'legacy-generate' (Promise<{response}>), 'legacy-stream' (Promise<{stream, response}>), 'other'
 */
function patchMethod(proto, name, kind, hook, prefix, patched) {
  const orig = proto && proto[name];
  if (typeof orig !== 'function' || orig.__errorlogWrapped) return;
  const sdkMethod = `${prefix}${name}`;
  const wrapped = function errorlogGemini(...args) {
    const self = this;
    const model = modelOf(self, args[0]);
    const started = Date.now();
    let out;
    try { out = runInSdk(() => orig.apply(self, args)); } catch (err) { hook.recordError(err, { model, sdkMethod, started }); throw err; }
    if (!out || typeof out.then !== 'function') {
      if (kind === 'generate' || kind === 'legacy-generate') hook.inspect(out && out.response ? out.response : out, { model, sdkMethod, started });
      return out;
    }
    return out.then((result) => {
      if (kind === 'generate') hook.inspect(result, { model, sdkMethod, started });
      else if (kind === 'legacy-generate') hook.inspect(result && result.response ? result.response : result, { model, sdkMethod, started });
      else if (kind === 'stream' && result && typeof result[Symbol.asyncIterator] === 'function') return hook.wrapStream(result, { model, sdkMethod, started });
      else if (kind === 'legacy-stream' && result && result.stream && typeof result.stream[Symbol.asyncIterator] === 'function') result.stream = hook.wrapStream(result.stream, { model, sdkMethod, started });
      return result;
    }, (err) => { hook.recordError(err, { model, sdkMethod, started }); throw err; });
  };
  wrapped.__errorlogWrapped = true;
  proto[name] = wrapped;
  patched.push(`${prefix}${name}`);
}

const { resolveFrom } = require('../resolve');

function install(recorder, cfg) {
  const hook = new GeminiHook(recorder, cfg);
  const patched = [];
  try {
    const g = resolveFrom(cfg.root, '@google/genai');
    if (g.Models && g.Models.prototype) {
      const p = g.Models.prototype;
      patchMethod(p, 'generateContentInternal', 'generate', hook, 'models.', patched);
      patchMethod(p, 'generateContentStreamInternal', 'stream', hook, 'models.', patched);
      patchMethod(p, 'embedContentInternal', 'other', hook, 'models.', patched);
      patchMethod(p, 'countTokens', 'other', hook, 'models.', patched);
      patchMethod(p, 'computeTokens', 'other', hook, 'models.', patched);
    }
  } catch (_) { /* not installed */ }
  try {
    const o = resolveFrom(cfg.root, '@google/generative-ai');
    if (o.GenerativeModel && o.GenerativeModel.prototype) {
      const p = o.GenerativeModel.prototype;
      patchMethod(p, 'generateContent', 'legacy-generate', hook, 'legacy.', patched);
      patchMethod(p, 'generateContentStream', 'legacy-stream', hook, 'legacy.', patched);
      patchMethod(p, 'countTokens', 'other', hook, 'legacy.', patched);
      patchMethod(p, 'embedContent', 'other', hook, 'legacy.', patched);
      patchMethod(p, 'batchEmbedContents', 'other', hook, 'legacy.', patched);
    }
    if (o.ChatSession && o.ChatSession.prototype) {
      patchMethod(o.ChatSession.prototype, 'sendMessage', 'legacy-generate', hook, 'legacy.chat.', patched);
      patchMethod(o.ChatSession.prototype, 'sendMessageStream', 'legacy-stream', hook, 'legacy.chat.', patched);
    }
  } catch (_) { /* not installed */ }
  return patched;
}

module.exports = { install, GeminiHook, patchMethod, parseApiError };
