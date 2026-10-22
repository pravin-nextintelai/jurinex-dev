/**
 * Shared hex color helpers for branding preview + export (HTML, PDF, DOCX).
 */

export function normalizeHexColor(value, fallback = '#000000') {
  if (value == null || value === '') return fallback;
  let s = String(value).trim();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    s = `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : fallback;
}

/** docx TextRun color: RRGGBB without # */
export function hexToDocxColor(cssColor, fallback = '#000000') {
  const hex = normalizeHexColor(cssColor, fallback).slice(1).toUpperCase();
  return hex;
}

/** jsPDF setTextColor(r, g, b) */
export function hexToRgb255(cssColor, fallback = '#000000') {
  const hex = normalizeHexColor(cssColor, fallback).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}
