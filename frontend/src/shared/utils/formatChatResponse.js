import { convertJsonToPlainText } from './jsonToPlainText';
import { isStructuredJsonResponse, renderSecretPromptResponse } from './renderSecretPromptResponse';

const BOX_CHARS = /[┌┐└┘├┤┬┴┼│─]/;

// Decorative model-emitted banners ("⚖️ LEXIS ...", "खटला: ... प्रश्नाचा प्रकार: ...")
// are pure branding noise — drop the whole box instead of rendering it. The
// system prompt forbids them, but old sessions and occasional slips still
// contain boxes, so the formatter removes them defensively.
function convertAsciiLegalBoxes(text) {
  if (!text || typeof text !== 'string' || !BOX_CHARS.test(text)) {
    return text;
  }

  let result = text;

  result = result.replace(/┌[\s─]+┐[\s\S]*?└[\s─]+┘/g, '');
  result = result.replace(/┌[\s─]+┐\s*((?:│[^┌└]+│\s*)+)\s*└[\s─]+┘/g, '');

  return result;
}

function cleanupBoxDebris(text) {
  return String(text)
    .split('\n')
    .filter((line) => {
      const stripped = line.replace(/[┌┐└┘├┤┬┴┼│─\s]/g, '');
      return stripped.length > 0 || !BOX_CHARS.test(line);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Normalize full-width / unicode asterisks to ASCII for markdown parsing. */
function normalizeAsterisks(text) {
  return String(text).replace(/[\uFF0A\u2217\u204E]/g, '*');
}

/**
 * Convert **bold** (and *italic*) markdown markers to HTML tags so they never show as
 * literal asterisks during streaming, before the full markdown render pass runs.
 * Safe to run on mixed markdown/HTML.
 */
export function convertMarkdownBoldMarkers(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length > 120000) return normalizeAsterisks(text);

  let converted = normalizeAsterisks(text);

  // Clean up empty markers
  converted = converted.replace(/\*\*\s*\*\*/g, '');
  converted = converted.replace(/\*\*📎\s*\*\*/g, '📎 ');

  // Tighten spaced bold/italic markers first so the conversion regexes match.
  converted = converted
    .replace(/(?<![A-Za-z0-9*])\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, '**$1**')
    .replace(/(?<![A-Za-z0-9*])\*\*[ \t]+([^*\n]+?)\*\*/g, '**$1**')
    .replace(/(?<![A-Za-z0-9*])\*\*([^*\n]+?)[ \t]+\*\*/g, '**$1**')
    .replace(/(?<![A-Za-z0-9*])\*[ \t]+([^*\n]+?)[ \t]+\*(?!\*)/g, '*$1*');

  // Bold: **text** -> <strong>text</strong>
  converted = converted.replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*(?!\*)/g, '<strong>$1</strong>');

  // Italic: *text* -> <em>text</em>
  converted = converted.replace(/(?<!\*)\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '<em>$1</em>');

  return converted;
}

/** True when text still looks like raw JSON (should not be shown to users). */
export function looksLikeRawJsonString(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^```(?:json)?\s*/i.test(t)) return true;
  if ((t.startsWith('{') || t.startsWith('[')) && /"[^"]+"\s*:/.test(t)) return true;
  return false;
}

/** True when formatted output has no readable content (only rules, pipes, or HTML shell). */
export function isEmptyFormattedChatContent(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  const visible = t
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return visible.length === 0;
}

export function formatChatResponseForDisplay(raw) {
  if (raw == null || raw === '') return '';

  const rawString = typeof raw === 'string' ? raw.trim() : '';

  let text;
  if (typeof raw === 'object') {
    text = convertJsonToPlainText(raw);
  } else if (isStructuredJsonResponse(raw)) {
    text = renderSecretPromptResponse(raw);
  } else {
    text = convertJsonToPlainText(raw);
  }

  if ((!text || isEmptyFormattedChatContent(text) || looksLikeRawJsonString(text)) && rawString) {
    if (isStructuredJsonResponse(rawString) || isStructuredJsonResponse(raw)) {
      const structured = renderSecretPromptResponse(rawString || raw);
      if (structured && !isEmptyFormattedChatContent(structured) && !looksLikeRawJsonString(structured)) {
        text = structured;
      }
    }
    if (!text || isEmptyFormattedChatContent(text) || looksLikeRawJsonString(text)) {
      const plain = convertJsonToPlainText(rawString || raw);
      if (plain && !looksLikeRawJsonString(plain)) text = plain;
    }
  }

  if (!text || isEmptyFormattedChatContent(text)) {
    // Final safety net: if the raw string is a JSON code block, try stripping fences and converting once more
    if (rawString) {
      const stripped = rawString
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      if (stripped && stripped !== rawString) {
        const recovered = convertJsonToPlainText(stripped);
        if (recovered && !isEmptyFormattedChatContent(recovered) && !looksLikeRawJsonString(recovered)) {
          text = recovered;
        } else if (recovered && recovered.length > 30) {
          text = recovered;
        }
      }
    }
    if (!text || isEmptyFormattedChatContent(text)) return '';
  }

  if (!/<[a-z][\s>]/i.test(text)) {
    text = convertAsciiLegalBoxes(text);
    text = cleanupBoxDebris(text);
  }

  if (looksLikeRawJsonString(text)) {
    // Strip code fences and try one more conversion pass before giving up
    const stripped = String(text)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const converted = convertJsonToPlainText(stripped);
    if (converted && !looksLikeRawJsonString(converted) && !isEmptyFormattedChatContent(converted)) {
      return converted;
    }
    // Show the raw stripped content rather than a blank screen
    if (stripped && stripped.length > 20) return stripped;
    return '';
  }

  return text;
}

/** True only for full styled HTML documents — not mixed markdown + banner. */
export function chatResponseLooksLikeHtml(text) {
  if (!text) return false;
  return (
    /<table[\s>]/i.test(text) ||
    /<p\s+style\s*=/i.test(text) ||
    /<h[1-6]\s+style\s*=/i.test(text) ||
    /class="word-document-style"/i.test(text)
  );
}
