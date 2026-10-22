import { normalizeBrandingProfile } from './brandingProfileDefaults';

/** Tailwind / chat classes that override branding body typography in exports. */
const EXPORT_TYPOGRAPHY_CLASS =
  /^(?:prose(?:-[\w-]+)?|formatted-assistant-markdown|word-document-style|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|font-(?:sans|serif|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|leading-(?:none|tight|snug|normal|relaxed|loose|\d+)|tracking-(?:tighter|tight|normal|wide|wider|widest)|max-w-(?:none|prose|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|screen))$/;

const EXPORT_COLOR_CLASS = /^text-(?:gray|slate|zinc|neutral|stone)-\d+$/;

const INLINE_TYPO_STRIP = /^\s*(?:font-family|font-size|line-height|letter-spacing|-webkit-font-smoothing)\s*:/i;

/**
 * Remove chat/markdown UI typography so branded CSS / docx body font wins.
 */
export function stripExportTypographyFromNode(root) {
  if (!root) return;
  const nodes = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
  nodes.forEach((el) => {
    if (el.classList?.length) {
      [...el.classList].forEach((cls) => {
        if (EXPORT_TYPOGRAPHY_CLASS.test(cls) || EXPORT_COLOR_CLASS.test(cls)) {
          el.classList.remove(cls);
        }
      });
    }
    if (!el.getAttribute?.('style')) return;
    const safe = el
      .getAttribute('style')
      .split(';')
      .filter((part) => {
        const p = part.trim();
        if (!p) return false;
        const lower = p.toLowerCase();
        if (INLINE_TYPO_STRIP.test(lower)) return false;
        if (lower.startsWith('color:') || lower.startsWith('-webkit-text-fill-color:')) return false;
        return true;
      })
      .join(';');
    if (safe) el.setAttribute('style', safe);
    else el.removeAttribute('style');
  });
}

/** Heading sizes (pt) scaled from profile body fontSize — matches preview ratios. */
export function brandingHeadingPt(profile, level) {
  const p = normalizeBrandingProfile(profile);
  const base = Number(p.fontSize) || 15;
  const ratios = { 1: 1.2, 2: 1.0, 3: 0.87, 4: 0.73, 5: 0.67, 6: 0.6 };
  const r = ratios[level] ?? 1;
  return Math.round(base * r * 10) / 10;
}

/** docx spacing.line (240ths) for profile lineHeight. */
export function brandingDocxLineSpacing(profile) {
  const p = normalizeBrandingProfile(profile);
  return Math.round((Number(p.lineHeight) || 1.5) * 240);
}

export function getBrandingBodyTypography(profile) {
  const p = normalizeBrandingProfile(profile);
  return {
    fontFamily: p.fontFamily || 'Times New Roman',
    fontSizePt: Number(p.fontSize) || 15,
    lineHeight: Number(p.lineHeight) || 1.5,
    bodyColor: p.bodyTextColor || '#000000',
    primaryColor: p.primaryColor || '#20b2aa',
  };
}
