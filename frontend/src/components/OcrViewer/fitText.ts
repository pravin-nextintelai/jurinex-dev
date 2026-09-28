import type { OcrWord } from '../../types/ocr';
import { measureTextWidth } from './textMeasure';

/**
 * Everything the renderer needs to draw one OCR item at one scale, in CSS px relative to the page box.
 */
export interface FittedItem {
  word: OcrWord;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  /** Unitless CSS line-height. */
  lineHeight: number;
  /** Horizontal stretch applied to a single-line item so it spans its box exactly. */
  scaleX: number;
  /** Extra tracking in px for boxes much wider than the text (spaced headings, justified lines). */
  letterSpacing: number;
  /** Offset of the text span from the box's top-left, in px. */
  textLeft: number;
  textTop: number;
  multiline: boolean;
}

// Vertical metrics of Times New Roman, in em. Used to put the baseline where the OCR box says the
// glyphs are. With `line-height: 1` the baseline sits at (0.5 + (ascent - descent) / 2) em from the
// top of the line box.
const ASCENT = 0.891;
const DESCENT = 0.216;
const BASELINE_AT_UNIT_LINE_HEIGHT = 0.5 + (ASCENT - DESCENT) / 2;

// A provider box hugs the ink, so its height depends on which glyphs the text contains: capitals,
// digits and ascenders reach ~0.72 em above the baseline, an x-height-only word only ~0.5 em, and
// descenders hang ~0.22 em below. Non-ASCII scripts (Devanagari etc.) are treated as tall.
const TALL_GLYPHS = /[A-Z0-9bdfhklt!?"'|/\\()[\]{}]|[^ -~]/;
const DESCENDING_GLYPHS = /[gjpqy,;()[\]{}@_]/;

const MULTILINE_KINDS = new Set(['paragraph', 'block', 'tableCell']);
const MULTILINE_LINE_HEIGHT = 1.15;
/** Above this ratio, stretching glyphs looks wrong; distribute the slack as tracking instead. */
const MAX_STRETCH = 1.12;
const MIN_CONDENSE = 0.5;

export const glyphExtents = (text: string): { top: number; bottom: number } => ({
  top: TALL_GLYPHS.test(text) ? 0.72 : 0.5,
  bottom: DESCENDING_GLYPHS.test(text) ? 0.22 : 0.03,
});

/**
 * Font size and horizontal fit for a one-line box: size from the ink height, capped so the text
 * never overflows the width; then stretch slightly or add tracking so it fills the width exactly.
 */
export const fitSingleLine = (
  text: string,
  width: number,
  height: number,
): Pick<FittedItem, 'fontSize' | 'scaleX' | 'letterSpacing' | 'textTop'> => {
  const { top, bottom } = glyphExtents(text);
  const byHeight = height / (top + bottom);
  let fontSize = byHeight;
  const naturalAtHeight = measureTextWidth(text, byHeight);
  if (naturalAtHeight > width && naturalAtHeight > 0) {
    fontSize = byHeight * (width / naturalAtHeight);
  }
  fontSize = Math.max(1, fontSize);

  const natural = measureTextWidth(text, fontSize);
  const ratio = natural > 0 ? width / natural : 1;
  let scaleX = 1;
  let letterSpacing = 0;
  if (ratio <= MAX_STRETCH) {
    scaleX = Math.max(MIN_CONDENSE, ratio);
  } else {
    // Chrome applies letter-spacing after every character, including the last one.
    const chars = Math.max(1, Array.from(text).length);
    letterSpacing = Math.min((width - natural) / chars, fontSize * 0.6);
  }

  return {
    fontSize,
    scaleX,
    letterSpacing,
    textTop: (top - BASELINE_AT_UNIT_LINE_HEIGHT) * fontSize,
  };
};

/**
 * Font size for a box holding several lines (a paragraph, block or table cell): the largest size at
 * which every line fits the width and all lines fit the height, optionally capped at the page's body
 * size so an oversized cell does not get oversized text.
 */
export const fitMultiLine = (
  text: string,
  width: number,
  height: number,
  maxFontSize?: number,
): number => {
  const lines = text.split('\n');
  const byHeight = height / (Math.max(1, lines.length) * MULTILINE_LINE_HEIGHT);
  const widestPerPx = Math.max(0, ...lines.map((line) => measureTextWidth(line, 1)));
  const byWidth = widestPerPx > 0 ? width / widestPerPx : byHeight;
  let fontSize = Math.min(byHeight, byWidth);
  if (maxFontSize && maxFontSize > 0) fontSize = Math.min(fontSize, maxFontSize);
  return Math.max(1, fontSize);
};

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Typical body text size on the page, in px at `scale`, from the line layer (line boxes hug their
 * text, so their fitted size is a good estimate). Undefined when the page has no line boxes.
 */
export const estimateBodyFontSize = (lines: OcrWord[] | undefined, scale: number): number | undefined => {
  if (!lines?.length) return undefined;
  const sizes = lines
    .filter((line) => line.text && !line.text.includes('\n'))
    .map((line) => fitSingleLine(line.text, line.bbox.w * scale, line.bbox.h * scale).fontSize);
  return median(sizes);
};

export const fitItem = (word: OcrWord, scale: number, bodyFontSize?: number): FittedItem => {
  const left = word.bbox.x * scale;
  const top = word.bbox.y * scale;
  const width = Math.max(1, word.bbox.w * scale);
  const height = Math.max(1, word.bbox.h * scale);
  const kind = word.layoutKind || 'word';
  const multiline = MULTILINE_KINDS.has(kind) || word.text.includes('\n');

  if (!multiline) {
    const fit = fitSingleLine(word.text, width, height);
    return {
      word,
      left,
      top,
      width,
      height,
      lineHeight: 1,
      textLeft: 0,
      multiline: false,
      ...fit,
    };
  }

  if (kind === 'tableCell') {
    // A cell box is the cell, not the ink: pad it and never exceed the page's body size.
    const cap = bodyFontSize ? bodyFontSize * 1.1 : undefined;
    const padX = Math.min(width * 0.06, height * 0.2);
    const padY = Math.min(height * 0.12, padX);
    const fontSize = fitMultiLine(word.text, width - padX * 2, height - padY * 2, cap);
    return {
      word,
      left,
      top,
      width,
      height,
      fontSize,
      lineHeight: MULTILINE_LINE_HEIGHT,
      scaleX: 1,
      letterSpacing: 0,
      textLeft: padX,
      textTop: padY,
      multiline: true,
    };
  }

  // Paragraph or block: the box is the union of its lines, so the first cap-top sits at the box top.
  const fontSize = fitMultiLine(word.text, width, height);
  const halfLeading = ((MULTILINE_LINE_HEIGHT - (ASCENT + DESCENT)) / 2) * fontSize;
  return {
    word,
    left,
    top,
    width,
    height,
    fontSize,
    lineHeight: MULTILINE_LINE_HEIGHT,
    scaleX: 1,
    letterSpacing: 0,
    textLeft: 0,
    textTop: -(halfLeading + (ASCENT - 0.72) * fontSize),
    multiline: true,
  };
};

/** Fit every item of a page layer at `scale`. */
export const layoutItems = (items: OcrWord[], lines: OcrWord[] | undefined, scale: number): FittedItem[] => {
  const bodyFontSize = estimateBodyFontSize(lines, scale);
  return items
    .filter((item) => item.text)
    .map((item) => fitItem(item, scale, bodyFontSize));
};
