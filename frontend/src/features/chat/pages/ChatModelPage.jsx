import '@/features/analysis/styles/AnalysisPage.css';
import PromptChipsBar from '../components/PromptChipsBar';
import { fetchSecretsList, peekSecretsList } from '@/shared/api/secretsService';
import CustomPromptBuilderModal from '../components/CustomPromptBuilder/CustomPromptBuilderModal';
import {
  fetchCustomPromptGroups,
  deleteCustomPrompt,
  deleteCustomPromptGroup,
} from '../api/customPromptsService';
import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { flushSync } from 'react-dom';
import { API_BASE_URL, CHAT_MODEL_BASE_URL, SECRET_PROMPTS_API_BASE } from '@/config/apiConfig';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useSidebar } from '@/shared/context/SidebarContext';
import DownloadPdf from '@/shared/components/DownloadPdf';
import BrandingDownloadModal from '@/features/branding/components/BrandingDownloadModal';
import { downloadAsHtml, printResponse } from '@/shared/utils/responseExportUtils';
import UploadProgressPanel from '@/features/analysis/components/UploadProgressPanel';
import ChatInputArea from '@/features/analysis/components/ChatInputArea';
import ChatSessionList from '../components/ChatInterface/ChatSessionList';
import DocumentViewer from '@/features/analysis/components/DocumentViewer';
import '../styles/ChatInterface.css';
import ProgressStagesPopup from '@/features/analysis/components/ProgressStagesPopup';
import UploadOptionsMenu from '@/features/case-storage/components/UploadOptionsMenu';
import DraftingModal from '@/features/drafting/components/DraftingMode/DraftingModal';
import googleDriveApi from '@/shared/api/googleDriveApi';
import apiService from '@/shared/api/api';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '@/shared/utils/renderSecretPromptResponse';
import { convertJsonToPlainText } from '@/shared/utils/jsonToPlainText';
import {
  formatChatResponseForDisplay,
  isEmptyFormattedChatContent,
  looksLikeRawJsonString,
  chatResponseLooksLikeHtml,
} from '@/shared/utils/formatChatResponse';
import { ensureTableSeparators, normalizeMarkdownFormatting, extractTableData } from '@/shared/utils/markdownUtils';
import InteractiveTable from '@/shared/components/InteractiveTable';
import { buildSuggestedQuestions } from '../utils/suggestedQuestions';
import { notifyResponseComplete, ensureNotificationPermission } from '@/shared/utils/responseNotifier';

import { formatFileSize } from '@/shared/utils/planUtils';
import { useLlmChatLimits } from '@/shared/hooks/useLlmChatLimits';
import { formatUploadLimitExceededMessage } from '@/shared/api/llmChatLimitsService';
import { getChatModelQuotaUserMessage, parseLlmPolicyErrorForUi } from '@/shared/utils/llmQuotaMessages';
import { createQuotaError, parseQuotaHttpError } from '@/shared/utils/quotaError';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';
import { invalidateTokenQuotaCache } from '@/features/billing/api/tokenQuotaService';
import ChatQuotaErrorModal from '@/features/billing/components/ChatQuotaErrorModal';
import UpgradePlanBanner from '@/features/billing/components/UpgradePlanBanner';
import {
  Search,
  Send,
  FileText,
  Trash2,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Plus,
  AlertTriangle,
  Clock,
  Loader2,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  X,
  Eye,
  Quote,
  BookOpen,
  Copy,
  ChevronDown,
  Paperclip,
  MessageSquare,
  FileCheck,
  Bot,
  Check,
  Circle,
  CreditCard,
  Square,
  Mic,
  MicOff,
  Sparkles,
  Settings2,
  ArrowUpRight,
  Layers,
  Printer,
  Code,
} from 'lucide-react';
import LearningBubble from '../components/LearningBubble';
import TokenCostPopover from '@/features/billing/components/TokenCostPopover';
import SessionTokenBadge from '@/features/billing/components/SessionTokenBadge';
import FileTokenBadge from '@/features/billing/components/FileTokenBadge';
/**
 * Removes DeepSeek/AI thinking blocks and raw reasoning patterns from text.
 * Also holds back incomplete Markdown tables during streaming to prevent gray bars (---).
 */
function getSafeMarkdown(text) {
  if (!text) return '';
  
  // 1. Remove complete <think>...</think> or <thinking>...</thinking> blocks
  let clean = text.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '');
  
  // 2. Remove incomplete <think> block (still streaming)
  if (/<(?:think|thinking)>/i.test(clean)) {
    clean = clean.split(/<(?:think|thinking)>/i)[0];
  }
  
  // 3. Remove raw reasoning patterns (lines that look like thinking)
  // These are lines that start with "We need to", "We'll", "The user said", "So we"
  const lines = clean.split('\n');
  const filteredLines = [];
  let tableStarted = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Detect start of actual content (table or ##heading or **bold)
    if (trimmed.startsWith('|') || trimmed.startsWith('#') || trimmed.startsWith('**')) {
      tableStarted = true;
    }
    
    // Skip reasoning-like lines before actual content starts
    if (!tableStarted && (
      line.match(/^(We need|We'll|We can|We will|The user|So we|The document|Let's|I'll|I will|Based on this|This is|The output contract|The instruction)/i)
    )) {
      continue; // Skip this reasoning line
    }
    
    filteredLines.push(line);
  }
  
  clean = filteredLines.join('\n');

  // 4. Fix incomplete table rendering during streaming
  // If table is not complete (no closing row after last |), 
  // hold back incomplete table rows to prevent "---" gray bar glitches.
  const tableRegex = /\|(.+)\|/;
  if (tableRegex.test(clean)) {
    const allLines = clean.split('\n');
    const tableLines = allLines.filter(l => l.trim().startsWith('|'));
    const lastTableLine = tableLines[tableLines.length - 1];
    
    // If last line looks incomplete (no ending |), remove it from the display
    if (lastTableLine && !lastTableLine.trim().endsWith('|')) {
      const lastIndex = clean.lastIndexOf(lastTableLine);
      clean = clean.substring(0, lastIndex);
    }
  }
  
  return clean.trim();
}

// ─── Unified O(n) Markdown Parser ────────────────────────────────────────────
// Rules guaranteed by this implementation:
//   Rule 1: Never re-parse the whole string on every chunk — rAF throttle controls parse cadence
//   Rule 2: Chunks append to a plain ref, no setState on each token
//   Rule 3: ONE parser for both streaming and final — byte-identical HTML, no visual jump
//   Rule 4: DOM writes capped to ~12/sec via rAF + 80ms throttle
//
// Fix PDF extraction artifacts: number fragments produced when a PDF stores digits
// at absolute coordinates get spaces inserted between them by the extractor.
// e.g. "201 6" → "2016", "100 72" → "10072", "200 3" → "2003".
// Word-level fragmentation ("FACT UAL MAT RI X") is corrected upstream by DeepSeek
// via the rendering contract instruction — we only handle numbers here since the
// frontend cannot reconstruct correct word boundaries without language knowledge.
// Skips fenced code blocks to avoid corrupting code samples.
function normalizePdfText(text) {
  if (!text) return text;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // inside a fenced code block — leave verbatim
    return part
      // Merge a 2-4 digit prefix + 1-2 digit suffix into a single number.
      // Catches year fragments ("201 6" → "2016") and case-number fragments ("100 72" → "10072").
      // The right fragment must be ≤2 digits to stay conservative and avoid
      // accidentally joining two genuinely separate numbers (e.g. "Section 10 20").
      .replace(/\b(\d{2,4}) (\d{1,2})\b/g, (m, a, b) => {
        const merged = a + b;
        return merged.length <= 6 ? merged : m;
      });
  }).join('');
}

// Handles: headings, bold/italic/bold-italic, inline code, fenced code blocks,
// links, blockquotes, HR, ordered/unordered lists, GFM tables (with escaped pipes).
// Mid-stream incomplete table rows fall through to <p> and snap into the table
// on the next parse — no broken markup ever emitted.
function parseMarkdown(md) {
  if (!md || typeof md !== 'string') return '';
  md = ensureTableSeparators(normalizeMarkdownFormatting(normalizePdfText(md)));

  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // inline() escapes first, then applies formatting so injected < > & are safe.
  // Attribute-free formatting tags are then re-allowed: convertMarkdownMarkers
  // (inside normalizeMarkdownFormatting) intentionally emits <strong>/<em>, and
  // models occasionally emit them too — without this they render as literal tags.
  const inline = (s) =>
    esc(s)
      .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
      .replace(/&lt;(?:strong|b)&gt;([\s\S]*?)&lt;\/(?:strong|b)&gt;/gi, '<strong>$1</strong>')
      .replace(/&lt;(?:em|i)&gt;([\s\S]*?)&lt;\/(?:em|i)&gt;/gi, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0f766e;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;font-weight:600;background:#e6fbf9;padding:0 4px;border-radius:4px">$1</a>')
      .replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^\n]+?)\*\*(?!\*)/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`\n]+?)`/g, '<code>$1</code>');

  const splitRow = (row) => {
    const cells = []; let cur = '';
    const inner = row.replace(/^\||\|$/g, '');
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i++; }
      else if (inner[i] === '|') { cells.push(cur); cur = ''; }
      else cur += inner[i];
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const lines = md.split('\n');
  const out = [];
  let inTable = false, hasHead = false;
  let inList = false, listTag = null;
  let inCode = false, codeBuf = [], codeLang = '';

  const endList  = () => { if (inList)  { out.push(`</${listTag}>`); inList = false; listTag = null; } };
  const endTable = () => { if (inTable) { out.push('</tbody></table></div>'); inTable = false; hasHead = false; } };
  const flushCode = () => {
    out.push(
      `<pre class="md-pre"${codeLang ? ` data-lang="${esc(codeLang)}"` : ''}><code>${esc(codeBuf.join('\n'))}</code></pre>`
    );
    inCode = false; codeBuf = []; codeLang = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t   = raw.trim();

    // Fenced code — highest priority, captures everything verbatim inside
    const fence = t.match(/^```(.*)$/);
    if (fence) {
      if (inCode) { flushCode(); }
      else { endList(); endTable(); inCode = true; codeLang = fence[1].trim(); }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    if (!t) { endList(); endTable(); continue; }

    // Horizontal rule
    if (/^([-*_]\s*){3,}$/.test(t)) { endList(); endTable(); out.push('<hr/>'); continue; }

    // Heading
    const h = t.match(/^(#{1,6})\s+(.+)/);
    if (h) { endList(); endTable(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    // Blockquote
    if (/^>\s?/.test(t)) {
      endList(); endTable();
      out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // Table separator — triggers thead→tbody transition, then skipped.
    // Accepts both "|---|---|" (standard) and "---|---" (no wrapping pipes).
    if (/^\|?[\s:|-]+\|?$/.test(t) && t.includes('-') && (t.includes('|') || inTable)) {
      if (inTable && !hasHead) { out.push('</thead><tbody>'); hasHead = true; }
      continue;
    }

    // Table row — DeepSeek sometimes omits the leading/trailing |.
    // Detect any line that contains ≥2 pipe characters, OR starts with | and has one more.
    // Guard: must not be a heading, list item, or HR (already handled above).
    const pipeCount = (t.match(/\|/g) || []).length;
    const isTableRow = (t.startsWith('|') && pipeCount >= 2) || pipeCount >= 3;
    if (isTableRow) {
      endList();
      if (!inTable) { out.push('<div class="md-table-scroll"><table><thead>'); inTable = true; hasHead = false; }
      const tag = hasHead ? 'td' : 'th';
      // Normalise: wrap in pipes if missing so splitRow works correctly
      const normalised = t.startsWith('|') ? t : `|${t}|`;
      out.push(`<tr>${splitRow(normalised).map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      continue;
    }
    if (inTable) endTable();

    // Unordered list
    if (/^[-*+]\s+/.test(t)) {
      if (listTag !== 'ul') { endList(); out.push('<ul>'); inList = true; listTag = 'ul'; }
      out.push(`<li>${inline(t.replace(/^[-*+]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    const ol = t.match(/^(\d+)[.)]\s+(.+)/);
    if (ol) {
      if (listTag !== 'ol') { endList(); out.push('<ol>'); inList = true; listTag = 'ol'; }
      out.push(`<li>${inline(ol[2])}</li>`);
      continue;
    }

    endList();
    out.push(`<p>${inline(t)}</p>`);
  }

  if (inCode) flushCode();
  endList();
  endTable();
  return out.join('\n');
}

// ─── Stable-split finder ─────────────────────────────────────────────────────
// Returns the char index at which the buffer can be split into a stable
// (already-complete) prefix and a live (still-growing) suffix.
//
// IMPORTANT: Only split on \n\n (double newline) to guarantee table integrity.
// Splitting on a single \n mid-table causes parseMarkdown to emit the separator
// row ":---" as a real <td> cell. The live tail is bounded separately in tick().
//
// When the live tail grows past TAIL_PROMOTE without a \n\n (long tables have
// none), it is force-promoted into the stable cache at a single-newline cut so
// per-frame parsing stays bounded and the WHOLE answer stays visible — nothing
// is ever hidden or truncated. A mid-table promote renders as two table chunks
// during the stream; the final render re-parses the full text correctly.
const TAIL_PROMOTE = 6000; // chars — live tail beyond this is promoted to stable

// Chunked final rendering: segment size parsed per tick. Segments split only at
// \n\n boundaries (code-fence aware), so every segment parses correctly.
const FINAL_SEGMENT_CHARS = 24000;
const FINAL_SYNC_LIMIT = 8000; // below this, parse synchronously (no flicker)

/** Split markdown into independently-parseable segments at \n\n boundaries. */
function splitMarkdownSegments(text, target = FINAL_SEGMENT_CHARS) {
  const segs = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= target * 1.5) {
      segs.push(text.slice(start));
      break;
    }
    let cut = text.lastIndexOf('\n\n', start + target);
    if (cut <= start) cut = text.indexOf('\n\n', start + target);
    if (cut === -1 || cut <= start) {
      segs.push(text.slice(start));
      break;
    }
    // Never split inside an open ``` fence — extend to after it closes.
    const fences = (text.slice(start, cut).match(/^```/gm) || []).length;
    if (fences % 2 === 1) {
      const close = text.indexOf('\n```', cut);
      cut = close === -1 ? -1 : text.indexOf('\n\n', close + 4);
      if (cut === -1 || cut <= start) {
        segs.push(text.slice(start));
        break;
      }
    }
    segs.push(text.slice(start, cut));
    start = cut;
  }
  return segs;
}

function findStableSplit(text) {
  const idx = text.lastIndexOf('\n\n');
  if (idx >= 0) {
    const before = text.substring(0, idx);
    const fences = (before.match(/^```/gm) || []).length;
    if (fences % 2 === 0) return idx;
    const openFence = before.lastIndexOf('\n```');
    const fallbackIdx = openFence > 0 ? before.lastIndexOf('\n\n', openFence) : -1;
    if (fallbackIdx >= 0) return fallbackIdx;
  }
  return -1;
}

// Blinking caret appended at the end of the streamed text (Claude-style).
// Injected inside the last inline-capable block so it sits right after the
// last visible character instead of dropping to its own line.
const STREAM_CARET_HTML = '<span class="stream-caret" aria-hidden="true"></span>';

function injectStreamCaret(html) {
  const m = html.match(/<\/(p|li|h[1-6]|td|blockquote)>\s*$/);
  if (m) return html.slice(0, m.index) + STREAM_CARET_HTML + html.slice(m.index);
  return html + STREAM_CARET_HTML;
}

const StreamingMarkdown = React.memo(
  function StreamingMarkdown({ bufferRef, scrollTargetRef }) {
    const containerRef  = useRef(null);
    const revealLenRef  = useRef(0);
    const prevHtmlRef   = useRef('');
    const stableEndRef  = useRef(0);
    const stableHtmlRef = useRef('');

    useEffect(() => {
      let rafId;

      const scheduleScroll = () => {
        requestAnimationFrame(() => {
          const sc = scrollTargetRef?.current;
          if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 400) {
            sc.scrollTop = sc.scrollHeight;
          }
        });
      };

      function tick() {
        rafId = requestAnimationFrame(tick);
        const el = containerRef.current;
        if (!el) return;

        const full = bufferRef.current || '';
        const target = full.length;
        if (revealLenRef.current >= target) return;

        // Claude-style smooth reveal: instead of dumping each network burst
        // into the DOM at once, drip characters out at a steady rate that
        // adapts to the backlog — a few chars/frame when caught up, faster
        // when chunks arrive in bursts. Runs at native rAF (~60 FPS).
        const backlog = target - revealLenRef.current;
        const step = Math.max(2, Math.ceil(backlog / 24));
        revealLenRef.current = Math.min(target, revealLenRef.current + step);
        const cur = full.substring(0, revealLenRef.current);

        // 1) Grow the stable cache at the last \n\n boundary (never re-parse
        //    old text; code-fence aware so a fence never splits).
        const split = findStableSplit(cur);
        if (split > stableEndRef.current) {
          stableHtmlRef.current += parseMarkdown(cur.substring(stableEndRef.current, split));
          stableEndRef.current = split;
        }

        // 2) Bound the live tail. Long tables/paragraphs have no \n\n, so the
        //    tail can grow without limit — promote it into the stable cache at
        //    a single-newline cut (or a hard cut for one mega-line). Every
        //    character stays visible; per-frame parse work stays small.
        let tail = cur.substring(stableEndRef.current);
        if (tail.length > TAIL_PROMOTE) {
          let cut = tail.lastIndexOf('\n');
          if (cut < TAIL_PROMOTE / 2) cut = tail.length - 800;
          stableHtmlRef.current += parseMarkdown(tail.substring(0, cut));
          stableEndRef.current += cut;
          tail = cur.substring(stableEndRef.current);
        }

        const html = stableHtmlRef.current + parseMarkdown(tail);
        if (html === prevHtmlRef.current) return;
        prevHtmlRef.current = html;
        el.innerHTML = injectStreamCaret(html);

        scheduleScroll();
      }

      rafId = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(rafId);
        // Flush everything not yet revealed on unmount so the last segment is
        // never dropped when switching to the final renderer. Only the part
        // after the stable cache is parsed here — bounded even for huge answers.
        const el = containerRef.current;
        const full = bufferRef.current || '';
        if (el && full) {
          el.innerHTML =
            stableHtmlRef.current + parseMarkdown(full.substring(stableEndRef.current));
          revealLenRef.current = full.length;
        }
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div
        ref={containerRef}
        className="formatted-assistant-markdown stream-active"
      />
    );
  },
  () => true, // never re-render from props — rAF loop owns the DOM
);

// ─── Final renderer (same parser, chunked + non-blocking) ─────────────────────
// Uses parseMarkdown — byte-identical output to StreamingMarkdown, so the
// transition at stream end is invisible. Long answers are parsed segment by
// segment across timeout ticks: the COMPLETE text always renders (never capped
// or truncated) and the main thread never freezes, no matter the answer size.
const FinalMarkdown = React.memo(
  function FinalMarkdown({ text }) {
    const containerRef = React.useRef(null);
    React.useEffect(() => {
      const el = containerRef.current;
      if (!el) return undefined;
      const t = text || '';
      if (!t) {
        el.innerHTML = '';
        return undefined;
      }
      if (t.length <= FINAL_SYNC_LIMIT) {
        el.innerHTML = parseMarkdown(t);
        return undefined;
      }
      // Chunked render: append one parsed segment per tick until the whole
      // answer is in the DOM. Cancelled cleanly if the text changes/unmounts.
      el.innerHTML = '';
      const segments = splitMarkdownSegments(t);
      let index = 0;
      let timer = null;
      let cancelled = false;
      const step = () => {
        if (cancelled) return;
        const node = containerRef.current;
        if (!node) return;
        node.insertAdjacentHTML('beforeend', parseMarkdown(segments[index]));
        index += 1;
        if (index < segments.length) timer = setTimeout(step, 0);
      };
      timer = setTimeout(step, 0);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [text]);
    return <div ref={containerRef} className="formatted-assistant-markdown" />;
  },
  (a, b) => a.text === b.text,
);

/** Wrap legacy HTML tables so wide matrices scroll instead of clipping. */
function wrapBareHtmlTables(html) {
  if (!html || typeof html !== 'string' || !/<table[\s>]/i.test(html)) return html;
  if (/md-table-scroll/i.test(html)) return html;
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (block) =>
    `<div class="md-table-scroll">${block}</div>`
  );
}

/** Renders a list of sources with links. */
const SourcesSection = React.memo(function SourcesSection({ sources }) {
  if (!sources || !Array.isArray(sources) || sources.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-[#21C1B6]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Verified Court Judgments</span>
      </div>
      <div className="flex flex-col gap-2">
        {sources.map((source, idx) => (
          <a
            key={idx}
            href={source.url || source.uri || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between group px-3 py-2.5 text-sm font-semibold text-[#0f766e] bg-[#f0fdfa] border border-[#b2f5ea] rounded-xl hover:bg-[#e6fbf9] hover:border-[#21C1B6] transition-all"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-[#21C1B6]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#21C1B6]/20 transition-colors">
                <FileText size={12} className="text-[#21C1B6]" />
              </div>
              <span className="truncate">{source.title || source.name || `Judgment ${idx + 1}`}</span>
            </div>
            <ArrowUpRight size={14} className="shrink-0 text-[#21C1B6] opacity-50 group-hover:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
});

/**
 * Styled card wrapper for a single judgment section.
 * Extracts the case name from the "## Similar Judgment:" header, renders it as a
 * pill label + title above the card, and shows the body content inside the card.
 * A verified source link badge is appended at the bottom when available.
 */
const JudgmentCard = React.memo(function JudgmentCard({ sectionText, source }) {
  // Extract case name and body from the section
  const HEADER_RE = /^\n?(?:##\s+|\*\*)?Similar Judgment:\s*\*?([^*\n]+?)\*?(?:\*\*)?\n([\s\S]*)/i;
  const headerMatch = sectionText.match(HEADER_RE);
  const caseName = headerMatch ? headerMatch[1].trim() : '';

  // Replace any URL_NOT_FOUND placeholder in body with a real Indian Kanoon search URL
  const ikanoonSearch = (name) =>
    `https://indiankanoon.org/search/?formInput=${encodeURIComponent(name)}`;
  const rawBody = headerMatch ? headerMatch[2].trim() : sectionText.trim();
  const body = rawBody.replace(
    /\(URL_NOT_FOUND\)/gi,
    `(${ikanoonSearch(caseName)})`
  ).replace(
    /URL_NOT_FOUND/gi,
    ikanoonSearch(caseName)
  );

  // Check if the body already contains a real source link so we don't double-show the badge
  const bodyHasLink = /indiankanoon\.org|sci\.gov\.in/i.test(body);

  return (
    <div className="mb-5">
      {/* Card header label + case name */}
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#21C1B6]/10 text-[#21C1B6] rounded-full">
          Similar Judgment
        </span>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Case name title bar */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70">
          <p className="text-[15px] font-bold text-gray-800 leading-snug">{caseName || 'Judgment'}</p>
        </div>
        {/* Body content */}
        <div className="px-4 py-3 prose prose-sm prose-gray max-w-none
          [&_strong]:text-gray-800
          [&_h3]:text-[13px] [&_h3]:font-bold [&_h3]:text-gray-700 [&_h3]:mt-3 [&_h3]:mb-1
          [&_blockquote]:border-l-4 [&_blockquote]:border-[#21C1B6]/40 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-2
          [&_ul]:my-1 [&_li]:my-0.5
          [&_a]:text-[#0f766e] [&_a]:font-semibold [&_a]:underline">
          <FinalMarkdown text={body} />
        </div>
        {/* Source badge — shown when body has no inline link; always has a working URL */}
        {!bodyHasLink && (() => {
          const href =
            (source?.url && source.url !== 'URL_NOT_FOUND' ? source.url : null) ||
            (source?.uri && source.uri !== 'URL_NOT_FOUND' ? source.uri : null) ||
            ikanoonSearch(caseName);
          const domainLabel = (() => {
            try {
              const d = new URL(href).hostname.replace('www.', '');
              if (d.includes('indiankanoon')) return 'Indian Kanoon';
              if (d.includes('casemine')) return 'CaseMine';
              if (d.includes('sci.gov') || d.includes('judis.nic') || d.includes('supremecourt')) return 'Supreme Court of India';
              if (d.includes('ecourts')) return 'eCourts India';
              if (d.endsWith('.gov.in') || d.endsWith('.nic.in')) return 'Govt. Court Portal';
              return 'Indian Kanoon'; // fallback label for search URLs
            } catch { return 'Indian Kanoon'; }
          })();
          return (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#0f766e] bg-[#f0fdfa] border border-[#b2f5ea] rounded-lg hover:bg-[#e6fbf9] hover:border-[#21C1B6] transition-all"
              >
                <FileText size={11} className="text-[#21C1B6]" />
                <span>{source?.title || caseName}</span>
                <span className="text-[10px] text-[#21C1B6]/70 font-normal">— {domainLabel}</span>
                <ArrowUpRight size={11} className="text-[#21C1B6] opacity-60" />
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

/** Strip tool_code / thought markdown blocks that Gemini may emit as plain text. */
function cleanJudgmentText(text) {
  if (!text || typeof text !== 'string') return text;
  // Remove "tool_code\nprint(google_search.search(...))\n" blocks
  let out = text.replace(/\btool_code\s*\nprint\([\s\S]*?\)\s*\n/g, '');
  // Remove standalone "tool_code" line + following code block up to next blank line
  out = out.replace(/^\s*tool_code\s*\n[\s\S]*?\n\n/gm, '');
  // Remove "thought\n<paragraph(s)>\n\n" where the paragraph doesn't start a judgment section
  out = out.replace(/^\s*thought\s*\n((?!##|\*\*Similar Judgment)[\s\S])*?\n\n/gm, '');
  return out.trim();
}

/**
 * Split judgment-search text into sections at "Similar Judgment:" markers.
 * Handles "## Similar Judgment:" (H2) and "**Similar Judgment:**" (bold).
 * When sources are available each section is matched to one; sections without a
 * matching source get the next unassigned source sequentially.
 * Returns null when the text contains no judgment sections at all.
 */
function splitIntoJudgmentSections(text, sources) {
  // Match: newline + optional "## " or "**" + "Similar Judgment:"
  const SPLIT_RE = /(?=\n(?:##\s+|\*\*)?Similar Judgment:)/gi;
  const parts = text.split(SPLIT_RE);
  if (parts.length <= 1) return null; // no judgment sections — fall through

  const safeSources = Array.isArray(sources) ? sources : [];
  const intro = parts[0];
  const matchedSourceIds = new Set();

  // Extract case name from any heading style:
  //   ## Similar Judgment: Case Name
  //   **Similar Judgment: Case Name**   ← what the model usually outputs
  //   Similar Judgment: Case Name
  const CASE_NAME_RE = /(?:##\s+|\*\*)?Similar Judgment:\s*\*?([^*\n]+?)\*?(?:\*\*)?(?:\n|$)/i;

  const judgments = parts.slice(1).map((section) => {
    const headerMatch = section.match(CASE_NAME_RE);
    const caseName = (headerMatch ? headerMatch[1].trim() : '').toLowerCase();

    let source = null;
    if (caseName && safeSources.length) {
      source = safeSources.find((s, idx) => {
        if (matchedSourceIds.has(idx)) return false;
        const st = (s.title || '').toLowerCase();
        const baseSt = st.split('(')[0].trim();
        const baseCn = caseName.split('(')[0].trim();
        return st.includes(baseCn) || baseSt.includes(baseCn) || baseCn.includes(baseSt);
      }) || null;
      if (source) matchedSourceIds.add(safeSources.indexOf(source));
    }

    // Sequential fallback: assign next unmatched source so every section gets one
    if (!source && safeSources.length) {
      const firstUnmatched = safeSources.findIndex((_, idx) => !matchedSourceIds.has(idx));
      if (firstUnmatched !== -1) {
        source = safeSources[firstUnmatched];
        matchedSourceIds.add(firstUnmatched);
      }
    }

    return { text: section, source };
  });

  const unmatchedSources = safeSources.filter((_, idx) => !matchedSourceIds.has(idx));
  return { intro, judgments, unmatchedSources };
}

/** Renders full secret-prompt HTML or markdown via FinalMarkdown (never hybrid HTML+md). */
const AssistantMessageBody = React.memo(
  function AssistantMessageBody({ content, sources }) {
    if (!content) return null;

    // When the response contains multiple judgment sections, render each with its
    // own source link immediately after the section (instead of one grouped block).
    if (!chatResponseLooksLikeHtml(content)) {
      const cleaned = cleanJudgmentText(content);
      const sections = splitIntoJudgmentSections(cleaned, sources);
      if (sections) {
        return (
          <div className="flex flex-col">
            {sections.intro && (
              <div className="mb-4">
                <FinalMarkdown text={sections.intro} />
              </div>
            )}
            {sections.judgments.map((j, idx) => (
              <JudgmentCard key={idx} sectionText={j.text} source={j.source} />
            ))}
            {sections.unmatchedSources.length > 0 && (
              <SourcesSection sources={sections.unmatchedSources} />
            )}
          </div>
        );
      }
    }

    if (chatResponseLooksLikeHtml(content)) {
      return (
        <div className="flex flex-col">
          <div
            className="formatted-assistant-markdown formatted-assistant-html"
            dangerouslySetInnerHTML={{ __html: wrapBareHtmlTables(content) }}
          />
          <SourcesSection sources={sources} />
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        <FinalMarkdown text={cleanJudgmentText(content)} />
        <SourcesSection sources={sources} />
      </div>
    );
  },
  (a, b) => a.content === b.content && JSON.stringify(a.sources) === JSON.stringify(b.sources),
);

// ── Gemini-style typing dots — shown while waiting for first token ───────────
const TypingDots = React.memo(function TypingDots() {
  return (
    <div className="typing-dots" aria-label="Generating response…">
      <span />
      <span />
      <span />
    </div>
  );
});

const PROGRESS_STAGES = {
  INIT: { range: [0, 15], label: 'Initialization' },
  EXTRACT: { range: [15, 45], label: 'Text Extraction' },
  CHUNK: { range: [45, 62], label: 'Chunking' },
  EMBED: { range: [62, 78], label: 'Embeddings' },
  STORE: { range: [78, 90], label: 'Database Storage' },
  SUMMARY: { range: [90, 95], label: 'Summary Generation' },
  FINAL: { range: [95, 100], label: 'Finalization' },
};

const STAGE_COLORS = {
  INIT: 'from-blue-200 to-blue-400',
  EXTRACT: 'from-blue-300 to-blue-500',
  CHUNK: 'from-blue-400 to-blue-600',
  EMBED: 'from-blue-500 to-blue-700',
  STORE: 'from-blue-600 to-blue-800',
  SUMMARY: 'from-blue-700 to-blue-900',
  FINAL: 'from-blue-800 to-blue-950',
};

const getCurrentStage = (progress) => {
  for (const [key, stage] of Object.entries(PROGRESS_STAGES)) {
    if (progress >= stage.range[0] && progress < stage.range[1]) {
      return key;
    }
  }
  return 'FINAL';
};

const getStageColor = (progress) => {
  const stageKey = getCurrentStage(progress);
  return STAGE_COLORS[stageKey] || 'from-blue-500 to-blue-700';
};

const getStageStatus = (stageKey, progress) => {
  const stage = PROGRESS_STAGES[stageKey];
  if (progress >= stage.range[1]) return 'completed';
  if (progress >= stage.range[0] && progress < stage.range[1]) return 'active';
  return 'pending';
};

const RealTimeProgressPanel = ({ processingStatus }) => {
  if (!processingStatus || !['processing', 'batch_processing', 'error'].includes(processingStatus.status)) return null;

  const progress = processingStatus.processing_progress || 0;
  const isError = processingStatus.status === 'error';
  const isBatch = processingStatus.status === 'batch_processing';

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getSubProgress = () => {
    if (processingStatus.embeddings_generated !== undefined && processingStatus.embeddings_total !== undefined) {
      return `${processingStatus.embeddings_generated}/${processingStatus.embeddings_total} embeddings`;
    }
    if (processingStatus.chunks_saved !== undefined) {
      return `${processingStatus.chunks_saved} chunks saved`;
    }
    if (processingStatus.estimated_pages !== undefined) {
      return `Estimated ${processingStatus.estimated_pages} pages`;
    }
    return null;
  };

  const subProgress = getSubProgress();

  return (
    <div className="fixed top-4 left-1/2 z-50 transform -translate-x-1/2">
      <div
        className={`bg-white rounded-lg shadow-xl p-4 w-80 border-2 max-w-sm transition-all duration-300 ${
          isError
            ? 'border-red-200 animate-pulse'
            : isBatch
            ? 'border-yellow-200'
            : 'border-blue-200'
        }`}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-semibold text-gray-900 flex items-center">
            {isError ? (
              <AlertTriangle className="h-4 w-4 text-red-500 mr-1.5 animate-pulse" />
            ) : isBatch ? (
              <FileText className="h-4 w-4 text-yellow-500 mr-1.5" />
            ) : (
              <Loader2 className="h-4 w-4 text-blue-500 mr-1.5 animate-spin" />
            )}
            {isError ? 'Processing Error' : isBatch ? 'Batch Processing' : 'Document Processing'}
          </h3>
        </div>
        {isError ? (
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3 animate-pulse" />
            <p className="text-red-700 text-xs mb-3 font-medium">
              {(typeof processingStatus.job_error === 'string' ? processingStatus.job_error : null) || 'An error occurred during processing'}
            </p>
            <p className="text-xs text-gray-500">Last updated: {formatDate(processingStatus.last_updated)}</p>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                <span>Progress</span>
                <span className="font-semibold text-blue-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden relative">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ease-out relative overflow-hidden bg-gradient-to-r ${getStageColor(
                    progress
                  )}`}
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <p className="text-xs text-gray-700 font-medium bg-blue-50 p-1.5 rounded text-blue-800 break-words">
                {processingStatus.current_operation || 'Processing document...'}
              </p>
              {subProgress && (
                <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">{subProgress}</p>
              )}
            </div>
            <div className="space-y-1.5 mb-3">
              {Object.entries(PROGRESS_STAGES).map(([key, { label }]) => {
                const status = getStageStatus(key, progress);
                return (
                  <div
                    key={key}
                    className={`flex items-center space-x-2 py-0.5 transition-all duration-300 ${
                      status === 'completed'
                        ? 'opacity-100'
                        : status === 'active'
                        ? 'opacity-100'
                        : 'opacity-50'
                    }`}
                  >
                    {status === 'completed' ? (
                      <Check className="h-3 w-3 text-green-500 animate-pulse" />
                    ) : status === 'active' ? (
                      <Loader2 className="h-3 w-3 text-[#21C1B6] animate-spin" />
                    ) : (
                      <Circle className="h-3 w-3 text-gray-300" />
                    )}
                    <span
                      className={`text-xs font-medium transition-colors ${
                        status === 'completed'
                          ? 'text-green-600'
                          : status === 'active'
                          ? 'text-[#21C1B6] font-semibold'
                          : 'text-gray-400'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
            {processingStatus.chunk_count > 0 && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <FileText className="h-3 w-3 mr-1 text-gray-500" />
                {processingStatus.chunk_count} chunks created
              </p>
            )}
            {processingStatus.chunking_method && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <BookOpen className="h-3 w-3 mr-1 text-gray-500" />
                Method: {processingStatus.chunking_method}
              </p>
            )}
            <p className="text-xs text-gray-400 flex items-center">
              <Clock className="h-3 w-3 mr-1" />
              Last updated: {formatDate(processingStatus.last_updated)}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const CHAT_INPUT_MIN_HEIGHT = 24;
const CHAT_INPUT_MAX_HEIGHT = 200;

const BUILTIN_PROMPT_CHIPS = [
  { id: 'citation-search-chip', name: 'Citation Search', isCitation: true },
  { id: 'drafting-mode-chip', name: 'Drafting Mode', isDrafting: true },
];

const BUILTIN_PROMPT_NAMES = new Set(
  BUILTIN_PROMPT_CHIPS.map((c) => c.name.trim().toLowerCase()),
);

const isDraftingPromptChip = (secret) =>
  Boolean(secret?.isDrafting) ||
  String(secret?.name || '').trim().toLowerCase() === 'drafting mode';

const ChatModelPage = () => {
  const location = useLocation();
  const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
  const { setIsSidebarHidden, setIsSidebarCollapsed } = useSidebar();
  const navigate = useNavigate();

  const { maxUploadBytes, maxUploadMbLabel, loading: limitsLoading, error: limitsError, limits, refresh: refreshLimits } = useLlmChatLimits();
  const { showQuotaError } = useTokenQuota();

  /** All file UUIDs attached in this session (multi-doc chat). Primary id is fileId / first entry. */
  const chatAttachmentFileIdsRef = useRef([]);

  const [activeDropdown, setActiveDropdown] = useState('Custom Query');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [fileSizeLimitError, setFileSizeLimitError] = useState(null);

  const [documentData, setDocumentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [currentResponse, setCurrentResponse] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState('');
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showAllChats, setShowAllChats] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [learningModeActive, setLearningModeActive] = useState(false);
  // Chat mode dropdown in the input box: 'chat' (default) | 'citation' (web-search judgement finder)
  const [chatMode, setChatMode] = useState('chat');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const citationMode = chatMode === 'citation';
  // Drafting Mode — specialized template-driven drafting pipeline; opens a
  // dedicated modal and only runs when the user explicitly triggers it here.
  const [showDraftingModal, setShowDraftingModal] = useState(false);
  const openDraftingMode = useCallback(() => {
    setShowDraftingModal(true);
    setChatMode('chat');
    setLearningModeActive(false);
    setIsSecretPromptSelected(false);
    setActiveDropdown('Custom Query');
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setShowStyleDropdown(false);
  }, []);
  const [turnCount, setTurnCount] = useState(0);
  const [turnThreshold, setTurnThreshold] = useState(4);

  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [customPromptGroups, setCustomPromptGroups] = useState([]);
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);
  const promptChips = useMemo(
    () => [
      ...BUILTIN_PROMPT_CHIPS,
      ...secrets.filter(
        (s) => !BUILTIN_PROMPT_NAMES.has(String(s?.name || '').trim().toLowerCase()),
      ),
    ],
    [secrets],
  );
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);

  const [batchUploads, setBatchUploads] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [showInsufficientFundsAlert, setShowInsufficientFundsAlert] = useState(false);
  const [activePollingFiles, setActivePollingFiles] = useState(new Set());

  const [processingStatus, setProcessingStatus] = useState(null);
  const [progressPercentage, setProgressPercentage] = useState(0);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFileId, setUploadedFileId] = useState(null);
  const [isChatUploading, setIsChatUploading] = useState(false);
 
  const [streamingStatus, setStreamingStatus] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState('');
  // True once the first visible answer token has arrived — until then we show only
  // a Gemini-style 3-dot loader (no empty assistant box).
  const [streamStarted, setStreamStarted] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [processingTimeline, setProcessingTimeline] = useState([]);
  const [showProcessingTimeline, setShowProcessingTimeline] = useState(true);
  const [reasoningText, setReasoningText] = useState('');
  const [showReasoning, setShowReasoning] = useState(true);
 
  const [chatModelFiles, setChatModelFiles] = useState([]);
  const [chatModelHistory, setChatModelHistory] = useState([]);

  // Gemini Context Caching States
  const [useCache, setUseCache] = useState(false);
  const [cacheSessionData, setCacheSessionData] = useState(null);
  const [isInitializingCache, setIsInitializingCache] = useState(false);

  // Cumulative token usage for the current session (non-cached path)
  const [sessionTokenUsage, setSessionTokenUsage] = useState({ inputTokens: 0, outputTokens: 0, totalTokens: 0, modelName: '' });

  // Document token count — populated immediately after upload via free countTokens API
  const [fileTokenCount, setFileTokenCount] = useState({ totalTokens: 0, modelName: '', mimeType: null, filename: null, isLoading: false, error: null });

  const handleInitializeCache = async () => {
    if (!fileId) return null;
    setIsInitializingCache(true);
    setError(null);
    try {
      const res = await apiService.createGeminiCache({
        file_id: fileId,
        displayName: documentData?.originalName || documentData?.name || 'Legal Chat Cache',
        modelName: 'gemini-2.5-flash',
        customSessionId: sessionId
      });
      if (res && res.success && res.data) {
        setCacheSessionData(res.data);
        setUseCache(true);
        setSuccess('Gemini Context Cache initialized successfully!');
        return res.data; // return so callers can use it immediately without waiting for state
      }
      return null;
    } catch (err) {
      console.error('[handleInitializeCache] Error:', err);
      setError('Failed to initialize context cache: ' + err.message);
      return null;
    } finally {
      setIsInitializingCache(false);
    }
  };

  // When active document changes: reset cache state (cache is created lazily on first prompt)
  useEffect(() => {
    if (fileId) {
      setUseCache(true);
      setCacheSessionData(null);
      // Count document tokens immediately (free, non-generating call)
      countDocumentTokens(fileId);
    } else {
      setUseCache(false);
      setCacheSessionData(null);
      setFileTokenCount({ totalTokens: 0, modelName: '', mimeType: null, filename: null, isLoading: false, error: null });
    }
  }, [fileId]);

  // Keep cache cost/token UI in sync (poll only while a session exists and is active)
  useEffect(() => {
    if (!fileId || !useCache) return undefined;

    let cancelled = false;
    const refreshCacheStatus = async () => {
      try {
        const res = await apiService.getGeminiCacheFileStatus(fileId);
        if (cancelled || !res?.success || !res.data) return;
        const data = res.data;
        if (data.status === 'NO_SESSION') return;
        setCacheSessionData(data);
      } catch (err) {
        console.warn('[ChatModelPage] cache status poll failed:', err.message);
      }
    };

    refreshCacheStatus();
    // Poll every 5s while active; once deleted/expired the popover handles live time locally
    const intervalId = setInterval(refreshCacheStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [fileId, useCache]);

  // Call countTokens API immediately after a file is attached — mirrors Google AI Studio
  const countDocumentTokens = async (fid) => {
    if (!fid) return;
    setFileTokenCount((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const res = await apiService.countFileTokens(fid, 'gemini-2.5-pro');
      if (res && res.success && res.data) {
        setFileTokenCount({
          totalTokens: res.data.totalTokens || 0,
          modelName: res.data.modelName || 'gemini-2.5-pro',
          mimeType: res.data.mimeType || null,
          filename: res.data.filename || null,
          isLoading: false,
          error: null,
        });
      }
    } catch (err) {
      console.warn('[countDocumentTokens] Token count failed (non-critical):', err.message);
      setFileTokenCount((prev) => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  // Sessions list for the sidebar panel (ChatGPT-style)
  const [chatSessions, setChatSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [chatHistorySidebarOpen, setChatHistorySidebarOpen] = useState(true);
  const [showWelcomeHistory, setShowWelcomeHistory] = useState(false);

  /** Messages for the active session only (UI + viewer; `messages` may hold mixed sessions from restore). */
  const sessionMessages = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    if (sessionId) {
      const matched = messages.filter(
        (m) => m.session_id != null && String(m.session_id) === String(sessionId)
      );
      if (matched.length > 0) return matched;
    }

    // Fallback for fresh streams before session_id is attached on metadata/done.
    const pendingWithoutSession = messages.filter((m) => m.session_id == null);
    if (pendingWithoutSession.length > 0) return pendingWithoutSession;

    return [];
  }, [messages, sessionId]);

  const isChatActive =
    sessionMessages.length > 0 ||
    hasResponse ||
    !!pendingQuestion ||
    isLoading ||
    isGeneratingInsights;

  const fileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const styleDropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  // Per-message rendered-body DOM nodes — used by the response download/export
  // toolbar (PDF / Word / HTML / Print), same UX as the AnalysisPage response panel.
  const messageBodyRefs = useRef({});
  const downloadTargetRef = useRef(null);
  const [responseDownloadModal, setResponseDownloadModal] = useState(null); // 'pdf' | 'word' | null
  const exportContentRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamUiRafRef = useRef(null);
  const reasoningBufferRef = useRef('');
  const reasoningUiRafRef = useRef(null);
  const streamReaderRef = useRef(null);
  const assistantDisplayCacheRef = useRef(new Map());
  // Guards against calling setStreamingStatus('generating') on every chunk due
  // to the stale closure problem.  Reset to false at the start of each request.
  const streamingGeneratingFiredRef = useRef(false);

  // Incremented whenever streamBufferRef is reset mid-stream (e.g. cache→fallback).
  // Used as a key on <StreamingMarkdown> so the component remounts with empty DOM
  // instead of inheriting stale stable-div content from the previous stream.
  const [streamResetKey, setStreamResetKey] = React.useState(0);

  // ── Repetition Circuit Breaker ───────────────────────────────────────────────
  // loopAbortControllerRef: holds the AbortController for the active fetch; calling
  //   .abort() immediately closes the HTTP connection and stops token spending.
  // loopAbortedRef: set to true once we've fired the abort so we don't double-fire.
  // loopCharsRef: counts chars since the last loop-detection check; we check every
  //   LOOP_CHECK_CHARS to avoid running String.includes on every tiny chunk.
  const loopAbortControllerRef = useRef(null);
  const loopAbortedRef         = useRef(false);
  const loopCharsRef           = useRef(0);

  const cancelStreamUiSchedule = () => {
    if (streamUiRafRef.current != null) {
      clearInterval(streamUiRafRef.current);
      streamUiRafRef.current = null;
    }
    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }
  };

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      const threadEl = learningModeActive ? learningThreadRef.current : chatThreadRef.current;
      if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
      if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight;
    });
  };

  const flushStreamUiUpdate = () => {
    cancelStreamUiSchedule();
    const text = streamBufferRef.current || '';
    setCurrentResponse(text);
    setAnimatedResponseContent(text);
    scrollChatToBottom();
  };

  // ── Repetition detection constants ──────────────────────────────────────────
  // LOOP_MIN_BUFFER: ignore short responses — no false positives on brief answers.
  // LOOP_WINDOW: size of the "tail fingerprint" we look for earlier in the buffer.
  // LOOP_GAP: minimum chars between the fingerprint occurrence and the tail, so we
  //   don't fire on perfectly normal adjacent duplicate phrases.
  // LOOP_CHECK_CHARS: only run the O(n) scan after this many new chars arrive, to
  //   avoid burning CPU on every tiny chunk from a fast stream.
  // Legal templates repeat similar section headers — keep thresholds high to avoid
  // false positives that abort the stream and leave only the title visible.
  const LOOP_MIN_BUFFER  = 8000;
  const LOOP_WINDOW      = 400;
  const LOOP_GAP         = 1500;
  const LOOP_CHECK_CHARS = 1200;
  const LOOP_MIN_REPEATS = 3;

  const detectRepetitionLoop = (buffer) => {
    if (buffer.length < LOOP_MIN_BUFFER + LOOP_WINDOW + LOOP_GAP) return false;
    const tail = buffer.slice(-LOOP_WINDOW).trimStart();
    if (tail.replace(/\s+/g, '').length < 100) return false;
    const searchEnd = buffer.length - LOOP_WINDOW - LOOP_GAP;
    if (searchEnd < LOOP_MIN_BUFFER) return false;
    const haystack = buffer.slice(0, searchEnd);
    let fromIndex = 0;
    let hits = 0;
    while (hits < LOOP_MIN_REPEATS) {
      const found = haystack.indexOf(tail, fromIndex);
      if (found < 0) break;
      hits += 1;
      fromIndex = found + Math.max(LOOP_GAP, 1);
    }
    return hits >= LOOP_MIN_REPEATS;
  };

  const appendStreamChunk = (text) => {
    if (typeof text !== 'string' || !text) return;

    // First visible token → switch the loader off and reveal the answer card.
    if (!streamBufferRef.current) setStreamStarted(true);
    // Only update the ref — StreamingMarkdown reads from it directly via rAF.
    streamBufferRef.current += text;
    loopCharsRef.current += text.length;

    // Periodic loop check: log only — never stop accepting chunks (that left header-only UI).
    if (loopCharsRef.current >= LOOP_CHECK_CHARS) {
      loopCharsRef.current = 0;
      if (!loopAbortedRef.current && detectRepetitionLoop(streamBufferRef.current)) {
        loopAbortedRef.current = true;
        console.warn(
          '[CircuitBreaker] Repetition pattern in stream preview (chunks still accepted; full answer applied on done).'
        );
      }
    }
  };

  const appendReasoningChunk = (text) => {
    if (typeof text !== 'string' || !text) return;
    reasoningBufferRef.current += text;
    if (reasoningUiRafRef.current != null) return;
    reasoningUiRafRef.current = requestAnimationFrame(() => {
      reasoningUiRafRef.current = null;
      setReasoningText(reasoningBufferRef.current);
    });
  };

  const resetReasoningBuffer = () => {
    reasoningBufferRef.current = '';
    if (reasoningUiRafRef.current != null) {
      cancelAnimationFrame(reasoningUiRafRef.current);
      reasoningUiRafRef.current = null;
    }
  };
  const chatThreadRef = useRef(null);
  const learningThreadRef = useRef(null);
  const splitContainerRef = useRef(null);
  const [splitLeftWidth, setSplitLeftWidth] = useState(46);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  /** Optional per-request LLM overrides (VITE_CHAT_MODEL_TEMPERATURE only). */
  const chatModelStreamFetchParams = useMemo(() => {
    const o = {};
    const temp = import.meta.env.VITE_CHAT_MODEL_TEMPERATURE;
    if (temp != null && String(temp).trim() !== '') {
      const t = Number(temp);
      if (Number.isFinite(t)) o.model_temperature = t;
    }
    return Object.keys(o).length ? o : null;
  }, []);

  const pollingIntervalRef = useRef(null);
  
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // Speech recognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => setIsListening(true);
      recognitionInstance.onend = () => setIsListening(false);
      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        
        // Reset secret prompt if voice input is given
        if (isSecretPromptSelected) {
          setIsSecretPromptSelected(false);
          setActiveDropdown("Custom Query");
          setSelectedSecretId(null);
        }
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [isSecretPromptSelected]);

  const toggleListening = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };
  const batchPollingIntervalsRef = useRef({});
  const uploadIntervalRef = useRef(null);

  useEffect(() => {
    if (!isResizingSplit) return undefined;

    const handleMouseMove = (event) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width) return;
      const rawPercent = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitLeftWidth(Math.min(68, Math.max(32, rawPercent)));
    };

    const handleMouseUp = () => setIsResizingSplit(false);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSplit]);

  // 5-minute inactivity cache deletion — matches the backend cache TTL.
  // Any new prompt/typing resets the timer (deps below); after deletion the
  // next prompt transparently rebuilds the cache server-side and just works.
  useEffect(() => {
    let timeoutId;
    if (!isGeneratingInsights && !isLoading && hasResponse) {
      timeoutId = setTimeout(() => {
        const sid = cacheSessionData?.sessionId || sessionId;
        if (sid) {
           apiService.deleteGeminiCache(sid)
             .then(() => console.log('Cache deleted due to 5 minutes of inactivity'))
             .catch(e => console.error('Failed to delete cache on inactivity', e));
        }
      }, 300000);
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [isGeneratingInsights, isLoading, hasResponse, chatInput, selectedSecretId, cacheSessionData, sessionId]);

  const getAuthToken = () => {
    const tokenKeys = [
      'authToken',
      'token',
      'accessToken',
      'jwt',
      'bearerToken',
      'auth_token',
      'access_token',
      'api_token',
      'userToken',
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  const apiRequest = async (url, options = {}) => {
    try {
      const token = getAuthToken();
      const defaultHeaders = { 'Content-Type': 'application/json' };
      if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
      }
      const headers =
        options.body instanceof FormData
          ? token
            ? { 'Authorization': `Bearer ${token}` }
            : {}
          : { ...defaultHeaders, ...options.headers };
      const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP error! status: ${response.status}` };
        }
        const serverMsg = (errorData.detail && typeof errorData.detail === 'object'
          ? errorData.detail.message
          : typeof errorData.detail === 'string' ? errorData.detail : null)
          || errorData.message || errorData.error || null;
        switch (response.status) {
          case 401:
            throw new Error('Authentication required. Please log in again.');
          case 403:
            throw new Error(serverMsg || 'Access denied.');
          case 404:
            throw new Error('Resource not found.');
          case 413:
            throw new Error(serverMsg || 'File too large or exceeds page limit.');
          case 415:
            throw new Error('Unsupported file type.');
          case 429: {
            const quota = parseQuotaHttpError(429, errorData);
            if (quota) throw createQuotaError(quota, 429);
            const quotaDisplay = parseLlmPolicyErrorForUi(429, errorData);
            const err = new Error(quotaDisplay.body);
            err.code = errorData?.code || errorData?.detail?.code;
            err.details = errorData?.details || errorData?.detail?.details;
            err.quotaDisplay = quotaDisplay;
            throw err;
          }
          default:
            throw new Error(serverMsg || `Request failed with status ${response.status}`);
        }
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return response;
    } catch (error) {
      throw error;
    }
  };

  const getProcessingStatus = async (file_id) => {
    try {
      const data = await apiRequest(`/files/${file_id}/status`);
      return data;
    } catch (error) {
      console.error(`[getProcessingStatus] Error getting status for ${file_id}:`, error);
      return null;
    }
  };

  const uploadDocumentToChat = async (file, options = {}) => {
    const { skipFinalize = false } = options;
    try {
      setIsChatUploading(true);
      setUploadProgress(0);
      setError(null);
      const response = await apiService.uploadChatModelDocument(file, {
        onProgress: (percentComplete) => {
          setUploadProgress(percentComplete);
          console.log(`[uploadDocumentToChat] Signed upload progress: ${percentComplete}%`);
        },
      });

      const newFileId = response.data?.file_id || response.file_id;
      if (!newFileId) {
        throw new Error('No file_id returned from upload');
      }

      const priorIds =
        chatAttachmentFileIdsRef.current.length > 0
          ? [...chatAttachmentFileIdsRef.current]
          : fileId
            ? [fileId]
            : [];
      const nextAttachmentIds = [...new Set([...priorIds, newFileId])];
      chatAttachmentFileIdsRef.current = nextAttachmentIds;

      if (!fileId) {
        setFileId(newFileId);
      }

      setUploadedFileId(newFileId);
      setHasResponse(true);
      setUploadProgress(100);
      setCacheSessionData(null);

      const uploadedName = file?.name || response.data?.filename || 'document';
      if (nextAttachmentIds.length > 1) {
        setDocumentData((prev) => {
          const prevNames = prev?.originalName && prev.originalName !== `${priorIds.length} documents`
            ? prev.originalName
            : '';
          const combinedNames = prevNames
            ? `${prevNames}, ${uploadedName}`
            : uploadedName;
          return {
            name: `${nextAttachmentIds.length} documents`,
            originalName: combinedNames,
            size: (prev?.size || 0) + (file?.size || 0),
            type: 'multi',
            uploadedAt: new Date().toISOString(),
          };
        });
      } else {
        setDocumentData({
          name: uploadedName,
          originalName: uploadedName,
          size: file?.size || response.data?.size || 0,
          type: file?.type || response.data?.mimetype || 'application/pdf',
          uploadedAt: new Date().toISOString(),
        });
      }

      if (!skipFinalize) {
        setTimeout(() => {
          setIsChatUploading(false);
          if (nextAttachmentIds.length > 1) {
            setSuccess(
              `Document added. ${nextAttachmentIds.length} documents are attached — a new combined cache will be created on your next question.`
            );
          } else {
            setSuccess('Document uploaded successfully! You can now ask questions about it.');
          }
          setStreamingStatus('ready');
          setStreamingMessage(
            nextAttachmentIds.length > 1
              ? `${nextAttachmentIds.length} documents ready. Ask a question about any or all of them.`
              : 'Document ready. You can now ask questions about it.'
          );
        }, 500);

        fetchChatModelFiles();
        countDocumentTokens(nextAttachmentIds[0]);
        apiService.createGeminiCache({ file_id: nextAttachmentIds[0] }).catch(err => console.error("Cache prime error:", err));
      }

      return { file_id: newFileId, ...response };
    } catch (error) {
      console.error('[uploadDocumentToChat] Error:', error);
      if (!showQuotaError(error)) {
        setError(getChatModelQuotaUserMessage(error) || `Upload failed: ${error.message}`);
      }
      setIsChatUploading(false);
      throw error;
    }
  };
 
  const getStatusMessage = (status) => {
    const statusMessages = {
      initializing: 'Starting…',
      validating: 'Validating…',
      fetching: 'Loading context…',
      analyzing: 'Preparing…',
      generating: 'Model thinking',
      saving: 'Saving…',
    };
    return statusMessages[status] || 'Working…';
  };

  const getProcessingStepTitle = (status, message = '') => {
    if (status === 'initializing') return 'Starting the Request';
    if (status === 'validating') return 'Validating Access';
    if (status === 'fetching') {
      if (/secret prompt/i.test(message)) return 'Loading the Analysis Prompt';
      if (/professional profile/i.test(message)) return 'Loading Profile Context';
      if (/previous conversation/i.test(message)) return 'Loading Conversation Context';
      if (/gcp/i.test(message)) return 'Retrieving Prompt Instructions';
      return 'Gathering Context';
    }
    if (status === 'analyzing') return 'Analyzing the Document';
    if (status === 'generating') return 'Drafting the Answer';
    if (status === 'saving') return 'Saving the Conversation';
    return 'Processing';
  };

  const pushProcessingStep = (status, message = '') => {
    const stepId = `${status}:${message || ''}`;
    setProcessingTimeline((prev) => {
      const next = prev.map((step) => ({ ...step, state: 'done' }));
      const existingIndex = next.findIndex((step) => step.id === stepId);
      const newStep = {
        id: stepId,
        status,
        title: getProcessingStepTitle(status, message),
        description: message || getStatusMessage(status) || 'Working...',
        state: 'active',
      };
      if (existingIndex >= 0) {
        next[existingIndex] = newStep;
        return next;
      }
      return [...next, newStep];
    });
  };

  const startProcessingTimeline = (questionLabel, initialStatus, initialMessage) => {
    setPendingQuestion(sanitizeVisibleChatText(questionLabel) || null);
    setShowProcessingTimeline(true);
    setShowReasoning(true);
    resetReasoningBuffer();
    setReasoningText('');
    setProcessingTimeline([]);
    if (initialStatus) {
      pushProcessingStep(initialStatus, initialMessage);
    }
  };

  const clearProcessingTimeline = () => {
    setProcessingTimeline([]);
    setPendingQuestion(null);
    setShowProcessingTimeline(false);
    resetReasoningBuffer();
    setReasoningText('');
    setShowReasoning(false);
  };

  const sanitizeVisibleChatText = (value, fallback = '') => {
    const text = String(value || '').trim();
    if (!text) return fallback;
    if (
      /ChatModel:\s*User authenticated/i.test(text) ||
      /\[CacheService\]/i.test(text) ||
      /\[GeminiCacheController\]/i.test(text) ||
      /TypeError:\s*fetch failed/i.test(text) ||
      /node:internal|node_modules|\\Backend\\|\/Backend\//i.test(text)
    ) {
      return fallback;
    }
    return text;
  };

  const normalizedReasoningText = useMemo(() => {
    if (!reasoningText) return '';

    return reasoningText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])(\*\*[^*\n]+?\*\*)/g, '$1\n\n$2')
      .trim();
  }, [reasoningText]);

  const fetchChatModelFiles = async () => {
    try {
      const response = await apiService.getChatModelFiles();
      if (response.success && response.data?.files) {
        setChatModelFiles(response.data.files);
      }
    } catch (error) {
      console.error('[fetchChatModelFiles] Error:', error);
    }
  };

  const generateSessionName = (firstQuestion) => {
    if (!firstQuestion) return 'New Conversation';
    const words = firstQuestion.trim().split(/\s+/);
    const name = words.length <= 6 ? firstQuestion.trim() : words.slice(0, 6).join(' ') + '...';
    return name.length > 50 ? name.substring(0, 50) + '...' : name;
  };

  // Fetch all chat sessions for the sidebar
  const fetchChatSessions = async () => {
    try {
      setIsLoadingSessions(true);
      let sessions = [];

      // Fetch general chat sessions (no document)
      try {
        const response = await apiService.getGeneralChatSessions();
        if (response.success && Array.isArray(response.data?.sessions)) {
          const generalSessions = response.data.sessions.map((session) => ({
            session_id: session.session_id,
            name: session.title || generateSessionName(session.first_prompt_label || session.first_question || session.first_message),
            first_question: session.first_question || session.first_message || '',
            created_at: session.last_message_at || session.created_at,
            message_count: session.message_count || 0,
            is_general_chat: true,
            file_id: null,
          }));
          sessions = [...sessions, ...generalSessions];
        }
      } catch (err) {
        console.warn('[fetchChatSessions] General sessions API error:', err.message);
      }

      // Fetch document-based sessions
      try {
        const docResponse = await apiService.getAllDocumentSessions();
        if (docResponse.success && Array.isArray(docResponse.data?.sessions)) {
          const docSessions = docResponse.data.sessions.map((session) => ({
            session_id: session.session_id,
            name: generateSessionName(session.first_prompt_label || session.first_question),
            first_question: session.first_question || '',
            created_at: session.last_message_at || session.first_message_at,
            message_count: session.message_count || 0,
            is_general_chat: false,
            file_id: session.file_id,
            filename: session.filename,
          }));
          sessions = [...sessions, ...docSessions];
        }
      } catch (err) {
        console.warn('[fetchChatSessions] Document sessions API error:', err.message);
      }

      // Sort by most recent first
      sessions.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setChatSessions(sessions);
    } catch (error) {
      console.error('[fetchChatSessions] Error:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Load a specific session when clicked in the sidebar
  const handleSessionClick = async (session) => {
    if (session.session_id === sessionId) return; // Already active
    // Clear current state
    setMessages([]);
    setCurrentResponse('');
    setAnimatedResponseContent('');
    setSelectedMessageId(null);
    setHasResponse(false);
    setError(null);
    setChatInput('');
    setDocumentData(null);
    setFileId(null);
    chatAttachmentFileIdsRef.current = [];

    setSessionId(session.session_id);

    if (session.file_id) {
      // Document chat session
      setFileId(session.file_id);
      chatAttachmentFileIdsRef.current = [session.file_id];
      setHasResponse(true);
      await fetchChatModelHistory(session.file_id, session.session_id);
      navigate(`/chatmodel/${session.file_id}/${session.session_id}`, { replace: true });
    } else {
      // General chat session
      setHasResponse(true);
      await fetchGeneralChatHistory(session.session_id);
      navigate(`/chatmodel/session/${encodeURIComponent(session.session_id)}`, { replace: true });
    }
  };
 
  const fetchChatModelHistory = async (fileId, sessionId = null) => {
    try {
      console.log('[DB] fetchChatModelHistory called with params:', {
        fileId,
        sessionId,
        endpoint: `/api/chat/history/${fileId}${sessionId ? `?session_id=${sessionId}` : ''}`,
      });

      const response = await apiService.getChatModelHistory(fileId, sessionId);

      console.log('[DB] Raw response from getChatModelHistory:', {
        success: response.success,
        file_id: response.data?.file_id,
        filename: response.data?.filename,
        session_id: response.data?.session_id,
        message_count: response.data?.count,
        history_preview: response.data?.history?.slice(0, 2).map(h => ({
          id: h.id,
          session_id: h.session_id,
          question_preview: (h.question || '').substring(0, 80),
          used_secret_prompt: h.used_secret_prompt,
          created_at: h.created_at,
        })),
      });

      if (response.success && response.data?.history) {
        const idsFromApi =
          Array.isArray(response.data.file_ids) && response.data.file_ids.length
            ? response.data.file_ids
            : Array.isArray(response.data.attached_files) && response.data.attached_files.length
              ? response.data.attached_files.map((a) => a.file_id).filter(Boolean)
              : [fileId];
        chatAttachmentFileIdsRef.current = [...new Set(idsFromApi.filter(Boolean))];

        const primaryAttachment =
          Array.isArray(response.data.attached_files) && response.data.attached_files.length
            ? response.data.attached_files[0]
            : null;

        const history = response.data.history.map((item) => ({
          id: item.id,
          file_id: item.file_id || fileId,
          session_id: item.session_id || sessionId,
          question: item.question,
          answer: item.answer,
          // A stored prompt_label means the question body is a prompt, not
          // something the user typed — show the label (custom prompts store one
          // without used_secret_prompt).
          display_text_left_panel: item.used_secret_prompt
            ? `Analysis: ${item.prompt_label || 'Secret Prompt'}`
            : (item.prompt_label || item.question),
          timestamp: item.created_at,
          type: 'chat',
          used_secret_prompt: item.used_secret_prompt || false,
          prompt_label: item.prompt_label || null,
          secret_id: item.secret_id || null,
        }));

        console.log('[DB] Loaded chat history for continuation:', {
          total_messages: history.length,
          session_id_used: sessionId,
          file_id_used: fileId,
          filename_from_db: response.data.filename,
          file_ids_restored: chatAttachmentFileIdsRef.current,
          sessions_in_history: [...new Set(history.map(h => h.session_id))],
        });

        setChatModelHistory(history);
        setMessages(history);

        const primaryId = primaryAttachment?.file_id || fileId;
        if (primaryId) {
          setFileId(primaryId);
        }
        const dbFilename =
          primaryAttachment?.filename ||
          response.data.filename ||
          `Document (${String(fileId).substring(0, 8)}...)`;
        setDocumentData({
          id: primaryId,
          title: dbFilename,
          originalName: dbFilename,
          size: primaryAttachment?.size ?? 0,
          type: primaryAttachment?.mimetype || 'unknown',
          gcs_uri: primaryAttachment?.gcs_uri || null,
          uploadedAt: history.length > 0 ? history[0].timestamp : new Date().toISOString(),
          status: 'processed',
          processingProgress: 100,
        });

        if (history.length > 0) {
          const lastMessage = history[history.length - 1];
          setSelectedMessageId(lastMessage.id);
          const rawAnswer = lastMessage.answer || '';
          const isStructured = lastMessage.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
          const responseToDisplay = isStructured
            ? renderSecretPromptResponse(rawAnswer)
            : convertJsonToPlainText(rawAnswer);
          setCurrentResponse(responseToDisplay);
          showResponseImmediately(responseToDisplay);
          setHasResponse(true);
        }
      }
    } catch (error) {
      console.error('[fetchChatModelHistory] Error:', error);
      setError(`Failed to fetch chat history: ${error.message}`);
    }
  };

  // General legal chat — no document required
  const fetchGeneralChatHistory = async (currentSessionId) => {
    try {
      console.log('[DB] fetchGeneralChatHistory called with params:', {
        session_id: currentSessionId,
        endpoint: `/api/chat/general/history/${currentSessionId}`,
      });

      const response = await apiService.getGeneralChatHistory(currentSessionId);

      console.log('[DB] Raw response from getGeneralChatHistory:', {
        success: response.success,
        session_id: response.data?.session_id,
        message_count: response.data?.count,
        is_general_chat: response.data?.is_general_chat,
      });

      if (response.success && response.data?.history) {
        const history = response.data.history.map((item) => ({
          id: item.id,
          file_id: null,
          session_id: item.session_id || currentSessionId,
          question: item.question,
          answer: item.answer,
          display_text_left_panel: item.question,
          timestamp: item.created_at,
          type: 'general_chat',
          used_secret_prompt: false,
          prompt_label: null,
          is_general_chat: true,
        }));

        console.log('[DB] Loaded general chat history for continuation:', {
          total_messages: history.length,
          session_id_used: currentSessionId,
        });

        setMessages(history);
        setSessionId(currentSessionId);
        setHasResponse(true);

        if (history.length > 0) {
          const lastMessage = history[history.length - 1];
          setSelectedMessageId(lastMessage.id);
          setCurrentResponse(lastMessage.answer || '');
          showResponseImmediately(lastMessage.answer || '');
        }
      }
    } catch (error) {
      console.error('[fetchGeneralChatHistory] Error:', error);
      setError(`Failed to fetch general chat history: ${error.message}`);
    }
  };

  const askGeneralQuestionToChat = async (question, displayLabel = null) => {
    try {
      ensureNotificationPermission();
      setIsLoading(true);
      setIsGeneratingInsights(true);
      setError(null);
      setCurrentResponse('');
      streamBufferRef.current = '';
      streamingGeneratingFiredRef.current = false;
      setStreamStarted(false);
      loopAbortedRef.current = false;
      loopCharsRef.current   = 0;
      loopAbortControllerRef.current = new AbortController();
      setStreamingStatus('initializing');
      setStreamingMessage('Starting legal chat...');
      startProcessingTimeline(question.trim(), 'initializing', 'Starting legal chat...');

      const messageId = Date.now();
      setHasResponse(true);
      setChatInput('');

      console.log('[General Chat] Sending question with DB params:', {
        session_id: sessionId,
        question_preview: question.trim().substring(0, 80),
        is_continuing_session: !!sessionId,
      });

      let newSessionId = sessionId;

      // Prefer: secret-prompt override > admin DB model from limits > backend default
      const adminModel = limits?.llm_model;
      const generalStreamOpts = {
        ...(chatModelStreamFetchParams || {}),
        ...(selectedLlmName
          ? { llm_name: selectedLlmName }
          : adminModel
            ? { llm_name: adminModel }
            : {}),
        ...(citationMode ? { web_search: true } : {}),
      };

      await apiService.askGeneralChatStream(
        question.trim(),
        sessionId,
        (text) => {
          appendStreamChunk(text);
          if (typeof text === 'string' && text && !streamingGeneratingFiredRef.current) {
            streamingGeneratingFiredRef.current = true;
            setStreamingStatus('generating');
            setStreamingMessage('Model thinking');
          }
        },
        (status, message) => {
          setStreamingStatus(status);
          setStreamingMessage(
            status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
          );
          pushProcessingStep(status, message || getStatusMessage(status));
          console.log('[General Chat] Status:', status, message);
        },
        (metadata) => {
          console.log('[General Chat] Metadata from DB:', metadata);
          if (metadata.session_id) {
            newSessionId = metadata.session_id;
            setSessionId(metadata.session_id);
          }
        },
        (doneData) => {
          console.log('[General Chat] Stream complete. DB params used:', {
            chat_id: doneData.chat_id,
            session_id: doneData.session_id,
            is_general_chat: doneData.is_general_chat,
            answer_length: doneData.answer_length,
          });
          const fromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
          const fromBuf = streamBufferRef.current || '';
          // Server answer wins (see askQuestionToChat) — the local buffer may
          // contain streamed-then-discarded degenerate rounds.
          const finalResponse = fromDone.trim() ? fromDone : fromBuf;
          streamBufferRef.current = finalResponse;
          flushStreamUiUpdate();

          if (doneData.token_usage) {
            setSessionTokenUsage((prev) => ({
              inputTokens:  prev.inputTokens  + (doneData.token_usage.inputTokens  || 0),
              outputTokens: prev.outputTokens + (doneData.token_usage.outputTokens || 0),
              totalTokens:  prev.totalTokens  + (doneData.token_usage.totalTokens  || 0),
              modelName: doneData.token_usage.modelName || prev.modelName,
            }));
          }

          if (doneData.session_id) newSessionId = doneData.session_id;
          const resolvedSessionId = newSessionId || sessionId || null;

          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
          const newChat = {
            id: messageId,
            file_id: null,
            session_id: resolvedSessionId,
            question: question.trim(),
            answer: finalResponse,
            display_text_left_panel: displayLabel || question.trim(),
            timestamp: new Date().toISOString(),
            type: 'general_chat',
            used_secret_prompt: false,
            is_general_chat: true,
          };
          setMessages((prev) => [...prev, newChat]);
          setSelectedMessageId(messageId);
          setPendingQuestion(null);
          if (resolvedSessionId) setSessionId(resolvedSessionId);
          const displayResponse = formatResponseForDisplay(finalResponse, newChat);
          setCurrentResponse(displayResponse);
          showResponseImmediately(displayResponse);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setSuccess('Legal question answered!');
          notifyResponseComplete();
        },
        (errorMessage, details, code) => {
          console.error('[General Chat] Stream error:', errorMessage, { code, details });
          const synthetic = new Error(errorMessage);
          synthetic.code = code;
          synthetic.details = details;
          if (code) refreshLimits().catch(() => {});
          if (!showQuotaError(synthetic)) {
            setError(getChatModelQuotaUserMessage(synthetic) || errorMessage || 'Failed to get answer.');
          }
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
        },
        Object.keys(generalStreamOpts).length ? generalStreamOpts : null,
        (thoughtText) => {
          appendReasoningChunk(thoughtText);
        },
        loopAbortControllerRef.current?.signal ?? null
      );
    } catch (error) {
      console.error('[General Chat] Error:', error);
      if (!showQuotaError(error)) {
        setError(getChatModelQuotaUserMessage(error) || error.message || 'Failed to get answer.');
      }
      clearProcessingTimeline();
      throw error;
    } finally {
      cancelStreamUiSchedule();
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
    }
  };

  const askQuestionToChat = async (question, fileId, fileIdsOverride = null, displayLabel = null) => {
    let messageId = null;
    try {
      ensureNotificationPermission();
      setIsLoading(true);
      setIsGeneratingInsights(true);
      setError(null);
      setCurrentResponse('');
      streamBufferRef.current = '';
      streamingGeneratingFiredRef.current = false;
      setStreamStarted(false);
      loopAbortedRef.current = false;
      loopCharsRef.current   = 0;
      loopAbortControllerRef.current = new AbortController();
      setStreamingStatus('initializing');
      setStreamingMessage('Starting chat request...');
      startProcessingTimeline(question.trim(), 'initializing', 'Starting chat request...');

      if (streamReaderRef.current) {
        try {
          await streamReaderRef.current.cancel();
        } catch (e) {
        }
        streamReaderRef.current = null;
      }

      cancelStreamUiSchedule();

      const sanitizeId = (id) =>
        id && typeof id === 'string' ? id.replace(/\{\{|\}\}/g, '').replace(/\{|\}/g, '').trim() : id;

      let ids =
        Array.isArray(fileIdsOverride) && fileIdsOverride.length > 0
          ? fileIdsOverride.map(sanitizeId).filter(Boolean)
          : [];

      let cleanFileId = sanitizeId(fileId);
      if (!ids.length && cleanFileId) {
        ids = [cleanFileId];
      }
      if (!ids.length) {
        throw new Error('No file_id available. Please upload a document first.');
      }
      cleanFileId = ids[0];

      let newSessionId = sessionId;
      let finalMetadata = null;

      messageId = Date.now();
      const newChat = {
        id: messageId,
        file_id: cleanFileId,
        session_id: sessionId,
        question: question.trim(),
        answer: '',
        display_text_left_panel: displayLabel || question.trim(),
        timestamp: new Date().toISOString(),
        type: 'chat',
        used_secret_prompt: false,
        isStreaming: true,
        sources: [],
      };
     
      // Clear isStreaming on any stuck previous messages before adding the new one
      setMessages((prev) => [
        ...prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m),
        newChat,
      ]);
      setSelectedMessageId(messageId);
      setHasResponse(true);
      setChatInput('');

      // NOTE: The separate /cache/ask/stream path was removed.
      // /ask/stream (stream_document_chat) already calls ask_with_context_cache
      // internally, so routing both paths caused TWO query_logs entries per user
      // message. All document chat — single or multi-file — now flows through
      // /ask/stream which handles ADK caching, session persistence, and query
      // logging in one place.

      console.log('[DB] Sending chat request with DB params:', {
        file_id: cleanFileId,
        file_ids: ids.length > 1 ? ids : undefined,
        session_id: sessionId,
        question_preview: question.trim().substring(0, 100),
        is_continuing_session: !!sessionId,
        endpoint: `${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`,
      });

      await apiService.askChatModelQuestionStream(
        question.trim(),
        cleanFileId,
        sessionId,
        (text) => {
          appendStreamChunk(text);
          if (typeof text === 'string' && text && !streamingGeneratingFiredRef.current) {
            streamingGeneratingFiredRef.current = true;
            setStreamingStatus('generating');
            setStreamingMessage('Model thinking');
          }
        },
        (status, message) => {
          setStreamingStatus(status);
          setStreamingMessage(
            status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
          );
          pushProcessingStep(status, message || getStatusMessage(status));
          console.log('[askQuestionToChat] Status:', status, message);
        },
        (metadata) => {
          console.log('[askQuestionToChat] Metadata:', metadata);
          if (metadata.cache_session_metrics) {
            setCacheSessionData(metadata.cache_session_metrics);
            setUseCache(true);
          }
          if (metadata.session_id || metadata.sources) {
            if (metadata.session_id) newSessionId = metadata.session_id;
            setMessages((prev) => {
              const updated = prev.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      ...(metadata.session_id ? { session_id: metadata.session_id } : {}),
                      ...(metadata.sources ? { sources: metadata.sources } : {}),
                    }
                  : msg
              );
              return updated;
            });
            if (metadata.session_id) setSessionId(metadata.session_id);
          }
        },
        (doneData) => {
          console.log('[askQuestionToChat] Stream complete:', doneData);
          finalMetadata = doneData;
          const fromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
          const fromBuf = streamBufferRef.current || '';
          // Server answer wins: degenerate rounds are streamed live but excluded
          // from the stitched server answer (and from history) — the longer local
          // buffer can contain that discarded garbage.
          const finalResponse = fromDone.trim() ? fromDone : fromBuf;
          streamBufferRef.current = finalResponse;

          if (!finalResponse || !String(finalResponse).trim()) {
            setError('The model returned an empty response. Please try again.');
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === messageId ? { ...msg, isStreaming: false, answer: '' } : msg
              )
            );
            clearProcessingTimeline();
            setIsLoading(false);
            setIsGeneratingInsights(false);
            setStreamingStatus(null);
            setStreamingMessage('');
            return;
          }

          flushStreamUiUpdate();

          if (doneData.token_usage) {
            setSessionTokenUsage((prev) => ({
              inputTokens:  prev.inputTokens  + (doneData.token_usage.inputTokens  || 0),
              outputTokens: prev.outputTokens + (doneData.token_usage.outputTokens || 0),
              totalTokens:  prev.totalTokens  + (doneData.token_usage.totalTokens  || 0),
              modelName: doneData.token_usage.modelName || prev.modelName,
            }));
          }
          if (doneData.used_gemini_cache) {
            setUseCache(true);
            if (doneData.cache_session_metrics) {
              setCacheSessionData(doneData.cache_session_metrics);
            }
          }

          if (doneData.session_id) {
            newSessionId = doneData.session_id;
          }
          const resolvedSessionId = newSessionId || sessionId || null;

          setStreamingStatus(null);
          setStreamingMessage('');
         
          setMessages((prev) => {
            const updated = prev.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    answer: finalResponse,
                    session_id: resolvedSessionId,
                    isStreaming: false,
                    learning_payload: doneData?.learning_payload || null,
                    learning_mode: !!doneData?.learning_mode,
                    sources: doneData?.sources || msg.sources || [],
                  }
                : msg
            );
            return updated;
          });
          setTurnCount(Number(doneData?.turn_count || 0));
          setTurnThreshold(Number(doneData?.turn_threshold || 4));
         
          setSelectedMessageId(messageId);
          if (resolvedSessionId) setSessionId(resolvedSessionId);
          assistantDisplayCacheRef.current.delete(messageId);
          setStreamResetKey((k) => k + 1);
          const displayResponse = formatResponseForDisplay(finalResponse, {
            used_secret_prompt: false,
            learning_mode: !!doneData?.learning_mode,
            learning_payload: doneData?.learning_payload || null,
          });
          setCurrentResponse(displayResponse);
          showResponseImmediately(displayResponse);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setSuccess('Question answered!');
          notifyResponseComplete();
         
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
         
          setTimeout(() => {
            if (responseRef.current) {
              responseRef.current.scrollTop = responseRef.current.scrollHeight;
            }
          }, 100);
        },
        (errorMessage, details, code) => {
          console.error('[askQuestionToChat] Stream error:', errorMessage, { code, details });
          const synthetic = new Error(errorMessage);
          synthetic.code = code;
          synthetic.details = details;
          if (code) refreshLimits().catch(() => {});
          if (!showQuotaError(synthetic)) {
            setError(getChatModelQuotaUserMessage(synthetic) || errorMessage || 'Failed to get answer.');
          }
          flushStreamUiUpdate();
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
         
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId ? { ...msg, isStreaming: false, answer: msg.answer || streamBufferRef.current || '' } : msg
            )
          );
        },
        null,           // secretId
        false,          // usedSecretPrompt
        displayLabel,   // promptLabel — persists a custom prompt's name
        null,
        selectedLlmName,
        {
          ...chatModelStreamFetchParams,
          learning_mode: learningModeActive,
          document_context: learningModeActive ? getLearningDocumentContext() : undefined,
          ...(citationMode ? { web_search: true } : {}),
        },
        ids.length > 1 ? ids : null,
        (thoughtText) => {
          appendReasoningChunk(thoughtText);
        },
        (usagePayload) => {
          if (usagePayload?.sessionMetrics) {
            setCacheSessionData(usagePayload.sessionMetrics);
          }
        },
        loopAbortControllerRef.current?.signal ?? null
      );
     
      return finalMetadata;
    } catch (error) {
      console.error('[askQuestionToChat] Error:', error);
      if (!showQuotaError(error)) {
        setError(getChatModelQuotaUserMessage(error) || `Failed to get answer: ${error.message}`);
      }
      clearProcessingTimeline();
      throw error;
    } finally {
      // Cancel any pending UI schedule timers (rAF / timeout) created during
      // the stream. Do NOT call setMessages here — onDone / onError already
      // cleared isStreaming. A duplicate setMessages call here creates a React
      // state race that can blank out the final rendered answer.
      cancelStreamUiSchedule();
      loopAbortedRef.current = false;
      loopCharsRef.current = 0;
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
      // Safety: if onDone/onError never ran (e.g. network drop), stop the spinner.
      if (messageId != null) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.isStreaming ? { ...m, isStreaming: false } : m
          )
        );
      }
    }
  };

  const loadCustomPromptGroups = useCallback(async () => {
    try {
      const groups = await fetchCustomPromptGroups();
      setCustomPromptGroups(Array.isArray(groups) ? groups : []);
    } catch {
      /* custom prompts are optional — keep the current list on failure */
    }
  }, []);

  const handleDeleteCustomPrompt = useCallback(async (prompt) => {
    if (!window.confirm(`Delete the prompt "${prompt.name}"?`)) return;
    try {
      await deleteCustomPrompt(prompt.id);
      await loadCustomPromptGroups();
    } catch (err) {
      setError(err?.message || 'Failed to delete the prompt.');
    }
  }, [loadCustomPromptGroups]);

  const handleDeleteCustomGroup = useCallback(async (group) => {
    const count = group.prompts?.length ?? 0;
    const warning = count
      ? `Delete the group "${group.name}" and the ${count} prompt(s) inside it?`
      : `Delete the empty group "${group.name}"?`;
    if (!window.confirm(warning)) return;
    try {
      await deleteCustomPromptGroup(group.id);
      await loadCustomPromptGroups();
    } catch (err) {
      setError(err?.message || 'Failed to delete the group.');
    }
  }, [loadCustomPromptGroups]);

  // Clicking a saved custom prompt runs it straight away. The thread shows only
  // the prompt's name — the body is sent to the model but never displayed,
  // matching how preset prompts behave.
  // Deliberately not memoized: it must call the current render's handleSend so
  // the send picks up the live fileId / sessionId.
  const handleCustomPromptSelect = (prompt) => {
    if (!prompt?.prompt_text || isLoading || isGeneratingInsights) return;
    setChatMode('chat');
    void handleSend({ preventDefault: () => {} }, null, prompt);
  };

  const loadSecrets = async () => {
    const cached = peekSecretsList();
    if (cached?.length) setSecrets(cached);
    if (!cached?.length) setIsLoadingSecrets(true);
    try {
      setError(null);
      const secretsList = await fetchSecretsList();
      setSecrets(secretsList);

      if (selectedSecretId) {
        const secretExists = secretsList.find((s) => s.id === selectedSecretId);
        if (!secretExists) {
          setSelectedSecretId(null);
          setIsSecretPromptSelected(false);
          setActiveDropdown('Custom Query');
          setSelectedLlmName(null);
        }
      } else {
        setActiveDropdown('Custom Query');
        setSelectedSecretId(null);
        setSelectedLlmName(null);
        setIsSecretPromptSelected(false);
      }
    } catch (error) {
      console.error('Error fetching secrets:', error);
      setError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };


  const batchUploadDocuments = async (files, secretId = null, llmName = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
   
    console.log(`[batchUploadDocuments] 🚀 Starting batch upload for ${files.length} files`);
    console.log(`[batchUploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[batchUploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);
   
    setIsUploading(true);
    setError(null);
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
   
    const initialBatchUploads = files.map((file, index) => {
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      console.log(`[batchUploadDocuments] 📄 File ${index + 1}: ${file.name} (${fileSizeMB}MB) - ${isLarge ? '🔴 LARGE (will use signed URL)' : '🟢 Small (regular upload)'}`);
      return {
        id: `${file.name}-${Date.now()}-${index}`,
        file: file,
        fileName: file.name,
        fileSize: file.size,
        status: 'pending',
        fileId: null,
        error: null,
        isLargeFile: isLarge,
      };
    });
    setBatchUploads(initialBatchUploads);
   
    try {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
     
      const largeFiles = files.filter(f => f.size > LARGE_FILE_THRESHOLD);
      const smallFiles = files.filter(f => f.size <= LARGE_FILE_THRESHOLD);
      const uploadedFileIds = [];
     
      console.log(`[batchUploadDocuments] 📊 Summary: ${largeFiles.length} large file(s) (signed URL), ${smallFiles.length} small file(s) (regular upload)`);
     
      for (let i = 0; i < largeFiles.length; i++) {
        const file = largeFiles[i];
        const matchingUpload = initialBatchUploads.find(u => u.file === file);
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
       
        try {
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'uploading' }
                : upload
            )
          );
         
          const generateUrlEndpoint = `${API_BASE_URL}/files/generate-upload-url`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
         
          const urlResponse = await fetch(generateUrlEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: file.name,
              mimetype: file.type,
              size: file.size,
            }),
          });
         
          if (!urlResponse.ok) {
            const errorData = await urlResponse.json().catch(() => ({}));
            const errorMessage = errorData.error || errorData.message || `Failed to get upload URL: ${urlResponse.statusText}`;
           
            const isSubscriptionError = urlResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const urlData = await urlResponse.json();
          const { signedUrl, gcsPath, filename } = urlData;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
          console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
          console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);
         
         
          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
         
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
           
           
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);
                resolve();
              } else {
                reject(new Error(`Failed to upload file to GCS: ${xhr.statusText}`));
              }
            });
           
            xhr.addEventListener('error', () => {
              reject(new Error('Network error during upload'));
            });
           
            xhr.addEventListener('abort', () => {
              reject(new Error('Upload aborted'));
            });
           
            xhr.open('PUT', signedUrl);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });
         
          const completeEndpoint = `${API_BASE_URL}/files/complete-upload`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
         
          const completeResponse = await fetch(completeEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              gcsPath,
              filename,
              mimetype: file.type,
              size: file.size,
              secret_id: secretId,
            }),
          });
         
          if (!completeResponse.ok) {
            const errorData = await completeResponse.json();
            const errorMessage = errorData.error || errorData.message || `Failed to complete upload: ${completeResponse.statusText}`;
           
            const isSubscriptionError = completeResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const completeData = await completeResponse.json();
          const fileId = completeData.file_id;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully! File ID: ${fileId}`);
          console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
                : upload
            )
          );
         
          setUploadedDocuments((prev) => [
            ...prev,
            {
              id: fileId,
              fileName: filename || matchingUpload.fileName,
              fileSize: matchingUpload.fileSize,
              uploadedAt: new Date().toISOString(),
            },
          ]);
         
          uploadedFileIds.push(fileId);
         
          if (i === 0 && largeFiles.length > 0) {
            setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                });
          }
        } catch (error) {
          console.error(`[📤 SIGNED URL UPLOAD] ❌ Upload failed for ${matchingUpload.fileName}:`, error);
          console.error(`[📤 SIGNED URL UPLOAD] Error details:`, error.message);
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'failed', error: error.message, progress: 0 }
                : upload
            )
          );
        }
      }
     
      if (smallFiles.length > 0) {
        console.log(`\n[📦 REGULAR UPLOAD] Starting batch upload for ${smallFiles.length} small file(s)`);
        console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
        console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/files/batch-upload`);
       
        const formData = new FormData();
        smallFiles.forEach((file) => {
          formData.append('document', file);
        });
        if (secretId) {
          formData.append('secret_id', secretId);
          formData.append('trigger_initial_analysis_with_secret', 'true');
        }
        if (llmName) {
          formData.append('llm_name', llmName);
        }
       
        setBatchUploads((prev) =>
          prev.map((upload) => {
            const isSmallFile = smallFiles.includes(upload.file);
            return isSmallFile ? { ...upload, status: 'uploading' } : upload;
          })
        );
       
        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
         
         
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const responseData = JSON.parse(xhr.responseText);
                resolve(responseData);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                const errorMessage = errorData.error || errorData.message || '';
                const isSubscriptionError = xhr.status === 500 ||
                  errorMessage.toLowerCase().includes('subscription') ||
                  errorMessage.toLowerCase().includes('insufficient') ||
                  errorMessage.toLowerCase().includes('no plan') ||
                  errorMessage.toLowerCase().includes('plan required');
               
                if (isSubscriptionError) {
                  const error = new Error(errorMessage || 'Subscription required');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(errorMessage || `Upload failed with status ${xhr.status}`));
                }
              } catch {
                if (xhr.status === 500) {
                  const error = new Error('Subscription required to upload files');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(`Upload failed with status ${xhr.status}`));
                }
              }
            }
          });
         
          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
          });
         
          xhr.addEventListener('abort', () => {
            reject(new Error('Upload aborted'));
          });
         
          xhr.open('POST', `${API_BASE_URL}/files/batch-upload`);
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
          xhr.send(formData);
        });
        console.log('[batchUploadDocuments] Batch upload response:', data);
       
        if (data.uploaded_files && Array.isArray(data.uploaded_files)) {
          data.uploaded_files.forEach((uploadedFile, index) => {
            const matchingUpload = initialBatchUploads.find(u => smallFiles.includes(u.file) &&
              initialBatchUploads.filter(up => smallFiles.includes(up.file)).indexOf(u) === index);
           
            if (!matchingUpload) return;
           
            if (uploadedFile.error) {
              console.error(`[batchUploadDocuments] Upload failed for ${matchingUpload.fileName}:`, uploadedFile.error);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'failed', error: uploadedFile.error }
                    : upload
                )
              );
            } else {
              const fileId = uploadedFile.file_id;
              console.log(`[batchUploadDocuments] Successfully uploaded ${matchingUpload.fileName} with ID: ${fileId}`);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'completed', fileId }
                    : upload
                )
              );
              setUploadedDocuments((prev) => [
                ...prev,
                {
                  id: fileId,
                  fileName: uploadedFile.filename || matchingUpload.fileName,
                  fileSize: matchingUpload.fileSize,
                  uploadedAt: new Date().toISOString(),
                },
              ]);
              uploadedFileIds.push(fileId);
             
              if (uploadedFileIds.length === largeFiles.length + 1) {
                setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                });
              }
            }
          });
        }
      }
     
     
      const successCount = uploadedFileIds.length;
      const failCount = initialBatchUploads.length - successCount;
     
      if (successCount > 0) {
        setSuccess(`${successCount} document(s) uploaded successfully!`);
      }
      if (failCount > 0) {
        setError(`${failCount} document(s) failed to upload.`);
      }
    } catch (error) {
      console.error('[batchUploadDocuments] Batch upload error:', error);
     
      if (error.isSubscriptionError) {
        setShowInsufficientFundsAlert(true);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: 'Subscription required' }))
        );
      } else {
        setError(`Batch upload failed: ${error.message}`);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: error.message }))
        );
      }
    } finally {
      setIsUploading(false);
    }
  };

  const animateResponse = (text = '', isAlreadyFormatted = false) => {
    console.log('[animateResponse] Starting ChatGPT-style word-by-word animation. Length:', text.length);

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const plainText = isAlreadyFormatted
      ? text
      : looksLikeRawJsonString(text)
        ? formatChatResponseForDisplay(text)
        : text;

    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText || '');
      return;
    }

    setAnimatedResponseContent('');
    setIsAnimatingResponse(true);

    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    if (words.length <= 3) {
        setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText);
        return;
      }

    const animateWord = () => {
      if (currentIndex < words.length) {
        displayedText += words[currentIndex];
        setAnimatedResponseContent(displayedText);
        currentIndex++;

        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }

        const word = words[currentIndex - 1];
        let delay = 15;
       
        if (word.trim().length === 0) {
          delay = 3;
        } else if (word.length > 15) {
          delay = 25;
        } else if (word.length > 10) {
          delay = 20;
        } else if (/[.!?]\s*$/.test(word)) {
          delay = 40;
        } else if (/[,;:]\s*$/.test(word)) {
          delay = 20;
        } else if (/^[#*`\-]/.test(word)) {
          delay = 8;
        }

        animationFrameRef.current = setTimeout(animateWord, delay);
      } else {
        setIsAnimatingResponse(false);
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  const showResponseImmediately = (text = '') => {
    const plainText =
      typeof text === 'string' && text.length > 0 && !looksLikeRawJsonString(text)
        ? text
        : formatChatResponseForDisplay(text);
   
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    console.log('[showResponseImmediately] Displaying text immediately. Length:', plainText.length);
    setAnimatedResponseContent(plainText);
    setIsAnimatingResponse(false);
    requestAnimationFrame(() => {
      if (responseRef.current) {
        responseRef.current.scrollTop = responseRef.current.scrollHeight;
      }
    });
  };

  const stopResponseAnimation = () => {
    if (!isAnimatingResponse) return;
    const fullText = currentResponse || animatedResponseContent || '';
    showResponseImmediately(fullText);
  };

  const selectedMessage = useMemo(
    () => sessionMessages.find((msg) => msg.id === selectedMessageId) || null,
    [sessionMessages, selectedMessageId]
  );

  const suggestedQuestions = useMemo(
    () =>
      buildSuggestedQuestions({
        question: selectedMessage?.question || selectedMessage?.display_text_left_panel || '',
        response: currentResponse || animatedResponseContent || selectedMessage?.answer || '',
        promptLabel: selectedMessage?.prompt_label || '',
      }),
    [selectedMessage, currentResponse, animatedResponseContent]
  );

  const handleSuggestedQuestionClick = (suggestion) => {
    setChatInput(suggestion);
  };

  const baseSendDisabled =
    isLoading ||
    isGeneratingInsights ||
    (!chatInput.trim() && !isSecretPromptSelected);

  const sendButtonType = isAnimatingResponse ? 'button' : 'submit';
  const isSendButtonDisabled = isAnimatingResponse ? false : baseSendDisabled;
  const sendButtonTitle = isAnimatingResponse ? 'Stop rendering' : 'Send Message';

  const handleSendButtonClick = (event) => {
    if (isAnimatingResponse) {
      event.preventDefault();
      stopResponseAnimation();
    }
  };

  const getSendButtonClassName = (size = 'default') => {
    const paddingClass = size === 'small' ? 'p-1.5' : 'p-1.5 sm:p-2';
    const colorClass = isAnimatingResponse
      ? 'bg-gray-500 hover:bg-gray-600'
      : 'bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300';
    return `${paddingClass} text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed ${colorClass}`;
  };

  const renderSendButtonIcon = (size = 'default') => {
    const baseClass = size === 'small' ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5';
    if (isAnimatingResponse) {
      return <Square className={baseClass} />;
    }
    if (isLoading || isGeneratingInsights) {
      return <Loader2 className={`${baseClass} animate-spin`} />;
    }
    return <Send className={baseClass} />;
  };

  const chatWithDocument = async (file_id, question, currentSessionId, llm_name = null) => {
    ensureNotificationPermission();
    setCurrentResponse('');
    streamBufferRef.current = '';
    setError(null);
    setIsLoading(true);
    setIsAnimatingResponse(false);
   
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
      }
      streamReaderRef.current = null;
    }

    loopAbortedRef.current = false;
    loopCharsRef.current   = 0;
    loopAbortControllerRef.current = new AbortController();
   
    cancelStreamUiSchedule();

    try {
      console.log('[chatWithDocument] Sending custom query with streaming. LLM:', llm_name || 'default (backend)');
      const token = getAuthToken();
      const body = {
        file_id: file_id,
        question: question.trim(),
        used_secret_prompt: false,
        prompt_label: null,
        session_id: currentSessionId,
        learning_mode: learningModeActive,
        document_context: learningModeActive ? getLearningDocumentContext() : undefined,
      };
      if (llm_name) {
        body.llm_name = llm_name;
      }
      if (chatModelStreamFetchParams?.model_temperature != null) {
        body.model_temperature = chatModelStreamFetchParams.model_temperature;
      }

      const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: loopAbortControllerRef.current?.signal ?? undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const quota = parseQuotaHttpError(response.status, errorData);
        if (quota) throw createQuotaError(quota, response.status);
        const msg =
          errorData?.message
          || (typeof errorData?.detail === 'object' ? errorData.detail?.message : errorData?.detail)
          || `HTTP error! status: ${response.status}`;
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let newSessionId = currentSessionId;
      let finalMetadata = null;

      while (true) {
        const { done, value } = await reader.read();
       
          if (done) {
            setIsLoading(false);
            const fromDone = (finalMetadata && typeof finalMetadata.answer === 'string') ? finalMetadata.answer : '';
            const fromBuf = streamBufferRef.current || '';
            const finalResponse = fromDone.length >= fromBuf.length ? (fromDone || fromBuf) : fromBuf;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
         
          const newChat = {
            id: Date.now(),
            file_id: file_id,
            session_id: newSessionId,
            question: question.trim(),
            answer: finalResponse,
            display_text_left_panel: question.trim(),
            timestamp: new Date().toISOString(),
            used_chunk_ids: finalMetadata?.used_chunk_ids || [],
            confidence: finalMetadata?.confidence || 0.8,
            type: 'chat',
            used_secret_prompt: false,
            learning_payload: finalMetadata?.learning_payload || null,
            learning_mode: !!finalMetadata?.learning_mode,
          };
          setMessages((prev) => [...prev, newChat]);
          setSelectedMessageId(newChat.id);
          setSessionId(newSessionId);
          setChatInput('');
          const displayResponse = formatResponseForDisplay(finalResponse, newChat);
          setCurrentResponse(displayResponse);
          setHasResponse(true);
          setSuccess('Question answered!');
          setTurnCount(Number(finalMetadata?.turn_count || 0));
          setTurnThreshold(Number(finalMetadata?.turn_threshold || 4));
          showResponseImmediately(displayResponse);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\n|\r/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
         
          const data = line.replace(/^data: /, '').trim();
         
          if (data === '[PING]') {
            continue;
          }
         
          if (data === '[DONE]') {
            setIsLoading(false);
            const fromDoneDone = (finalMetadata && typeof finalMetadata.answer === 'string') ? finalMetadata.answer : '';
            const fromBufDone = streamBufferRef.current || '';
            const finalResponse = fromDoneDone.length >= fromBufDone.length ? (fromDoneDone || fromBufDone) : fromBufDone;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
           
            const newChat = {
              id: Date.now(),
              file_id: file_id,
              session_id: newSessionId,
              question: question.trim(),
              answer: finalResponse,
              display_text_left_panel: question.trim(),
              timestamp: new Date().toISOString(),
              used_chunk_ids: finalMetadata?.used_chunk_ids || [],
              confidence: finalMetadata?.confidence || 0.8,
              type: 'chat',
              used_secret_prompt: false,
              learning_payload: finalMetadata?.learning_payload || null,
              learning_mode: !!finalMetadata?.learning_mode,
            };
            setMessages((prev) => [...prev, newChat]);
            setSelectedMessageId(newChat.id);
            setSessionId(newSessionId);
            setChatInput('');
            const displayResponse = formatResponseForDisplay(finalResponse, newChat);
            setCurrentResponse(displayResponse);
            setHasResponse(true);
            setSuccess('Question answered!');
            setTurnCount(Number(finalMetadata?.turn_count || 0));
            setTurnThreshold(Number(finalMetadata?.turn_threshold || 4));
            showResponseImmediately(displayResponse);
            return;
          }

          try {
            const parsed = JSON.parse(data);
           
            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              const chunkText = parsed.text || '';
              if (chunkText) {
                // Append raw chunk to buffer ref
                streamBufferRef.current += chunkText;
                // Get safe version of the WHOLE accumulated buffer for display
                const safeContent = getSafeMarkdown(streamBufferRef.current);
                // Update current response with safe content
                setCurrentResponse(safeContent);
                setHasResponse(true);
                // We still schedule the UI update but setCurrentResponse handles the immediate display
                scheduleStreamUiUpdate();
              }
            } else if (parsed.type === 'done') {
              finalMetadata = parsed;
              const fd = typeof parsed.answer === 'string' ? parsed.answer : '';
              const fb = streamBufferRef.current || '';
              const finalResponse = fd.length >= fb.length ? (fd || fb) : fb;
              streamBufferRef.current = finalResponse;
              flushStreamUiUpdate();
              const displayResponse = formatResponseForDisplay(finalResponse, {
                used_secret_prompt: false,
                learning_mode: !!finalMetadata?.learning_mode,
                learning_payload: finalMetadata?.learning_payload || null,
              });
              setCurrentResponse(displayResponse);
              setIsLoading(false);
              showResponseImmediately(displayResponse);
              notifyResponseComplete();
            } else if (parsed.type === 'error') {
              const errMsg = parsed.message ?? parsed.error;
              const synthetic = new Error(
                typeof errMsg === 'string' ? errMsg : (errMsg?.message || errMsg?.detail || 'An error occurred')
              );
              synthetic.code = parsed.code;
              synthetic.details = parsed.details;
              if (!showQuotaError(synthetic)) {
                setError(getChatModelQuotaUserMessage(synthetic) || synthetic.message);
              }
              setIsLoading(false);
            }
          } catch (e) {
            console.warn('[chatWithDocument] Failed to parse SSE line:', e, data);
          }
        }
      }
    } catch (error) {
      console.error('[chatWithDocument] Streaming error:', error);
      if (error.message && error.message.includes('No content found')) {
        setError('Document is still processing. Please wait a few moments and try again.');
      } else if (!showQuotaError(error)) {
        setError(getChatModelQuotaUserMessage(error) || `Chat failed: ${error.message}`);
      }
      setIsLoading(false);
      throw error;
    } finally {
      cancelStreamUiSchedule();
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
      streamReaderRef.current = null;
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    console.log('Files selected:', files.length);
    if (files.length === 0) return;

    if (limitsLoading) {
      setError('Loading upload limits from server… Please try again in a moment.');
      event.target.value = '';
      return;
    }
    if (limitsError || maxUploadBytes == null) {
      setError('Could not load upload limits (llm_chat_config). Please refresh the page.');
      event.target.value = '';
      return;
    }

    const maxSize = maxUploadBytes;

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ];
    
    let hasFileSizeError = false;
    const validFiles = files.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        setError(`File "${file.name}" has an unsupported type.`);
        return false;
      }
      
      if (file.size > maxSize) {
        const fileSizeFormatted = formatFileSize(file.size);
        console.log('File size limit exceeded:', { fileName: file.name, fileSize: fileSizeFormatted, maxSizeMB: maxUploadMbLabel });
        hasFileSizeError = true;
        setFileSizeLimitError({
          message: formatUploadLimitExceededMessage({
            fileName: file.name,
            fileSizeFormatted,
            limitMbLabel: maxUploadMbLabel,
          }),
        });
        return false;
      }
      
      return true;
    });
   
    if (validFiles.length > 0) {
      setFileSizeLimitError(null);
    }
   
    if (validFiles.length === 0) {
      if (!hasFileSizeError) {
        event.target.value = '';
      } else {
        setTimeout(() => {
          if (event.target) {
            event.target.value = '';
          }
        }, 100);
      }
      return;
    }

    if (validFiles.length > 0) {
      const maxFilesFromLimits =
        limits?.max_upload_files != null ? Math.max(1, Number(limits.max_upload_files)) : 8;
      let toUpload = validFiles;
      if (validFiles.length > maxFilesFromLimits) {
        setError(
          `Only the first ${maxFilesFromLimits} file(s) are uploaded (maximum ${maxFilesFromLimits} per selection).`
        );
        toUpload = validFiles.slice(0, maxFilesFromLimits);
      }

      try {
        if (toUpload.length === 1) {
          const fileToUpload = toUpload[0];
          const isAddingToChat =
            Boolean(fileId) || chatAttachmentFileIdsRef.current.length > 0 || sessionMessages.length > 0;
          if (!isAddingToChat) {
            setDocumentData({
              name: fileToUpload.name,
              originalName: fileToUpload.name,
              size: fileToUpload.size,
              type: fileToUpload.type,
              uploadedAt: new Date().toISOString(),
            });
          }
          const result = await uploadDocumentToChat(fileToUpload);
          console.log('[handleFileUpload] Document uploaded successfully:', result);
        } else {
          setDocumentData({
            name: `${toUpload.length} documents`,
            originalName: toUpload.map((f) => f.name).join(', '),
            size: toUpload.reduce((s, f) => s + f.size, 0),
            type: 'multi',
            uploadedAt: new Date().toISOString(),
          });
          for (const f of toUpload) {
            await uploadDocumentToChat(f, { skipFinalize: true });
          }
          setIsChatUploading(false);
          setUploadProgress(100);
          setSuccess(
            `${toUpload.length} documents uploaded successfully. You can ask questions about all of them.`
          );
          setHasResponse(true);
          setStreamingStatus('ready');
          setStreamingMessage('Documents ready. You can now ask questions.');
          fetchChatModelFiles();
          console.log('[handleFileUpload] Multi-document upload finished');
        }
      } catch (error) {
        console.error('[handleFileUpload] Upload error:', error);
        setError(`Failed to upload document: ${error.message}`);
        setDocumentData(null);
        setIsChatUploading(false);
      }
    }
   
    event.target.value = '';
  };

  // Handle Google Drive file upload for ChatModel
  const handleGoogleDriveUpload = async (files) => {
    console.log('[handleGoogleDriveUpload] Files selected from Google Drive:', files);
    
    if (!files || files.length === 0) {
      console.log('[handleGoogleDriveUpload] No files received');
      return;
    }

    // For ChatModel, we'll process the first file (single file upload workflow)
    const file = files[0];
    
    try {
      setIsChatUploading(true);
      setUploadProgress(0);
      setError(null);

      // Get access token
      let tokenData;
      try {
        tokenData = await googleDriveApi.getAccessToken();
      } catch (error) {
        if (error.response?.data?.needsAuth) {
          setError('Google Drive authorization expired. Please reconnect your Google Drive.');
          setIsChatUploading(false);
          return;
        }
        throw error;
      }

      const accessToken = tokenData.accessToken;
      const driveFileId = file.id || file.fileId;

      if (!driveFileId) {
        setError('File ID is missing from selected file');
        setIsChatUploading(false);
        return;
      }

      console.log('[handleGoogleDriveUpload] Uploading file to ChatModel:', driveFileId);

      setUploadProgress(20);

      // Call ChatModel Google Drive upload endpoint
      const token = getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      setUploadProgress(40);

      const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/google-drive/upload`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileId: driveFileId,
          accessToken,
        }),
      });

      setUploadProgress(70);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `Upload failed with status ${response.status}`;
        
        if (errorData.needsAuth) {
          setError('Google Drive authorization expired. Please reconnect your Google Drive.');
        } else {
          setError(`Failed to upload from Google Drive: ${errorMessage}`);
        }
        setIsChatUploading(false);
        return;
      }

      const result = await response.json();
      console.log('[handleGoogleDriveUpload] Upload response:', result);

      setUploadProgress(90);

      const uploadedFileId = result.data?.file_id || result.file_id;

      if (!uploadedFileId) {
        setError('No file_id returned from upload');
        setIsChatUploading(false);
        return;
      }

      console.log('[handleGoogleDriveUpload] Extracted file_id:', uploadedFileId);

      const priorIds =
        chatAttachmentFileIdsRef.current.length > 0
          ? [...chatAttachmentFileIdsRef.current]
          : fileId
            ? [fileId]
            : [];
      const nextAttachmentIds = [...new Set([...priorIds, uploadedFileId])];
      chatAttachmentFileIdsRef.current = nextAttachmentIds;

      if (!fileId) {
        setFileId(uploadedFileId);
      }

      setUploadedFileId(uploadedFileId);
      setUploadProgress(100);
      setCacheSessionData(null);

      const uploadedName = result.data?.filename || file.name;
      if (nextAttachmentIds.length > 1) {
        setDocumentData((prev) => {
          const prevNames = prev?.originalName && !String(prev.originalName).includes(',')
            ? prev.originalName
            : prev?.originalName?.split(', ').filter(Boolean).join(', ') || '';
          const combinedNames = prevNames ? `${prevNames}, ${uploadedName}` : uploadedName;
          return {
            name: `${nextAttachmentIds.length} documents`,
            originalName: combinedNames,
            size: (prev?.size || 0) + (result.data?.size || file.sizeBytes || 0),
            type: 'multi',
            uploadedAt: new Date().toISOString(),
          };
        });
      } else {
        setDocumentData({
          name: uploadedName,
          originalName: uploadedName,
          size: result.data?.size || file.sizeBytes || 0,
          type: result.data?.mimetype || file.mimeType,
          uploadedAt: new Date().toISOString(),
        });
      }

      setTimeout(() => {
        setIsChatUploading(false);
        setSuccess(
          nextAttachmentIds.length > 1
            ? `Document added. ${nextAttachmentIds.length} documents are attached — a new combined cache will be created on your next question.`
            : 'Document uploaded from Google Drive successfully! You can now ask questions about it.'
        );
        
        setHasResponse(true);
        
        setStreamingStatus('ready');
        setStreamingMessage(
          nextAttachmentIds.length > 1
            ? `${nextAttachmentIds.length} documents ready. Ask a question about any or all of them.`
            : 'Document ready. You can now ask questions about it.'
        );

        fetchChatModelFiles();
        countDocumentTokens(nextAttachmentIds[0]);
      }, 500);

    } catch (error) {
      console.error('[handleGoogleDriveUpload] Error:', error);
      setError(`Failed to upload from Google Drive: ${error.message}`);
      setIsChatUploading(false);
    }
  };

  const handleDropdownSelect = (secretName, secretId, llmName) => {
    if (isLoading || isGeneratingInsights) return;

    const secret = secrets.find((s) => s.id === secretId);
    if (!secret) {
      setError(`Selected analysis prompt "${secretName}" is no longer available. Please refresh the page.`);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
      setShowDropdown(false);
      return;
    }

    flushSync(() => {
      setActiveDropdown(secretName);
      setSelectedSecretId(secretId);
      setSelectedLlmName(llmName);
      setIsSecretPromptSelected(true);
      setChatInput('');
      setShowDropdown(false);
    });
    void handleSend(
      { preventDefault: () => {} },
      { secretId, llmName, secretName }
    );
  };

  // Regenerate a past response: re-run the same question through the flow
  // that produced it (secret prompt / file chat / general chat).
  const handleRetryMessage = (msg) => {
    if (isLoading || isGeneratingInsights || !msg) return;
    if (msg.used_secret_prompt && msg.secret_id) {
      void handleSend(
        { preventDefault: () => {} },
        { secretId: msg.secret_id, secretName: msg.prompt_label }
      );
      return;
    }
    if (!msg.question) return;
    if (msg.file_id) {
      askQuestionToChat(msg.question, msg.file_id, [msg.file_id], msg.display_text_left_panel || null).catch(() => {});
    } else {
      askGeneralQuestionToChat(msg.question, msg.display_text_left_panel || null).catch(() => {});
    }
  };

  const resizeChatInput = useCallback(() => {
    const ta = chatInputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const nextHeight = Math.min(Math.max(ta.scrollHeight, CHAT_INPUT_MIN_HEIGHT), CHAT_INPUT_MAX_HEIGHT);
    ta.style.height = `${nextHeight}px`;
    ta.style.overflowY = ta.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeChatInput();
  }, [chatInput, resizeChatInput]);

  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown('Custom Query');
    }
    requestAnimationFrame(resizeChatInput);
  };

  const handleChatInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSendButtonDisabled) {
        handleSend(e);
      }
    }
  };

  const handleSend = async (e, secretOverride = null, customPrompt = null) => {
    if (e?.preventDefault) e.preventDefault();

    // Prevent double-submission while a request is in flight
    if (isLoading || isGeneratingInsights) return;
    ensureNotificationPermission();

    const secretPromptMode = Boolean(secretOverride?.secretId) || isSecretPromptSelected;
    const effectiveSecretId = secretOverride?.secretId ?? selectedSecretId;
    const effectiveLlmName = secretOverride?.llmName ?? selectedLlmName;

    const hasFile = Boolean(fileId);

    if (secretPromptMode) {
      if (!hasFile) {
        setError('Please upload a document before running an analysis prompt.');
        return;
      }
      if (!effectiveSecretId) {
        setError('Please select an analysis type.');
        return;
      }
     
      const selectedSecret = secrets.find((s) => s.id === effectiveSecretId);
      if (!selectedSecret) {
        setError(`Selected analysis prompt is no longer available. Please select a different one.`);
        setSelectedSecretId(null);
        setIsSecretPromptSelected(false);
        setActiveDropdown('Custom Query');
        return;
      }
     
      const promptLabel = secretOverride?.secretName || selectedSecret.name || 'Secret Prompt';
      const secretAttachmentIds =
        chatAttachmentFileIdsRef.current.length > 0
          ? chatAttachmentFileIdsRef.current
          : fileId
            ? [fileId]
            : [];
      try {
        setIsGeneratingInsights(true);
        setError(null);
        console.log('[handleSend] Triggering secret analysis with streaming:', {
          secretId: effectiveSecretId,
          fileId: secretAttachmentIds[0],
          file_ids: secretAttachmentIds.length > 1 ? secretAttachmentIds : undefined,
          additionalInput: chatInput.trim(),
          promptLabel: promptLabel,
          llmName: effectiveLlmName,
        });
       
        setCurrentResponse('');
        streamBufferRef.current = '';
        streamingGeneratingFiredRef.current = false;
      setStreamStarted(false);
        loopAbortedRef.current = false;
        loopCharsRef.current   = 0;
        loopAbortControllerRef.current = new AbortController();
        setStreamingStatus('initializing');
        setStreamingMessage('Starting chat request...');
        startProcessingTimeline(`Analysis: ${promptLabel}`, 'initializing', 'Starting chat request...');
       
        if (streamReaderRef.current) {
          try {
            await streamReaderRef.current.cancel();
          } catch (e) {
          }
          streamReaderRef.current = null;
        }
       
        cancelStreamUiSchedule();

        streamBufferRef.current = '';
        let newSessionId = sessionId;
        let finalMetadata = null;
        const messageId = Date.now();

        const newChat = {
          id: messageId,
          file_id: secretAttachmentIds[0] || fileId,
          session_id: sessionId,
          question: promptLabel,
          answer: '',
          display_text_left_panel: `Analysis: ${promptLabel}`,
          timestamp: new Date().toISOString(),
          type: 'chat',
          used_secret_prompt: true,
          prompt_label: promptLabel,
          secret_id: effectiveSecretId,
          isStreaming: true,
          sources: [],
        };
        setMessages((prev) => [
          ...prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m),
          newChat,
        ]);
        setSelectedMessageId(messageId);
        setHasResponse(true);
        setChatInput('');
       
        setCurrentResponse('');
        setAnimatedResponseContent('');

        await apiService.askChatModelQuestionStream(
          '',
          secretAttachmentIds[0] || fileId,
          sessionId,
          (text) => {
            if (typeof text === 'string') {
              appendStreamChunk(text);
              setHasResponse(true);
            }
          },
          (status, message) => {
            console.log('[Secret Prompt] Status:', status, message);
            setStreamingStatus(status);
            setStreamingMessage(
              status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
            );
            pushProcessingStep(status, message || getStatusMessage(status));
          },
          (metadata) => {
            console.log('[Secret Prompt] Metadata:', metadata);
            if (metadata.session_id || metadata.sources) {
              if (metadata.session_id) {
                newSessionId = metadata.session_id;
                setSessionId(metadata.session_id);
              }
              setMessages((prev) => {
                const updated = prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        ...(metadata.session_id ? { session_id: metadata.session_id } : {}),
                        ...(metadata.sources ? { sources: metadata.sources } : {}),
                      }
                    : msg
                );
                return updated;
              });
            }
          },
          (doneData) => {
            console.log('[Secret Prompt] Stream complete:', doneData);
            finalMetadata = doneData;
            const sFromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
            const sFromBuf = streamBufferRef.current || '';
            const finalResponse = sFromDone.length >= sFromBuf.length ? (sFromDone || sFromBuf) : sFromBuf;
            streamBufferRef.current = finalResponse;
            flushStreamUiUpdate();
            console.log('[Secret Prompt] Final response length:', finalResponse.length);
            console.log('[Secret Prompt] Response preview:', finalResponse.substring(0, 200));
           
            if (doneData && doneData.session_id) {
              newSessionId = doneData.session_id;
            }
           
            if (!finalResponse || finalResponse.trim().length === 0) {
              console.error('[Secret Prompt] Empty response received!');
              setError('Received empty response from server. Please try again.');
              setIsGeneratingInsights(false);
              setStreamingStatus(null);
              setStreamingMessage('');
              clearProcessingTimeline();
              return;
            }
           
            let cleanedResponse = finalResponse;
           
            const jsonMatch = finalResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch) {
              cleanedResponse = jsonMatch[1].trim();
              console.log('[Secret Prompt] Extracted JSON from markdown code block');
            }
           
            const isStructured = isStructuredJsonResponse(cleanedResponse) || isStructuredJsonResponse(finalResponse);
            console.log('[Secret Prompt] Final response is structured JSON:', isStructured);
            console.log('[Secret Prompt] Final response preview (first 500 chars):', finalResponse.substring(0, 500));
           
            const responseToStore = finalResponse;
           
            let responseToDisplay;
            if (isStructured) {
              try {
                responseToDisplay = renderSecretPromptResponse(cleanedResponse);
                if (!responseToDisplay || responseToDisplay.trim().length < 50) {
                  responseToDisplay = renderSecretPromptResponse(finalResponse);
                }
              } catch (e) {
                console.warn('[Secret Prompt] Error formatting cleaned response, trying original:', e);
                responseToDisplay = renderSecretPromptResponse(finalResponse);
              }
            } else {
              responseToDisplay = convertJsonToPlainText(finalResponse);
            }
           
            console.log('[Secret Prompt] Response formatted, length:', responseToDisplay.length);
            console.log('[Secret Prompt] Formatted response preview (first 500 chars):', responseToDisplay.substring(0, 500));
           
            console.log('[Secret Prompt] Updating message:', {
              messageId,
              secretId: effectiveSecretId,
              promptLabel,
              responseLength: responseToStore.length
            });
            setMessages((prev) => {
              const updated = prev.map((msg) => {
                if (msg.id === messageId) {
                  console.log('[Secret Prompt] Updating message with secret_id:', effectiveSecretId, 'prompt_label:', promptLabel);
                  return {
                    ...msg,
                    answer: responseToStore,
                    session_id: newSessionId,
                    isStreaming: false,
                    used_secret_prompt: true,
                    prompt_label: promptLabel,
                    secret_id: effectiveSecretId,
                    learning_payload: doneData?.learning_payload || null,
                    learning_mode: !!doneData?.learning_mode,
                    sources: doneData?.sources || msg.sources || [],
                  };
                }
                return msg;
              });
              console.log('[Secret Prompt] Updated messages. Messages with secret prompts:', updated.filter(m => m.used_secret_prompt).map(m => ({
                id: m.id,
                secret_id: m.secret_id,
                prompt_label: m.prompt_label
              })));
              return updated;
            });
           
            setSelectedMessageId(messageId);
            setSessionId(newSessionId);
            assistantDisplayCacheRef.current.delete(messageId);
            setStreamResetKey((k) => k + 1);
            if (doneData?.used_gemini_cache) {
              setUseCache(true);
              if (doneData.cache_session_metrics) {
                setCacheSessionData(doneData.cache_session_metrics);
              }
            }
            if (doneData?.token_usage) {
              setSessionTokenUsage((prev) => ({
                inputTokens:  prev.inputTokens  + (doneData.token_usage.inputTokens  || 0),
                outputTokens: prev.outputTokens + (doneData.token_usage.outputTokens || 0),
                totalTokens:  prev.totalTokens  + (doneData.token_usage.totalTokens  || 0),
                modelName: doneData.token_usage.modelName || 'gemini-2.5-flash',
              }));
            }
            setCurrentResponse(responseToDisplay);
            setAnimatedResponseContent(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setHasResponse(true);
            setSuccess('Analysis completed successfully!');
            setIsGeneratingInsights(false);
            notifyResponseComplete({ title: 'Analysis ready', body: 'JuriNex has finished your document analysis.' });
            setStreamingStatus(null);
            setStreamingMessage('');
            clearProcessingTimeline();
            setIsSecretPromptSelected(false);
            setActiveDropdown('Custom Query');
            setTurnCount(Number(doneData?.turn_count || 0));
            setTurnThreshold(Number(doneData?.turn_threshold || 4));
          },
          (error) => {
            console.error('[Secret Prompt] Error:', error);
            setError(`Analysis failed: ${error}`);
            setIsGeneratingInsights(false);
            setStreamingStatus(null);
            setStreamingMessage('');
            clearProcessingTimeline();
          },
          effectiveSecretId,
          true,
          promptLabel,
          chatInput.trim() || '',
          effectiveLlmName,
          {
            ...chatModelStreamFetchParams,
            web_search: citationMode,
            learning_mode: learningModeActive,
            document_context: learningModeActive ? getLearningDocumentContext() : undefined,
          },
          secretAttachmentIds.length > 1 ? secretAttachmentIds : null,
          (thoughtText) => {
            if (typeof thoughtText === 'string' && thoughtText) {
              setReasoningText((prev) => `${prev}${thoughtText}`);
            }
          },
          loopAbortControllerRef.current?.signal ?? null
        );
      } catch (error) {
        console.error('[handleSend] Analysis error:', error);
        if (error.message && error.message.includes('No content found')) {
          setError('Document is still processing. Please wait a few moments and try again.');
        } else if (!showQuotaError(error)) {
          setError(getChatModelQuotaUserMessage(error) || `Analysis failed: ${error.message}`);
        }
        setStreamingStatus(null);
        setStreamingMessage('');
        clearProcessingTimeline();
      } finally {
        setIsGeneratingInsights(false);
        streamReaderRef.current = null;
      }
    } else {
      // A custom prompt sends its full body to the model but is shown in the
      // thread by name only — same as a preset prompt.
      let question = (customPrompt?.prompt_text || chatInput).trim();
      if (!question) {
        if (citationMode) {
          question = "Find relevant judgements and case law for this matter.";
        } else {
          setError('Please enter a question.');
          return;
        }
      }

      const currentStatus = processingStatus?.status;
      const currentProgress = progressPercentage || 0;
      const isActivelyProcessing =
        currentStatus &&
        (currentStatus === 'processing' ||
          currentStatus === 'batch_processing' ||
          currentStatus === 'queued' ||
          currentStatus === 'pending');
      const isProcessingComplete =
        !currentStatus || currentStatus === 'processed' || currentProgress >= 100;

      if (hasFile) {
        if (currentStatus === 'error') {
          setError('Document processing failed. Please upload a new document.');
          return;
        }
        if (isActivelyProcessing && !isProcessingComplete) {
          setError('Document is still being processed. Please wait until processing is complete.');
          return;
        }
      }

      try {
        const currentFileId = uploadedFileId || fileId;
        const displayLabel =
          customPrompt?.name
          || ((citationMode && !chatInput.trim()) ? "Citation Search" : null);
        
        if (currentFileId) {
          const attachmentIds =
            chatAttachmentFileIdsRef.current.length > 0
              ? chatAttachmentFileIdsRef.current
              : [currentFileId];
          console.log('[handleSend] Document chat — file_id(s):', attachmentIds, 'session_id:', sessionId);
          await askQuestionToChat(question, attachmentIds[0], attachmentIds, displayLabel);
        } else {
          // No document uploaded — use general legal chat
          console.log('[handleSend] No document — routing to general legal chat, session_id:', sessionId);
          await askGeneralQuestionToChat(question, displayLabel);
        }
      } catch (error) {
        console.error('[handleSend] Chat error:', error);
        if (!showQuotaError(error)) {
          setError(getChatModelQuotaUserMessage(error) || error.message || 'Failed to get answer. Please try again.');
        }
      }
    }
  };


  const handleMessageClick = async (message) => {
    setSelectedMessageId(message.id);
   
    if (message.used_secret_prompt && message.secret_id) {
      const secret = secrets.find((s) => s.id === message.secret_id);
      if (secret) {
        setSelectedSecretId(message.secret_id);
        setIsSecretPromptSelected(true);
        setActiveDropdown(secret.name);
        setSelectedLlmName(secret.llm_name);
      } else {
        console.warn('[handleMessageClick] Secret ID from message not found in current secrets:', message.secret_id);
        console.warn('[handleMessageClick] Available secrets:', secrets.map(s => ({ id: s.id, name: s.name })));
        setSelectedSecretId(null);
        setIsSecretPromptSelected(false);
        setActiveDropdown('Custom Query');
        setSelectedLlmName(null);
      }
    } else {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
   
    const rawAnswer = message.answer || message.response || '';
    const responseToDisplay = formatResponseForDisplay(rawAnswer, message);
   
    setCurrentResponse(responseToDisplay);
    showResponseImmediately(responseToDisplay);
   
    if (message.file_id) {
      const currentFileId = fileId || message.file_id;
      if (currentFileId) {
        try {
          const status = await getProcessingStatus(currentFileId);
          if (status) {
            const finalStatus = status.status === 'processed' ? status : { ...status, status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(finalStatus.processing_progress || 100);
          } else {
            setProcessingStatus({ status: 'processed', processing_progress: 100 });
            setProgressPercentage(100);
          }
        } catch (error) {
          console.error('[handleMessageClick] Error checking status:', error);
          setProcessingStatus({ status: 'processed', processing_progress: 100 });
          setProgressPercentage(100);
        }
      }
    }
  };

  const clearAllChatData = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
      clearInterval(batchPollingIntervalsRef.current[fileId]);
    });
    batchPollingIntervalsRef.current = {};
    setActivePollingFiles(new Set());
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
      uploadIntervalRef.current = null;
    }
    setMessages([]);
    setDocumentData(null);
    setFileId(null);
    setCurrentResponse('');
    setHasResponse(false);
    setChatInput('');
    setProcessingStatus(null);
    setProgressPercentage(0);
    setError(null);
    setAnimatedResponseContent('');
    setIsAnimatingResponse(false);
    setBatchUploads([]);
    setUploadedDocuments([]);
    setIsSecretPromptSelected(false);
    setSelectedMessageId(null);
    setActiveDropdown('Custom Query');
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    console.log('[Session] New chat session created with UUID:', newSessionId);
    chatAttachmentFileIdsRef.current = [];
    // IMPORTANT: Clear localStorage to prevent old messages bleeding into new session
    localStorage.removeItem('messages');
    localStorage.removeItem('sessionId');
    localStorage.removeItem('currentResponse');
    localStorage.removeItem('animatedResponseContent');
    localStorage.removeItem('hasResponse');
    localStorage.removeItem('documentData');
    localStorage.removeItem('fileId');
    localStorage.removeItem('processingStatus');
    localStorage.removeItem('progressPercentage');
    setSessionTokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, modelName: '' });
    setFileTokenCount({ totalTokens: 0, modelName: '', mimeType: null, filename: null, isLoading: false, error: null });
    setSuccess('New chat session started!');
    // Refresh sessions list after a brief moment
    setTimeout(() => fetchChatSessions(), 500);
    navigate('/chatmodel', { replace: true });
  };

  const startNewChat = () => {
    clearAllChatData();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getStatusDisplayText = (status, progress = 0) => {
    switch (status) {
      case 'queued':
        return 'Queued...';
      case 'processing':
        if (progress >= 100) return 'Done';
        return progress < 50
          ? `Processing... (${Math.round(progress)}%)`
          : progress < 90
          ? `Analyzing... (${Math.round(progress)}%)`
          : `Finalizing... (${Math.round(progress)}%)`;
      case 'batch_processing':
        if (progress >= 100) return 'Done';
        return progress < 30
          ? `Batch Processing... (${Math.round(progress)}%)`
          : progress < 70
          ? `Processing Documents... (${Math.round(progress)}%)`
          : progress < 95
          ? `Analyzing Batch... (${Math.round(progress)}%)`
          : `Completing... (${Math.round(progress)}%)`;
      case 'processed':
        return progress >= 100 ? 'Done' : 'Processing...';
      case 'error':
      case 'failed':
        return 'Failed';
      default:
        return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    }
  };

  const handleCopyResponse = async () => {
    try {
      const textToCopy = animatedResponseContent || currentResponse;
      if (textToCopy) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = textToCopy;
        await navigator.clipboard.writeText(tempDiv.innerText);
        setSuccess('AI response copied to clipboard!');
      } else {
        setError('No response to copy.');
      }
    } catch (err) {
      console.error('Failed to copy AI response:', err);
      setError('Failed to copy response.');
    }
  };

  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="bg-yellow-200 font-semibold text-black">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  useEffect(() => {
    return () => {
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      cancelStreamUiSchedule();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    loadSecrets();
    loadCustomPromptGroups();
    fetchChatSessions();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'drafting') {
      openDraftingMode();
      params.delete('mode');
      const next = params.toString();
      navigate(
        { pathname: location.pathname, search: next ? `?${next}` : '' },
        { replace: true, state: location.state },
      );
    }
  }, [location.pathname, location.search, location.state, navigate, openDraftingMode]);

  // Refresh sessions list when a new message is sent (so sessions panel stays current)
  useEffect(() => {
    if (sessionMessages.length > 0) {
      // Update local sessions state with current session if newly created
      setChatSessions((prev) => {
        const currentSid = sessionId;
        const exists = prev.some((s) => s.session_id === currentSid);
        const firstMsg = sessionMessages[0];
        const sessionName = generateSessionName(firstMsg?.prompt_label || firstMsg?.display_text_left_panel || firstMsg?.question || '');
        if (!exists && currentSid) {
          const newSession = {
            session_id: currentSid,
            name: sessionName,
            first_question: firstMsg?.question || '',
            created_at: firstMsg?.timestamp || new Date().toISOString(),
            message_count: sessionMessages.length,
            is_general_chat: !fileId,
            file_id: fileId || null,
          };
          return [newSession, ...prev];
        }
        // Update message count and name for existing session
        return prev.map((s) =>
          s.session_id === currentSid
            ? { ...s, message_count: sessionMessages.length, name: s.name || sessionName }
            : s
        );
      });
    }
  }, [sessionMessages.length, sessionId]);

  // Format structured JSON responses (similar to AnalysisPage)
  useEffect(() => {
    if (selectedMessageId && sessionMessages.length > 0 && currentResponse) {
      const selectedMessage = sessionMessages.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawAnswer = selectedMessage.answer || selectedMessage.response || '';
        const shouldNormalize =
          currentResponse === rawAnswer ||
          isStructuredJsonResponse(currentResponse) ||
          Boolean(selectedMessage.learning_payload);
        if (shouldNormalize) {
          const formattedResponse = formatResponseForDisplay(rawAnswer, selectedMessage);
          if (formattedResponse !== currentResponse) {
            setCurrentResponse(formattedResponse);
            setAnimatedResponseContent(formattedResponse);
          }
        }
      }
    }
  }, [selectedMessageId, sessionMessages, currentResponse]);

  // When the active session changes, drop selection/response that belong to another session.
  useEffect(() => {
    if (!sessionId) return;
    const list = messages.filter(
      (m) => m.session_id != null && String(m.session_id) === String(sessionId)
    );
    if (list.length === 0) {
      if (selectedMessageId != null) setSelectedMessageId(null);
      setCurrentResponse('');
      setAnimatedResponseContent('');
      // Don't clear hasResponse when a file is loaded — it's a fresh session with no messages yet.
      // fileId being set means the user uploaded a document and is ready to chat.
      if (!fileId) {
        setHasResponse(false);
      }
      return;
    }
    const stillValid =
      selectedMessageId != null && list.some((m) => m.id === selectedMessageId);
    if (!stillValid && selectedMessageId != null) {
      const last = list[list.length - 1];
      setSelectedMessageId(last.id);
      const rawAnswer = last.answer || '';
      const responseToDisplay = formatResponseForDisplay(rawAnswer, last);
      setCurrentResponse(responseToDisplay);
      setAnimatedResponseContent(responseToDisplay);
      setIsAnimatingResponse(false);
      setHasResponse(true);
    }
  }, [sessionId, messages, selectedMessageId, fileId]);



  useEffect(() => {
    const fetchChatHistory = async (currentFileId, currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for fileId:', currentFileId);
        const response = await apiRequest(`/files/chat-history/${currentFileId}`, {
          method: 'GET',
        });
        const sessions = response || [];
        let allMessages = [];
        sessions.forEach((session) => {
          session.messages.forEach((message) => {
            allMessages.push({
              ...message,
              session_id: session.session_id,
              timestamp: message.created_at || message.timestamp,
              display_text_left_panel:
                message.used_secret_prompt
                  ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                  : message.question,
            });
          });
        });
        if (currentSessionId) {
          allMessages = allMessages.filter((msg) => msg.session_id === currentSessionId);
        }
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
        if (allMessages.length > 0) {
          const fileStatus = await getProcessingStatus(currentFileId);
          const actualStatus = 'processed';
          const actualProgress = 100;
         
          const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
         
          setDocumentData({
            id: currentFileId,
            title: `Document for Session ${currentSessionId}`,
            originalName: `Document for Session ${currentSessionId}`,
            size: 0,
            type: 'unknown',
            uploadedAt: new Date().toISOString(),
            status: actualStatus,
            processingProgress: actualProgress,
          });
          setFileId(currentFileId);
          setSessionId(currentSessionId);
          setProcessingStatus(finalStatus);
          setProgressPercentage(actualProgress);
          setHasResponse(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const responseToDisplay = formatResponseForDisplay(rawAnswer, chatToDisplay);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistory:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    const fetchChatHistoryBySessionId = async (currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for sessionId:', currentSessionId);
        const response = await apiRequest(`/files/session/${currentSessionId}`, {
          method: 'GET',
        });
       
        let allMessages = [];
        if (Array.isArray(response)) {
          allMessages = response.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.messages && Array.isArray(response.messages)) {
          allMessages = response.messages.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.sessions && Array.isArray(response.sessions)) {
          response.sessions.forEach((session) => {
            if (session.messages && Array.isArray(session.messages)) {
              session.messages.forEach((message) => {
                allMessages.push({
                  ...message,
                  session_id: session.session_id || currentSessionId,
                  timestamp: message.created_at || message.timestamp,
                  display_text_left_panel:
                    message.used_secret_prompt
                      ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                      : message.question,
                });
              });
            }
          });
        }
       
        const extractedFileId = allMessages.length > 0
          ? (allMessages[0].file_id || response.file_id || null)
          : null;
       
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
       
        if (allMessages.length > 0) {
          if (extractedFileId) {
            setFileId(extractedFileId);
            const fileStatus = await getProcessingStatus(extractedFileId);
            const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(100);
           
            setDocumentData({
              id: extractedFileId,
              title: `Document for Session ${currentSessionId}`,
              originalName: `Document for Session ${currentSessionId}`,
              size: 0,
              type: 'unknown',
              uploadedAt: new Date().toISOString(),
              status: 'processed',
              processingProgress: 100,
            });
          }
         
          setSessionId(currentSessionId);
          setHasResponse(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const responseToDisplay = formatResponseForDisplay(rawAnswer, chatToDisplay);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistoryBySessionId:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    try {
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const status = JSON.parse(savedProcessingStatus);
        const processingStatuses = ['processing', 'batch_processing', 'batch_queued', 'queued', 'pending'];
        if (processingStatuses.includes(status.status?.toLowerCase())) {
          console.log('🧹 Clearing stale processing state from localStorage');
          localStorage.removeItem('processingStatus');
          localStorage.removeItem('progressPercentage');
          localStorage.removeItem('isUploading');
        }
      }
    } catch (err) {
      console.error('Error cleaning up processing state:', err);
    }

    // URL / navigation state first so refresh and deep links do not lose the chat to localStorage.
    if (location.state?.newChat) {
      clearAllChatData();
      window.history.replaceState({}, document.title);
      return;
    }

    if (paramFileId && paramSessionId) {
      console.log('[DB] Resuming past session from URL params:', {
        file_id: paramFileId,
        session_id: paramSessionId,
        source: 'URL params',
      });
      setFileId(paramFileId);
      chatAttachmentFileIdsRef.current = [paramFileId];
      setSessionId(paramSessionId);
      setHasResponse(true);
      fetchChatModelHistory(paramFileId, paramSessionId);
      window.history.replaceState({}, document.title);
      return;
    }

    if (paramFileId && !paramSessionId) {
      console.log('[ChatModelPage] Loading chat from fileId only (resolve latest session):', { paramFileId });
      setFileId(paramFileId);
      chatAttachmentFileIdsRef.current = [paramFileId];
      setMessages([]);
      setChatModelHistory([]);
      setSelectedMessageId(null);
      setCurrentResponse('');
      setAnimatedResponseContent('');
      (async () => {
        try {
          const sessRes = await apiService.getChatModelSessions(paramFileId);
          if (sessRes.success && sessRes.data?.sessions?.length) {
            const latest = sessRes.data.sessions[0];
            setSessionId(latest.session_id);
            setHasResponse(true);
            await fetchChatModelHistory(paramFileId, latest.session_id);
          } else {
            const nid = crypto.randomUUID();
            setSessionId(nid);
            setHasResponse(false);
            await fetchChatModelHistory(paramFileId, nid);
          }
        } catch (e) {
          console.error('[ChatModelPage] Failed to resolve session for file:', e);
          setError('Failed to load document chats');
        }
      })();
      return;
    }

    // /chatmodel/session/:sessionId — general LLM chat (refresh-safe)
    if (paramSessionId && !paramFileId) {
      console.log('[ChatModelPage] General chat from URL:', paramSessionId);
      setFileId(null);
      setDocumentData(null);
      chatAttachmentFileIdsRef.current = [];
      setSessionId(paramSessionId);
      setHasResponse(true);
      const msgs = messagesRef.current;
      const skipFetch =
        msgs.length > 0 &&
        msgs.every((m) => !m.isStreaming) &&
        msgs.some((m) => String(m.session_id || sessionId || '') === String(paramSessionId));
      if (!skipFetch) {
        setMessages([]);
        fetchGeneralChatHistory(paramSessionId);
      }
      window.history.replaceState({}, document.title);
      return;
    }

    if (location.state?.chat) {
      const chatData = location.state.chat;
      console.log('[DB] Resuming past session from navigation state:', {
        file_id: chatData.file_id,
        session_id: chatData.session_id,
        chat_id: chatData.id,
        source: 'location.state.chat',
      });
      if (chatData.is_general_chat || (!chatData.file_id && chatData.session_id)) {
        // General legal chat — load by session only (no document)
        console.log('[DB] Resuming general legal chat session:', chatData.session_id);
        setSessionId(chatData.session_id);
        setHasResponse(true);
        fetchGeneralChatHistory(chatData.session_id);
      } else if (chatData.file_id && chatData.session_id) {
        setFileId(chatData.file_id);
        chatAttachmentFileIdsRef.current = [chatData.file_id];
        setSessionId(chatData.session_id);
        setHasResponse(true);
        fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
      } else if (chatData.session_id) {
        console.log('[DB] Loading chat by session_id only:', chatData.session_id);
        setSessionId(chatData.session_id);
        setHasResponse(true);
        fetchChatHistoryBySessionId(chatData.session_id, chatData.id);
      } else {
        setError('Unable to load chat: Missing required information (session_id or file_id)');
      }
      window.history.replaceState({}, document.title);
      return;
    }

    try {
      // Generate a fresh session ID — don't restore old session to prevent message bleeding
      // Each page load without explicit URL params gets a clean slate
      const newSessionId = crypto.randomUUID();
      console.log('[Session] Fresh page load — new session UUID:', newSessionId);
      setSessionId(newSessionId);
      // Clear any stale localStorage data
      localStorage.removeItem('messages');
      localStorage.removeItem('sessionId');
      localStorage.removeItem('currentResponse');
      localStorage.removeItem('animatedResponseContent');
      localStorage.removeItem('hasResponse');
      localStorage.removeItem('documentData');
      localStorage.removeItem('fileId');
    } catch (error) {
      console.error('[ChatModelPage] Error in init:', error);
      const newSessionId = crypto.randomUUID();
      setSessionId(newSessionId);
    }
  }, [location.state, paramFileId, paramSessionId]);

  // Keep URL in sync so refresh restores the same session (general vs document chat).
  useEffect(() => {
    if (location.state?.newChat) return;
    if (!sessionId) return;
    if (fileId) {
      const target = `/chatmodel/${fileId}/${sessionId}`;
      if (location.pathname !== target) {
        navigate(target, { replace: true });
      }
      return;
    }
    if (location.pathname.startsWith('/chatmodel/session/')) return;
    if (location.pathname !== '/chatmodel') return;
    if (!hasResponse && messagesRef.current.length === 0) return;
    navigate(`/chatmodel/session/${encodeURIComponent(sessionId)}`, { replace: true });
  }, [sessionId, fileId, hasResponse, navigate, location.pathname, location.state?.newChat, messages.length]);

  useEffect(() => {
    if (isChatActive) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(true);
    } else {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    }
  }, [hasResponse, isChatActive, setIsSidebarHidden, setIsSidebarCollapsed]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);




  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const markdownComponents = {
    h1: ({ node, ...props }) => (
      <h1
        className="text-[24px] font-bold mb-5 mt-7 text-[#1a3d2b] bg-[#e8f4ee] border-l-4 border-[#1f6b5f] px-4 py-2 rounded-r-md analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h2: ({ node, ...props }) => (
      <h2
        className="text-[20px] font-bold mb-4 mt-6 text-[#1a3d2b] bg-[#eef7f2] border-l-4 border-[#2d8c72] px-4 py-2 rounded-r-md analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h3: ({ node, ...props }) => (
      <h3
        className="text-[17px] font-semibold mb-3 mt-5 text-[#1f3d30] bg-[#f3faf6] border-l-3 border-[#4aab87] px-3 py-1.5 rounded-r analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h4: ({ node, ...props }) => (
      <h4
        className="text-[15px] font-semibold mb-2 mt-4 text-[#2a4a38] bg-[#f7fcf9] border-l-2 border-[#6bbfa0] px-3 py-1 rounded-r analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h5: ({ node, ...props }) => (
      <h5 className="text-[14px] font-semibold mb-2 mt-3 text-gray-700 px-2 py-1 analysis-page-ai-response break-words" {...props} />
    ),
    h6: ({ node, ...props }) => (
      <h6 className="text-[13px] font-semibold mb-2 mt-2 text-gray-600 px-2 py-1 analysis-page-ai-response break-words" {...props} />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-4 leading-[1.9] text-[#2f2a22] text-[17px] analysis-page-ai-response break-words" {...props} />
    ),
    strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
    em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-7 mb-4 space-y-2 text-[#2f2a22]" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-7 mb-4 space-y-2 text-[#2f2a22]" {...props} />,
    li: ({ node, ...props }) => <li className="leading-[1.9] text-[#2f2a22] text-[17px] analysis-page-ai-response" {...props} />,
    a: ({ node, ...props }) => (
      <a
        className="text-[#0f766e] hover:text-[#1AA49B] underline decoration-2 underline-offset-2 font-semibold bg-[#e6fbf9] px-1 py-0.5 rounded transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="border-l-4 border-[#1f6b5f] pl-4 py-3 my-4 bg-gray-50 text-[#5b554a] italic rounded-r analysis-page-ai-response text-[16px] break-words"
        {...props}
      />
    ),
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      if (inline) {
        return (
          <code
            className="bg-gray-100 text-[#a53d2d] px-1.5 py-0.5 rounded text-[13px] font-mono border border-[#ddd6ca] break-all"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <div className="relative my-3 sm:my-4">
          {language && (
            <div className="bg-gray-800 text-gray-300 text-xs px-2 sm:px-3 py-1 rounded-t font-mono">
              {language}
            </div>
          )}
          <pre className={`bg-[#f3f4f6] text-[#243124] p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto border border-[#d8d1c5]`}>
            <code className="font-mono text-[13px]" {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
    pre: ({ node, ...props }) => (
      <pre className="bg-[#f3f4f6] text-[#243124] p-4 rounded my-4 overflow-x-auto text-[13px] border border-[#d8d1c5]" {...props} />
    ),
    table: ({ node, ...props }) => {
      const data = extractTableData(node);
      if (data) {
        return <InteractiveTable headers={data.headers} rows={data.rows} />;
      }
      return (
        <div className="my-6 rounded-lg border border-[#d6d0c4] block max-w-full overflow-hidden">
          <table className="border-collapse text-[14px] w-full" {...props} />
        </div>
      );
    },
    thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
    th: ({ node, ...props }) => (
      <th
        className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#5b554a] uppercase tracking-[0.12em] border-b border-r border-[#d6d0c4] whitespace-normal last:border-r-0 break-words"
        {...props}
      />
    ),
    tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-[#ece7de]" {...props} />,
    tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
    td: ({ node, ...props }) => (
      <td className="px-3 py-2.5 text-[14px] text-[#2f2a22] border-b border-r border-[#ece7de] align-top last:border-r-0 break-words" {...props} />
    ),
    hr: ({ node, ...props }) => <hr className="my-6 border-t border-[#d8d1c5]" {...props} />,
    img: ({ node, ...props }) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
  };

  const getInputPlaceholder = () => {
    if (isChatUploading || isUploading) {
      return 'Uploading document...';
    }
    if (isSecretPromptSelected) {
      return `Analysis: ${activeDropdown}...`;
    }
    if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
      return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
    }
    return 'How can I help you today?';
  };

  const hasAssistantContentForPanel =
    !!(currentResponse || animatedResponseContent) ||
    sessionMessages.some((m) => String(m.answer || m.response || '').trim());

  const isDocumentTransferBusy = isChatUploading || isUploading;

  const showDocumentPanel = false;

  const parseLearningPayloadFromRaw = (rawText) => {
    const text = String(rawText || '').trim();
    if (!text) return null;
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1].trim() : text;
    const withoutJsonPrefix = candidate.replace(/^\s*json\s*[\r\n]*/i, '').trim();
    const normalizedCandidate = withoutJsonPrefix.startsWith('{')
      ? withoutJsonPrefix
      : withoutJsonPrefix.replace(/^[^{]*({[\s\S]*})[^}]*$/m, '$1').trim();
    try {
      const parsed = JSON.parse(normalizedCandidate);
      if (parsed && typeof parsed === 'object' && (parsed.question || parsed.feedback || parsed.ui_type)) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  };

  const formatLearningPayloadToText = (payload) => {
    if (!payload || typeof payload !== 'object') return '';
    const feedback = String(payload.feedback || '').trim();
    const hint = String(payload.content_hint || '').trim();
    const question = String(payload.question || '').trim();
    const options = Array.isArray(payload.options) ? payload.options.filter(Boolean) : [];
    const lines = [];
    if (feedback) lines.push(feedback);
    if (hint) lines.push(`Hint: ${hint}`);
    if (question) lines.push(`Question: ${question}`);
    if (options.length) lines.push(`Options: ${options.join(' | ')}`);
    return lines.join('\n\n');
  };

  const formatResponseForDisplay = (rawAnswer, messageMeta = {}) => {
    const raw = String(rawAnswer || '');
    if (!raw.trim()) return '';

    const learningPayload = messageMeta.learning_payload || parseLearningPayloadFromRaw(raw);
    if (learningPayload) {
      const learningText = formatLearningPayloadToText(learningPayload);
      if (learningText) return learningText;
    }

    let formatted = formatChatResponseForDisplay(raw);
    if (
      (!formatted || isEmptyFormattedChatContent(formatted) || looksLikeRawJsonString(formatted)) &&
      (messageMeta.used_secret_prompt || isStructuredJsonResponse(raw))
    ) {
      const structured = renderSecretPromptResponse(raw);
      if (structured && !looksLikeRawJsonString(structured) && !isEmptyFormattedChatContent(structured)) {
        formatted = structured;
      }
    }
    if (!formatted || looksLikeRawJsonString(formatted)) {
      const plain = convertJsonToPlainText(raw);
      if (plain && !looksLikeRawJsonString(plain)) formatted = plain;
    }
    // Absolute last resort: strip code fences and show the raw content so the screen is never blank
    if (!formatted || isEmptyFormattedChatContent(formatted)) {
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      if (stripped && stripped.length > 20 && !looksLikeRawJsonString(stripped)) {
        formatted = stripped;
      }
    }
    return formatted || '';
  };

  const getLearningDocumentContext = () => {
    if (documentData?.full_text_content) return String(documentData.full_text_content);
    if (selectedMessage?.answer) return String(selectedMessage.answer);
    if (currentResponse) return String(currentResponse);
    return '';
  };

  // ── Unified mode selection (input-box dropdown) ────────────────────────────
  // One dropdown drives every mode explicitly: Chat, Learning, Citation Search,
  // Drafting Mode, and the expert preset prompts. Nothing is inferred from the
  // question text — the selected mode alone decides which pipeline runs.
  const clearSecretPromptSelection = () => {
    setIsSecretPromptSelected(false);
    setActiveDropdown('Custom Query');
    setSelectedSecretId(null);
    setSelectedLlmName(null);
  };

  const selectChatModeOption = (mode) => {
    setShowStyleDropdown(false);
    if (isLoading || isGeneratingInsights) return;
    if (mode === 'learning') {
      if (!fileId) {
        setError('Add a document first to use Learning Mode');
        return;
      }
      setChatMode('chat');
      setLearningModeActive(true);
      setTurnCount(0);
      setShowDraftingModal(false);
      clearSecretPromptSelection();
      return;
    }
    if (mode === 'citation') {
      setChatMode('citation');
      setLearningModeActive(false);
      setTurnCount(0);
      setShowDraftingModal(false);
      clearSecretPromptSelection();
      return;
    }
    if (mode === 'drafting') {
      openDraftingMode();
      return;
    }
    // 'chat' — plain conversation with the admin-configured model
    setChatMode('chat');
    setLearningModeActive(false);
    setTurnCount(0);
    setShowDraftingModal(false);
    clearSecretPromptSelection();
  };

  const currentModeLabel = showDraftingModal
    ? 'Drafting'
    : chatMode === 'citation'
      ? 'Citation'
      : learningModeActive
        ? 'Learning'
        : isSecretPromptSelected && activeDropdown && activeDropdown !== 'Custom Query'
          ? activeDropdown
          : 'Chat';

  // Expert preset prompts shown in the mode dropdown (built-ins get their own rows)
  const expertModePrompts = promptChips.filter((s) => !s.isCitation && !s.isDrafting);

  const handleLearningOptionSelect = async (optionText) => {
    const text = String(optionText || '').trim();
    if (!text || isLoading || isGeneratingInsights) return;
    setChatInput(text);
    if (fileId) {
      await askQuestionToChat(text, fileId, chatAttachmentFileIdsRef.current.length > 0 ? chatAttachmentFileIdsRef.current : null);
    } else {
      await askGeneralQuestionToChat(text);
    }
  };

  useEffect(() => {
    if (!fileId && learningModeActive) {
      setLearningModeActive(false);
      setTurnCount(0);
    }
  }, [fileId, learningModeActive]);

  // Stable callback — prevents TokenCostPopover from re-rendering on every
  // ChatModelPage render just because an inline arrow function changed identity.
  const handleCacheExpired = React.useCallback(() => {
    setCacheSessionData(prev => prev ? { ...prev, status: 'deleted' } : null);
  }, []);

  const hasSessions = chatSessions.length > 0;
  const sidebarSessions = useMemo(
    () =>
      chatSessions.map((s, index) => ({
        sessionId: s.session_id,
        title: s.name || `Session ${index + 1}`,
        lastMessageAt: s.created_at,
      })),
    [chatSessions]
  );

  const handleSelectChatSession = (sid) => {
    const session = chatSessions.find((s) => s.session_id === sid);
    if (session) handleSessionClick(session);
  };

  const getAssistantDisplayForMessage = (msg, idx) => {
    const raw = msg.answer || msg.response || '';
    const isSelected = msg.id === selectedMessageId;
    const isLiveStream =
      msg.isStreaming &&
      isSelected &&
      (isLoading || isGeneratingInsights);
    const isLast = idx === sessionMessages.length - 1;

    if (isLiveStream) {
      const out = raw || currentResponse || animatedResponseContent || '';
      return out.trim() ? out : '';
    }
    if (isLast && isSelected && isAnimatingResponse && animatedResponseContent) {
      return animatedResponseContent;
    }
    if (isLast && isSelected && !raw && currentResponse) {
      return currentResponse;
    }

    if (!raw.trim()) return '';

    const cached = assistantDisplayCacheRef.current.get(msg.id);
    if (cached && cached.raw === raw) return cached.out;

    let out = raw;
    const learningPayload = msg.learning_payload || parseLearningPayloadFromRaw(raw);
    if (learningPayload) {
      out = formatLearningPayloadToText(learningPayload) || raw;
    } else if (
      looksLikeRawJsonString(raw) ||
      isStructuredJsonResponse(raw) ||
      (msg.used_secret_prompt && /^\s*[{[]/.test(raw.trim()))
    ) {
      // Structured secret/analysis JSON → full HTML from renderSecretPromptResponse
      const formatted = formatResponseForDisplay(raw, msg);
      if (formatted && formatted.trim()) out = formatted;
      else {
        const plain = convertJsonToPlainText(raw);
        if (plain && plain.trim()) out = plain;
      }
    } else if (msg.used_secret_prompt) {
      // Plain markdown template output — parseMarkdown must own formatting (no ** → <strong> hybrid)
      out = raw;
    }

    assistantDisplayCacheRef.current.set(msg.id, { raw, out });
    return out;
  };

  // Auto-scroll chat thread to bottom when new messages arrive
  useEffect(() => {
    const el = learningModeActive ? learningThreadRef.current : chatThreadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [sessionMessages, learningModeActive, pendingQuestion, animatedResponseContent, isAnimatingResponse]);

  const renderChatComposer = () => (
    <div className="flex-shrink-0 px-4 py-3 bg-white overflow-visible relative z-20">
      <UpgradePlanBanner className="mb-2 w-full" />

      {/* ── Prompt chips ────────────────────────────────────────────── */}
      {/* Always rendered: Citation Search + Drafting Mode are built-in modes
          and must not disappear when the secrets list fails to load. */}
      {!isSecretPromptSelected && (
        <PromptChipsBar
          secrets={promptChips}
          isLoading={isLoadingSecrets}
          selectedSecretId={
            showDraftingModal
              ? 'drafting-mode-chip'
              : citationMode
                ? 'citation-search-chip'
                : selectedSecretId
          }
          activeLabel={null}
          onSelect={(s) => {
            if (isDraftingPromptChip(s)) {
              openDraftingMode();
            } else if (s.isCitation) {
              setChatMode('citation');
              void handleSend({ preventDefault: () => {} });
            } else {
              setChatMode('chat');
              handleDropdownSelect(s.name, s.id, s.llm_name);
            }
          }}
          disabled={isLoading || isGeneratingInsights}
          className="mb-2 w-full"
          onAddClick={() => setShowPromptBuilder(true)}
          customGroups={customPromptGroups}
          onSelectCustomPrompt={handleCustomPromptSelect}
          onDeleteCustomPrompt={handleDeleteCustomPrompt}
          onDeleteGroup={handleDeleteCustomGroup}
        />
      )}

      {/* ── Document attachment pill ─────────────────────────────── */}
      {documentData && !showDocumentPanel && (
        <div className="mb-2 flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-green-100 bg-green-50">
          <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            <FileCheck className="h-3.5 w-3.5 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-800 truncate">{documentData.originalName}</p>
            <p className="text-[10px] text-gray-500">{formatFileSize(documentData.size)} · Ready</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Indexed</span>
        </div>
      )}

      {/* ── Upload progress ──────────────────────────────────────── */}
      {isDocumentTransferBusy && (
        <div className="mb-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100 w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
              <span className="text-xs font-semibold text-blue-800">Uploading…</span>
            </div>
            <span className="text-xs font-bold text-blue-600">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* ── Active prompt badge ──────────────────────────────────── */}
      {isSecretPromptSelected && activeDropdown && (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f0fdfa] border border-[#b2f5ea] text-xs font-semibold text-[#0f766e]">
            <MessageSquare className="h-3 w-3" />
            {activeDropdown}
          </span>
          <button
            type="button"
            onClick={() => { setIsSecretPromptSelected(false); setActiveDropdown('Custom Query'); setSelectedSecretId(null); }}
            className="text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-100 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Main input card (Claude-style) ───────────────────────── */}
      <form onSubmit={handleSend} className="w-full">
        <div
          className="flex flex-col bg-white rounded-2xl shadow-md overflow-visible transition-all focus-within:shadow-lg"
        >
          {/* Textarea */}
          <textarea
            ref={chatInputRef}
            rows={1}
            value={chatInput}
            onChange={handleChatInputChange}
            onKeyDown={handleChatInputKeyDown}
            placeholder={getInputPlaceholder()}
            className="w-full px-4 pt-3.5 pb-2 bg-transparent border-none outline-none text-gray-800 text-sm min-w-0 placeholder-gray-400 analysis-page-user-input resize-none leading-relaxed"
            style={{ maxHeight: CHAT_INPUT_MAX_HEIGHT, minHeight: CHAT_INPUT_MIN_HEIGHT }}
            disabled={isLoading || isGeneratingInsights}
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1 gap-2">
            {/* Left: upload + mode + mic */}
            <div className="flex items-center gap-1">
              <UploadOptionsMenu
                fileInputRef={fileInputRef}
                isUploading={isUploading || isChatUploading}
                onLocalFileClick={() => fileInputRef.current?.click()}
                onGoogleDriveFilesSelected={handleGoogleDriveUpload}
                isSplitView={showDocumentPanel}
                menuPlacement="below"
                disabled={isUploading || isChatUploading}
              />
              <input ref={fileInputRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
                onChange={handleFileUpload} disabled={isUploading || isChatUploading} multiple />

              {/* Mode selector — ALL modes in one dropdown; the selection alone
                  decides the pipeline (chat / learning / citation / drafting /
                  expert preset). No keyword-based mode guessing. */}
              <div className="relative flex-shrink-0" ref={styleDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowStyleDropdown((s) => !s)}
                  disabled={isLoading || isGeneratingInsights}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-xl hover:border-[#21C1B6] hover:text-[#21C1B6] transition-colors disabled:opacity-40"
                  title="Chat mode"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="max-w-[110px] truncate text-[#0f766e]">{currentModeLabel}</span>
                </button>
                {showStyleDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-60 bg-white border border-gray-100 rounded-2xl shadow-2xl z-30 overflow-hidden py-1 max-h-80 overflow-y-auto">
                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Modes
                    </div>
                    <button type="button" onClick={() => selectChatModeOption('chat')}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50">
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6]" /> Chat
                      </span>
                      {currentModeLabel === 'Chat' && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    <button type="button" onClick={() => selectChatModeOption('learning')} disabled={!fileId}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" /> Learning
                      </span>
                      {learningModeActive && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    <button type="button" onClick={() => selectChatModeOption('citation')}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50">
                      <span className="flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 text-[#21C1B6]" /> Citation Search
                      </span>
                      {chatMode === 'citation' && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectChatModeOption('drafting')}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-[#21C1B6]" /> Drafting Mode
                      </span>
                      {showDraftingModal && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    {expertModePrompts.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-t border-gray-50 mt-1">
                          Expert Prompts
                        </div>
                        {expertModePrompts.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setShowStyleDropdown(false);
                              setChatMode('chat');
                              setLearningModeActive(false);
                              handleDropdownSelect(s.name, s.id, s.llm_name);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[#21C1B6]" />
                              <span className="truncate">{s.name}</span>
                            </span>
                            {selectedSecretId === s.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#21C1B6]" />}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="w-px h-4 bg-gray-200 mx-1 flex-shrink-0" />

              {/* Mic */}
              <button type="button" onClick={toggleListening}
                className={`flex-shrink-0 p-2 rounded-xl transition-all duration-200 ${
                  isListening ? 'text-white shadow-md scale-110' : 'text-[#21C1B6] hover:bg-teal-50 disabled:opacity-40'
                }`}
                style={isListening ? { background: '#ef4444' } : {}}
                disabled={isLoading || isGeneratingInsights || isSecretPromptSelected}
                title={isListening ? 'Stop listening' : 'Voice input'}>
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>

            {/* Right: send / stop — round button */}
            <button
              type={sendButtonType}
              disabled={isSendButtonDisabled}
              onClick={handleSendButtonClick}
              className="flex-shrink-0 w-9 h-9 rounded-full text-white flex items-center justify-center shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: isSendButtonDisabled && !isAnimatingResponse ? '#d1d5db' : '#21C1B6' }}
              title={sendButtonTitle}
            >
              {renderSendButtonIcon('small')}
            </button>
          </div>
        </div>
      </form>

      {/* File-size limit error */}
      {fileSizeLimitError && (
        <div className="mt-2 w-full">
          <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-xl p-3 text-xs text-gray-700">{fileSizeLimitError.message}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
      <DraftingModal open={showDraftingModal} onClose={() => setShowDraftingModal(false)} />
      <CustomPromptBuilderModal
        isOpen={showPromptBuilder}
        onClose={() => setShowPromptBuilder(false)}
        groups={customPromptGroups}
        onSaved={() => loadCustomPromptGroups()}
      />
      <ChatQuotaErrorModal
        error={error}
        onDismiss={() => setError(null)}
        onTopupSuccess={() => {
          invalidateTokenQuotaCache();
          setError(null);
        }}
      />
      {success && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-sm">
          <div className="bg-white rounded-xl shadow-xl border border-[#cfe1db] overflow-hidden">
            <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-white flex-shrink-0" />
                <span className="text-white font-semibold text-sm">{success}</span>
              </div>
              <button onClick={() => setSuccess(null)} className="text-white/70 hover:text-white transition-colors ml-3">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {showInsufficientFundsAlert && (
        <div className="fixed top-4 right-4 z-50 max-w-md">
          <div className="bg-red-50 border-2 border-red-300 rounded-lg shadow-2xl p-4 animate-fadeIn">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg font-bold text-gray-900 mb-1">Insufficient Funds</h4>
                <p className="text-sm text-gray-700 mb-3">
                  You don't have enough credits to upload documents. Please upgrade your subscription plan to continue.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowInsufficientFundsAlert(false);
                      navigate('/subscription-plans');
                    }}
                    className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA89E] transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
                  >
                    <CreditCard className="w-4 h-4 mr-1.5" />
                    Upgrade Now
                  </button>
                  <button
                    onClick={() => setShowInsufficientFundsAlert(false)}
                    className="px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowInsufficientFundsAlert(false)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {!isChatActive ? (
        <div className="flex flex-col h-full w-full relative">

          {/* History button — top right of welcome screen */}
          {hasSessions && (
            <div className="absolute top-4 right-4 z-20">
              <button
                onClick={() => setShowWelcomeHistory(v => !v)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50 hover:text-teal-600 hover:border-teal-200 transition-all"
              >
                <Clock className="w-4 h-4" />
                Session History
                <span className="ml-1 text-xs font-bold bg-teal-50 text-teal-600 border border-teal-200 rounded-full px-2 py-0.5">
                  {chatSessions.length}
                </span>
              </button>
            </div>
          )}

          {/* Slide-in history panel */}
          {showWelcomeHistory && (
            <div className="absolute top-0 right-0 h-full w-80 z-30 flex flex-col bg-white border-l border-gray-100 shadow-xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-bold text-gray-800">Session History</span>
                </div>
                <button
                  onClick={() => setShowWelcomeHistory(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                {isLoadingSessions ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
                  </div>
                ) : chatSessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <MessageSquare className="w-8 h-8 text-gray-200 mb-2" />
                    <p className="text-sm text-gray-400">No sessions yet</p>
                  </div>
                ) : (
                  chatSessions.map((session) => (
                    <button
                      key={session.session_id}
                      onClick={() => { handleSessionClick(session); setShowWelcomeHistory(false); }}
                      className="w-full text-left px-4 py-3 hover:bg-teal-50 transition-colors group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-teal-100 transition-colors">
                          <MessageSquare className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate leading-snug">
                            {session.name || 'Untitled session'}
                          </p>
                          {session.filename && (
                            <p className="text-xs text-gray-400 truncate mt-0.5 flex items-center gap-1">
                              <FileText className="w-3 h-3 shrink-0" />
                              {session.filename}
                            </p>
                          )}
                          {session.created_at && (
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {new Date(session.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-teal-500 shrink-0 mt-1 transition-colors" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 overflow-y-auto">
            <div className="text-center max-w-2xl mb-8 sm:mb-12">
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
              <p className="text-gray-600 text-base sm:text-lg lg:text-xl leading-relaxed">
              your AI partner for fast, precise legal document analysis. Upload a file or ask a question to get instant, context-aware legal insights.
              </p>
            </div>
            <div className="w-full">
            {documentData && !hasResponse && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileCheck className="h-5 w-5 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{documentData.originalName}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(documentData.size)} • {formatDate(documentData.uploadedAt)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-4 rounded-2xl overflow-visible">
              {renderChatComposer()}
            </div>
            {learningModeActive && (
              <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-full border border-[#21C1B6] bg-[#E0F7F6] text-[#11766f] text-xs font-medium">
                <Sparkles className="h-3 w-3" />
                <span>Learning mode active</span>
                {turnCount > 0 && turnCount <= turnThreshold ? <span>{`Turn ${turnCount} of ${turnThreshold}`}</span> : null}
                <button type="button" onClick={() => setLearningModeActive(false)} className="text-[#11766f] hover:text-[#0e5f59]" title="Disable learning mode">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          </div>
         
        </div>
      ) : (
        <div className="flex h-full min-h-0 w-full overflow-hidden bg-white">
          {hasSessions && chatHistorySidebarOpen && (
            <div
              className="flex-shrink-0 flex flex-col border-r border-gray-100"
              style={{ width: '272px', height: '100%', background: '#fafafa' }}
            >
              <div className="px-3 pt-3 pb-2 border-b border-gray-100 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: '#f0fdfb' }}>
                      <MessageSquare className="w-3.5 h-3.5" style={{ color: '#21C1B6' }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">Conversations</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChatHistorySidebarOpen(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={startNewChat}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 shadow-sm"
                  style={{ background: 'linear-gradient(135deg,#21C1B6,#1AA49B)' }}
                  title="Start New Chat"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Conversation
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 scrollbar-custom">
                {isLoadingSessions ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[#21C1B6]" />
                  </div>
                ) : (
                  <ChatSessionList
                    sessions={sidebarSessions}
                    selectedSessionId={sessionId}
                    onSelectSession={handleSelectChatSession}
                    onDeleteSession={() => {}}
                  />
                )}
              </div>
            </div>
          )}
          {hasSessions && !chatHistorySidebarOpen && (
            <div className="flex-shrink-0 flex flex-col items-center border-r border-gray-100 bg-white w-10 py-3 gap-2">
              <button
                type="button"
                onClick={() => setChatHistorySidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 hover:text-[#21C1B6] transition-colors"
                title="Show chat history"
                aria-label="Show chat history"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          )}

          <div ref={splitContainerRef} className="flex flex-1 min-w-0 h-full overflow-hidden">
            <div
              className="flex flex-col min-w-0 h-full overflow-hidden bg-white"
              style={{ width: showDocumentPanel ? `${splitLeftWidth}%` : '100%' }}
            >
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 flex-shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#21C1B6' }} />
                <span className="text-xs font-semibold text-gray-600 truncate flex items-center gap-1">
                  {documentData?.originalName ? (
                    <>
                      <span>{documentData.originalName}</span>
                      {isInitializingCache && (
                        <span className="text-[10px] font-normal text-slate-400 animate-pulse ml-1">
                          (calculating tokens...)
                        </span>
                      )}
                    </>
                  ) : (
                    sessionMessages.length > 0
                      ? generateSessionName(sessionMessages[0]?.prompt_label || sessionMessages[0]?.display_text_left_panel || sessionMessages[0]?.question || '')
                      : 'New Conversation'
                  )}
                </span>
              </div>

              {/* Token count chip — Google AI Studio style */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Cached session: full cache cost popover */}
                {useCache && fileId ? (
                  <TokenCostPopover
                    sessionId={cacheSessionData?.sessionId}
                    fileId={fileId}
                    initialData={cacheSessionData}
                    preSessionDocTokens={fileTokenCount.totalTokens || 0}
                    isLoadingTokens={fileTokenCount.isLoading}
                    modelName={cacheSessionData?.modelName || fileTokenCount.modelName || 'gemini-2.5-pro'}
                    onCacheExpired={handleCacheExpired}
                  />
                ) : sessionTokenUsage.totalTokens > 0 ? (
                  /* After first Q&A: show cumulative session usage + live prompt typing */
                  <SessionTokenBadge
                    usage={sessionTokenUsage}
                    modelName={sessionTokenUsage.modelName || 'gemini-2.5-flash'}
                    promptTokens={Math.ceil((chatInput || '').length / 4)}
                  />
                ) : (
                  /* Document uploaded but no chat yet: show live document token count + typed prompt */
                  <FileTokenBadge
                    tokenData={fileTokenCount.totalTokens ? fileTokenCount : null}
                    isLoading={fileTokenCount.isLoading}
                    promptTokens={Math.ceil((chatInput || '').length / 4)}
                  />
                )}

                <button
                  onClick={startNewChat}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white"
                  style={{ background: '#21C1B6' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Chat
                </button>
              </div>
            </div>

            <div
              ref={(el) => {
                if (learningModeActive) learningThreadRef.current = el;
                else chatThreadRef.current = el;
              }}
              className={`flex-1 overflow-y-auto py-6 scrollbar-custom bg-white ${learningModeActive ? 'learning-chat-thread px-4 md:px-6' : showDocumentPanel ? 'px-3' : 'px-4 md:px-6'}`}
            >
              <div
                style={{
                  maxWidth: '880px',
                  margin: '0 auto',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: learningModeActive ? undefined : '48px',
                }}
              >
                {learningModeActive ? (
                  <>
                    {sessionMessages.length === 0 && (
                      <div className="learning-thread-empty">
                        <Sparkles className="h-6 w-6 text-[#21C1B6] mb-2" />
                        <p className="text-sm text-gray-500">Ask a question about the document to start learning.</p>
                      </div>
                    )}
                    {sessionMessages.map((msg) => (
                      <div key={msg.id} className="learning-thread-item">
                        {msg.question && (
                          <div className="learning-user-bubble">
                            <p className="learning-user-text">{msg.display_text_left_panel || msg.question}</p>
                          </div>
                        )}
                        <div className="learning-ai-bubble">
                          {msg.learning_payload ? (
                            <LearningBubble
                              payload={msg.learning_payload}
                              isStreaming={msg.isStreaming && (isLoading || isGeneratingInsights)}
                              onOptionSelect={handleLearningOptionSelect}
                            />
                          ) : msg.isStreaming && msg.id === selectedMessageId ? (
                            <div className="learning-thinking-indicator">
                              <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                              <span>{streamingMessage || 'Thinking...'}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </>
                ) : sessionMessages.length === 0 && !pendingQuestion ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    {isDocumentTransferBusy ? (
                      <>
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)' }}>
                          <Loader2 className="h-7 w-7 text-blue-500 animate-spin" />
                        </div>
                        <p className="text-base font-semibold text-gray-700 mb-1">Uploading document…</p>
                        <p className="text-sm text-gray-400">Your document is being processed. You can start asking questions shortly.</p>
                      </>
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 shadow-sm" style={{ background: 'linear-gradient(135deg,#f0fdfb,#e0f7f5)' }}>
                          <MessageSquare className="h-7 w-7" style={{ color: '#21C1B6' }} />
                        </div>
                        <p className="text-base font-bold text-gray-800 mb-2">Ready to answer your questions</p>
                        <p className="text-sm text-gray-400 leading-relaxed max-w-xs">
                          {documentData
                            ? `"${documentData.originalName}" is indexed and ready. Ask anything about this document.`
                            : 'Upload a legal document or start a new conversation below.'}
                        </p>
                        {documentData && (
                          <div className="mt-6 grid grid-cols-2 gap-2 max-w-sm w-full">
                            {['Summarize this document', 'What are the key obligations?', 'Identify any legal risks', 'Extract important dates'].map((q) => (
                              <button key={q} type="button"
                                onClick={() => { if (setChatInput) setChatInput(q); chatInputRef.current?.focus(); }}
                                className="flex items-center gap-2 px-3 py-2.5 bg-white rounded-xl border border-gray-200 text-left text-xs text-gray-600 font-medium hover:border-[#21C1B6] hover:text-gray-900 hover:shadow-sm transition-all">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] flex-shrink-0" />
                                {q}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {sessionMessages
                      .filter((msg) =>
                        (msg.display_text_left_panel || msg.question || '').toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((msg, idx, arr) => {
                        const assistantContent = getAssistantDisplayForMessage(msg, idx);
                        const storedLabel = msg.prompt_label || msg.promptLabel;
                        const questionLabel =
        (msg.used_secret_prompt || msg.isSecretPrompt) && storedLabel
          ? `Analysis: ${storedLabel}`
          // A custom prompt stores its name without used_secret_prompt — never
          // render the prompt body itself in the thread.
          : storedLabel
            ? sanitizeVisibleChatText(storedLabel, 'Your question')
            : sanitizeVisibleChatText(msg.display_text_left_panel || msg.question, 'Your question');
                        const isCurrentStreaming = msg.isStreaming && msg.id === selectedMessageId;
                        // content-visibility:auto tells the browser to skip layout + paint for
                        // messages that are well off-screen. We leave the last 2 entries and
                        // the live-streaming message always visible so scroll anchoring is stable.
                        const offscreenStyle =
                          !isCurrentStreaming && idx < arr.length - 2
                            ? { contentVisibility: 'auto', containIntrinsicSize: '0 220px' }
                            : undefined;
                        return (
                          <div key={msg.id || idx} className="flex flex-col gap-3" style={offscreenStyle}>
                            <div className="chat-thread-card chat-thread-card--user">
                              <div className="chat-thread-card__label">You</div>
                              <div className="chat-thread-card__body">{questionLabel}</div>
                            </div>
                            {(assistantContent || (msg.isStreaming && msg.id === selectedMessageId)) && (
                              (!assistantContent && msg.isStreaming && msg.id === selectedMessageId && !streamStarted) ? (
                                <div className="px-2 py-3">
                                  <TypingDots />
                                </div>
                              ) : (
                              <div
                                className={`chat-thread-card ${assistantContent ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                                onClick={() => assistantContent && handleMessageClick(msg)}
                                onKeyDown={(e) => {
                                  if (assistantContent && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    handleMessageClick(msg);
                                  }
                                }}
                                role={assistantContent ? 'button' : undefined}
                                tabIndex={assistantContent ? 0 : undefined}
                              >
                                <div className="chat-thread-card__label">Assistant</div>
                                {!assistantContent && msg.isStreaming && msg.id === selectedMessageId && streamingStatus !== 'generating' ? (
                                  <div className="p-4">
                                    {processingTimeline.length > 0 && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => setShowProcessingTimeline((prev) => !prev)}
                                          className="flex items-center gap-2 text-xs font-medium text-[#1f6b5f] mb-3"
                                        >
                                          <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                                          <span>{showProcessingTimeline ? 'Hide thinking' : 'Show thinking'}</span>
                                          <ChevronDown className={`h-3 w-3 transition-transform ${showProcessingTimeline ? 'rotate-180' : ''}`} />
                                        </button>
                                        {showProcessingTimeline && (
                                          <div className="border-l border-[#c9ddd5] pl-3 space-y-3 mb-3">
                                            {processingTimeline.map((step) => (
                                              <div key={step.id}>
                                                <p className="text-[13px] font-semibold italic text-[#2b3528]">{step.title}</p>
                                                <p className="text-xs text-[#4f5b56]">{step.description}</p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <TypingDots />
                                  </div>
                                ) : (
                                  <>
                                    <div
                                      className="chat-thread-card__body analysis-page-ai-response"
                                      ref={(el) => {
                                        if (el && msg.id != null) messageBodyRefs.current[msg.id] = el;
                                      }}
                                    >
                                      {msg.isStreaming && msg.id === selectedMessageId ? (
                                        <>
                                          <StreamingMarkdown key={`stream-${selectedMessageId}-${streamResetKey}`} bufferRef={streamBufferRef} scrollTargetRef={chatThreadRef} />
                                          {(!streamBufferRef.current || !streamBufferRef.current.trim()) && (
                                            <TypingDots />
                                          )}
                                        </>
                                      ) : (
                                        assistantContent ? (
                                          <AssistantMessageBody content={assistantContent} sources={msg.sources} />
                                        ) : msg.isStreaming ? (
                                          <TypingDots />
                                        ) : null
                                      )}
                                    </div>
                                    {assistantContent && (
                                      <div className="chat-thread-card__footer flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRetryMessage(msg);
                                          }}
                                          disabled={isLoading || isGeneratingInsights}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                          title="Regenerate this response"
                                        >
                                          <RotateCcw className="h-3 w-3" />
                                          Retry
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleMessageClick(msg);
                                            handleCopyResponse();
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                          title="Copy AI Response"
                                        >
                                          <Copy className="h-3 w-3" />
                                          Copy
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            downloadTargetRef.current = messageBodyRefs.current[msg.id] || null;
                                            setResponseDownloadModal('pdf');
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                          title="Download AI Response as PDF"
                                        >
                                          <Download className="h-3 w-3" />
                                          PDF
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            downloadTargetRef.current = messageBodyRefs.current[msg.id] || null;
                                            setResponseDownloadModal('word');
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                          title="Download AI Response as Word document"
                                        >
                                          <FileText className="h-3 w-3" />
                                          Word
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            downloadAsHtml(
                                              messageBodyRefs.current[msg.id],
                                              `AI_Response_${new Date().toISOString().slice(0, 10)}.html`
                                            );
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                          title="Download AI Response as HTML file"
                                        >
                                          <Code className="h-3 w-3" />
                                          HTML
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            printResponse(messageBodyRefs.current[msg.id]);
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                          title="Print AI Response"
                                        >
                                          <Printer className="h-3 w-3" />
                                          Print
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                              )
                            )}
                          </div>
                        );
                      })}
                    {pendingQuestion && !sessionMessages.some((m) => m.isStreaming && m.id === selectedMessageId) && (
                      <div className="flex flex-col gap-3">
                        <div className="chat-thread-card chat-thread-card--user">
                          <div className="chat-thread-card__label">You</div>
                          <div className="chat-thread-card__body">{pendingQuestion}</div>
                        </div>
                        {/* Gemini-style 3-dot loader only — no empty assistant box */}
                        <div className="px-2 py-3">
                          <TypingDots />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {renderChatComposer()}
            </div>

            {showDocumentPanel && (
              <>
                <button
                  type="button"
                  aria-label="Resize chat and document panels"
                  onMouseDown={() => setIsResizingSplit(true)}
                  className="w-1.5 flex-shrink-0 cursor-col-resize bg-gray-100 hover:bg-[#21C1B6]/25 transition-colors border-x border-gray-100"
                />
                <div
                  className="flex flex-col min-w-0 h-full overflow-hidden bg-white"
                  style={{ width: `${100 - splitLeftWidth}%` }}
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-shrink-0 bg-white">
                    <FileText className="w-4 h-4 text-[#21C1B6]" />
                    <span className="text-xs font-semibold text-gray-600 truncate">
                      {documentData?.originalName || 'Document response'}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden p-2">
                    <DocumentViewer
                      selectedMessageId={selectedMessageId}
                      currentResponse={currentResponse}
                      animatedResponseContent={animatedResponseContent}
                      messages={sessionMessages}
                      handleCopyResponse={handleCopyResponse}
                      markdownOutputRef={markdownOutputRef}
                      isAnimatingResponse={isAnimatingResponse}
                      showResponseImmediately={showResponseImmediately}
                      formatDate={formatDate}
                      markdownComponents={markdownComponents}
                      responseContainerRef={responseRef}
                      exportContentRef={exportContentRef}
                      suggestedQuestions={suggestedQuestions}
                      onSuggestedQuestionClick={handleSuggestedQuestionClick}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BrandingDownloadModal
        isOpen={responseDownloadModal === 'pdf'}
        onClose={() => setResponseDownloadModal(null)}
        contentRef={downloadTargetRef}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.pdf`}
        format="pdf"
        module="chatmodel-response"
      />
      <BrandingDownloadModal
        isOpen={responseDownloadModal === 'word'}
        onClose={() => setResponseDownloadModal(null)}
        contentRef={downloadTargetRef}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.docx`}
        format="word"
        module="chatmodel-response"
      />
    </div>
  );
};

export default ChatModelPage;
