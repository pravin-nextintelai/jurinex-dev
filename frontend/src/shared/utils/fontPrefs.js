/**
 * Site-wide font preference (Settings → Appearance).
 *
 * The selected font is applied to the WHOLE app by injecting a stylesheet that
 * overrides every font-family — including the many hardcoded inline
 * `fontFamily: 'Inter…'` styles — via `!important`. Code/monospace elements are
 * re-exempted so code blocks stay readable. "Default" removes the override,
 * returning the site to its designed fonts (Inter / DM Sans).
 *
 * Persisted per browser in localStorage; `initFontPref()` runs at app boot so
 * the choice applies before first paint. Google-hosted fonts are loaded on
 * demand (once) via a <link> tag — system fonts need no network at all.
 */

const STORAGE_KEY = 'jurinex_font_pref';
const STYLE_ID = 'jurinex-font-override';
const LINK_PREFIX = 'jurinex-font-face-';

export const FONT_OPTIONS = [
  { id: 'default', label: 'Inter', note: 'Default', stack: "'Inter', system-ui, -apple-system, sans-serif", google: null },
  { id: 'system', label: 'System UI', note: 'Your device font', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", google: null },
  { id: 'roboto', label: 'Roboto', note: 'Clean & neutral', stack: "'Roboto', system-ui, sans-serif", google: 'Roboto:wght@400;500;700' },
  { id: 'open-sans', label: 'Open Sans', note: 'Friendly & readable', stack: "'Open Sans', system-ui, sans-serif", google: 'Open+Sans:wght@400;600;700' },
  { id: 'lato', label: 'Lato', note: 'Warm & modern', stack: "'Lato', system-ui, sans-serif", google: 'Lato:wght@400;700' },
  { id: 'poppins', label: 'Poppins', note: 'Geometric & bold', stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700' },
  { id: 'merriweather', label: 'Merriweather', note: 'Serif, easy on the eyes', stack: "'Merriweather', Georgia, serif", google: 'Merriweather:wght@400;700' },
  { id: 'georgia', label: 'Georgia', note: 'Classic serif', stack: "Georgia, 'Times New Roman', serif", google: null },
  { id: 'times', label: 'Times New Roman', note: 'Traditional legal', stack: "'Times New Roman', Times, serif", google: null },
];

export const getFontPref = () => {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return FONT_OPTIONS.some((f) => f.id === id) ? id : 'default';
  } catch {
    return 'default';
  }
};

/** Load a Google-hosted font once (no-op for system fonts / already loaded). */
export const ensureFontFaceLoaded = (font) => {
  if (!font?.google) return;
  const linkId = `${LINK_PREFIX}${font.id}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
};

const removeOverride = () => {
  document.getElementById(STYLE_ID)?.remove();
};

/** Apply a font id to the whole site and persist it. */
export const applyFontPref = (fontId) => {
  const font = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];
  try {
    localStorage.setItem(STORAGE_KEY, font.id);
  } catch { /* private mode — applies for this session only */ }

  if (font.id === 'default') {
    removeOverride();
    return font;
  }

  ensureFontFaceLoaded(font);

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  // `body *` beats inline styles thanks to !important; the later equal-specificity
  // monospace rule wins back code blocks by source order. `.jnx-font-sample`
  // (Settings font-preview cards) escapes the override through a CSS variable
  // each card sets inline — so previews always render their OWN font.
  style.textContent = `
body, body * {
  font-family: ${font.stack} !important;
}
code, pre, kbd, samp, code *, pre * {
  font-family: 'IBM Plex Mono', 'Fira Code', 'Courier New', monospace !important;
}
.jnx-font-sample {
  font-family: var(--jnx-sample-font, inherit) !important;
}
`;
  return font;
};

/* ------------------------------------------------------------------ */
/* Font size (Settings → Appearance → Font size)                       */
/* TEXT-ONLY scaling: sets the --jnx-text-scale CSS variable plus a    */
/* data-jnx-textscale attribute on <html>. Reading surfaces (chat      */
/* markdown, analysis pages) consume the variable through calc() on    */
/* their font sizes, and index.css scales generic text elements —      */
/* layout, spacing, buttons and menus are never zoomed.                */
/* ------------------------------------------------------------------ */

const SIZE_STORAGE_KEY = 'jurinex_font_size_pref';

export const FONT_SIZE_OPTIONS = [
  { id: 'small', label: 'Small', zoom: 0.9 },
  { id: 'default', label: 'Default', zoom: 1 },
  { id: 'large', label: 'Large', zoom: 1.1 },
  { id: 'xlarge', label: 'Extra large', zoom: 1.2 },
];

export const getFontSizePref = () => {
  try {
    const id = localStorage.getItem(SIZE_STORAGE_KEY);
    return FONT_SIZE_OPTIONS.some((s) => s.id === id) ? id : 'default';
  } catch {
    return 'default';
  }
};

export const applyFontSizePref = (sizeId) => {
  const size = FONT_SIZE_OPTIONS.find((s) => s.id === sizeId) || FONT_SIZE_OPTIONS[1];
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, size.id);
  } catch { /* private mode — applies for this session only */ }

  const root = document.documentElement;
  if (size.zoom === 1) {
    root.style.removeProperty('--jnx-text-scale');
    root.removeAttribute('data-jnx-textscale');
  } else {
    root.style.setProperty('--jnx-text-scale', String(size.zoom));
    root.setAttribute('data-jnx-textscale', size.id);
  }
  return size;
};

/** Call once at app boot, before first paint. */
export const initFontPref = () => {
  applyFontPref(getFontPref());
  applyFontSizePref(getFontSizePref());
};
