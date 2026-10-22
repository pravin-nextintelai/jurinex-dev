import { logBrandingExport, normalizeBrandingProfile } from './brandingProfileDefaults';
import {
  buildBrandedHtml,
  buildBrandedWordHtml,
  getPageDimensions,
  PAGE_PX,
} from './brandingTemplate';
import { DOCUMENT_SERVICE_URL, getUserIdForDrafting } from '@/config/apiConfig';
import { loadHtml2Pdf } from '@/shared/utils/responseExportUtils';
import { stripExportTypographyFromNode } from './brandingTypography';

/** Re-export page helpers for editor / callers. */
export { getPageDimensions, getPrintableWidthPx, getPdfPageSliceHeightPx, PAGE_PX } from './brandingTemplate';
export {
  buildBrandedHtml,
  buildBrandedWordHtml,
  buildPreviewSampleContentHtml,
  getBrandingCss,
  renderHeader,
  renderBrandingHeader,
  renderWatermark,
  renderPrintWatermark,
  renderFooter,
  renderDocumentHeader,
  sanitizeBrandingContentHtml,
} from './brandingTemplate';

export { getActiveBrandingProfile } from './brandingActiveProfile';

function resolveBrandingUserId(xUserId) {
  return xUserId != null && String(xUserId).trim() !== ''
    ? String(xUserId)
    : getUserIdForDrafting();
}

function isBackendPdfFailure(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    err?.name === 'TypeError'
    || msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('load failed')
    || msg.includes('pdf export unavailable')
    || msg.includes('playwright')
    || msg.includes('503')
    || msg.includes('501')
    || msg.includes('connection')
  );
}

/**
 * Client fallback when agentic-document-service / Playwright is unavailable.
 */
async function downloadBrandedPdfClientFallback(htmlString, filename, profile) {
  const p = normalizeBrandingProfile(profile);
  await loadHtml2Pdf();
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  }
  const pageSize = String(p.pageSize || 'a4').toLowerCase();
  const orientation = p.orientation === 'landscape' ? 'landscape' : 'portrait';
  const jsPdfFormat = pageSize === 'letter' ? 'letter' : pageSize === 'legal' ? 'legal' : 'a4';
  const mt = p.marginTop ?? 20;
  const ml = p.marginLeft ?? 20;
  const mb = p.marginBottom ?? 20;
  const mr = p.marginRight ?? 20;
  await window.html2pdf().set({
    margin: [mt, ml, mb, mr],
    filename: filename || 'export.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: Math.min(1.5, window.devicePixelRatio || 1),
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    },
    jsPDF: { unit: 'mm', format: jsPdfFormat, orientation, compress: true },
    pagebreak: { mode: ['css'], avoid: ['h1', 'h2', 'h3', 'h4', 'tr', 'li', 'blockquote', 'pre'] },
  }).from(htmlString, 'string').save();
}

/**
 * Server-side PDF via Chromium (Playwright). Expects full HTML from buildBrandedHtml(..., { forPdf: true }).
 */
export async function exportPdfViaBackend(html, profileId, filename, xUserId, profile = null) {
  const uid = resolveBrandingUserId(xUserId);
  if (!uid) {
    throw new Error('Sign in is required for server PDF export.');
  }
  const p = profile ? normalizeBrandingProfile(profile) : null;
  const headers = {
    'Content-Type': 'application/json',
    'X-User-Id': uid,
  };
  const res = await fetch(`${DOCUMENT_SERVICE_URL}/api/branding/export-pdf`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      html: String(html ?? ''),
      profileId: profileId || null,
      profile: p,
      filename: filename || 'export.pdf',
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.detail || j?.message || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(detail || `PDF export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Normalize chat response HTML before branded Word/PDF export.
 * Strips chat/markdown typography so body uses branding profile font, size, and color.
 */
export function prepareBrandedExportContentHtml(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = String(html ?? '');
  wrap.querySelectorAll('button,.ai-message-actions,.chat-thread-card__footer').forEach((el) => el.remove());
  wrap.querySelectorAll('.md-table-scroll').forEach((wrapper) => {
    const parent = wrapper.parentNode;
    if (!parent) return;
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
  });
  wrap.querySelectorAll('table').forEach((t) => {
    t.removeAttribute('style');
    t.style.width = '100%';
  });
  stripExportTypographyFromNode(wrap);
  return wrap.innerHTML;
}

function cloneForBrandedPdf(element) {
  const cloned = element.cloneNode(true);
  const cleaned = prepareBrandedExportContentHtml(cloned.innerHTML);
  cloned.innerHTML = cleaned;
  return cloned;
}

function buildPdfHtml(inner, profile) {
  const p = normalizeBrandingProfile(profile);
  const dims = getPageDimensions(p);
  return buildBrandedHtml(inner, p, {
    forPdf: true,
    pageWidthPx: dims.w,
    pageHeightPx: dims.h,
  });
}

/**
 * Branded PDF: buildBrandedHtml ? POST /api/branding/export-pdf ? Chromium print.
 */
export async function downloadBrandedPdfUnified({
  element,
  contentHtml,
  filename,
  profile,
  profileId,
  xUserId,
  module: mod = 'unknown',
} = {}) {
  if (element == null && contentHtml == null) {
    throw new Error('No content to export.');
  }

  const p = normalizeBrandingProfile(profile);
  const inner = contentHtml != null
    ? prepareBrandedExportContentHtml(contentHtml)
    : cloneForBrandedPdf(element).innerHTML;

  const htmlString = buildPdfHtml(inner, p);
  const uid = resolveBrandingUserId(xUserId);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let engine = 'html2pdf';

  const finishLog = (success) => {
    logBrandingExport({
      module: mod,
      exportType: 'pdf',
      profile: p,
      engine,
      success,
      durationMs: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined,
    });
  };

  if (uid) {
    try {
      await exportPdfViaBackend(htmlString, profileId, filename, uid, p);
      engine = 'playwright';
      finishLog(true);
      return;
    } catch (err) {
      if (!isBackendPdfFailure(err)) {
        finishLog(false);
        throw err;
      }
      console.warn('[BrandingExport] Server PDF unavailable, using client fallback:', err);
    }
  }

  try {
    await downloadBrandedPdfClientFallback(htmlString, filename, p);
    finishLog(true);
  } catch (err) {
    finishLog(false);
    if (!uid) {
      throw new Error(
        'PDF export failed. Sign in and ensure the document service is running on port 8092 with Playwright installed.',
      );
    }
    throw err;
  }
}

/** Legacy signature: (element, filename, profile) */
export async function downloadBrandedPdf(element, filename, profile) {
  await downloadBrandedPdfUnified({ element, filename, profile, module: 'legacy-element' });
}

export function downloadBrandedHtmlFile(contentHtml, filename, profile, logMeta = {}) {
  const p = normalizeBrandingProfile(profile);
  const dims = getPageDimensions(p);
  const html = buildBrandedHtml(contentHtml, p, {
    forPdf: false,
    pageWidthPx: dims.w,
    pageHeightPx: dims.h,
  });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logBrandingExport({
    ...logMeta,
    exportType: 'html',
    profile: p,
    engine: 'blob',
    success: true,
  });
}

function saveWordBlob(html, filename) {
  let wordDoc = html;
  if (!/xmlns:o\s*=/i.test(wordDoc)) {
    wordDoc = wordDoc.replace(
      /<html(\s[^>]*)?>/i,
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"$1>',
    );
  }
  const blob = new Blob([`\uFEFF${wordDoc}`], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadBrandedWord(element, filename, profile, logMeta = {}) {
  if (!element) throw new Error('No content to export.');
  const p = normalizeBrandingProfile(profile);
  const cloned = element.cloneNode(true);
  cloned.querySelectorAll('button,.ai-message-actions,.chat-thread-card__footer').forEach((el) => el.remove());
  const dims = getPageDimensions(p);
  const html = buildBrandedWordHtml(cloned.innerHTML, p, {
    pageWidthPx: dims.w,
    pageHeightPx: dims.h,
  });
  saveWordBlob(html, filename);
  logBrandingExport({ ...logMeta, exportType: 'word', profile: p, engine: 'html-msword', success: true });
}

export async function downloadBrandingProfilePreviewPdf(profile, filename, { xUserId, profileId } = {}) {
  await downloadBrandedPdfUnified({
    contentHtml: '',
    filename,
    profile,
    profileId: profileId ?? profile?.id,
    xUserId,
    module: 'branding-editor-preview',
  });
}

export async function downloadBrandingProfilePreviewWord(profile, filename) {
  const { downloadBrandingProfilePreviewDocx } = await import('./brandedDocxExport');
  await downloadBrandingProfilePreviewDocx(profile, filename);
}

/**
 * Single entry for modules: PDF (Playwright backend), HTML, or Word.
 */
export async function downloadWithBranding({
  element,
  contentHtml,
  filename,
  type = 'pdf',
  module: mod = 'unknown',
  profile,
  profileId,
  xUserId,
} = {}) {
  const p = normalizeBrandingProfile(profile);
  const inner = contentHtml != null
    ? prepareBrandedExportContentHtml(contentHtml)
    : element
      ? cloneForBrandedPdf(element).innerHTML
      : '';
  if (!String(inner).trim() && type !== 'pdf') {
    throw new Error('No content to export.');
  }

  if (type === 'html') {
    downloadBrandedHtmlFile(inner, filename, p, { module: mod });
    return;
  }
  if (type === 'word') {
    const { downloadBrandedDocx } = await import('./brandedDocxExport');
    await downloadBrandedDocx({ profile: p, contentHtml: inner, filename, module: mod });
    return;
  }

  await downloadBrandedPdfUnified({
    element,
    contentHtml: contentHtml != null ? contentHtml : null,
    filename,
    profile: p,
    profileId,
    xUserId,
    module: mod,
  });
}
