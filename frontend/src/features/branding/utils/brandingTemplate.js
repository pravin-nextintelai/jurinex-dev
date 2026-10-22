import DOMPurify from 'dompurify';
import { normalizeBrandingProfile, resolveBrandingTokens } from './brandingProfileDefaults';
import { brandingHeadingPt } from './brandingTypography';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} html */
export function sanitizeBrandingContentHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''), { USE_PROFILES: { html: true } });
}

// ── Page geometry: px at 96 dpi for html2canvas; mm for CSS ─────────────────

export const PAGE_MM = {
  a4: { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } },
  letter: { portrait: { w: 215.9, h: 279.4 }, landscape: { w: 279.4, h: 215.9 } },
  legal: { portrait: { w: 215.9, h: 355.6 }, landscape: { w: 355.6, h: 215.9 } },
};

export const PAGE_PX = {
  a4: { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } },
  letter: { portrait: { w: 816, h: 1056 }, landscape: { w: 1056, h: 816 } },
  legal: { portrait: { w: 816, h: 1344 }, landscape: { w: 1344, h: 816 } },
};

export function getPageDimensions(profile) {
  const p = normalizeBrandingProfile(profile);
  const pageSize = p.pageSize || 'a4';
  const orientation = p.orientation || 'portrait';
  return PAGE_PX[pageSize]?.[orientation] || PAGE_PX.a4.portrait;
}

export function getPageDimensionsMm(profile) {
  const p = normalizeBrandingProfile(profile);
  const pageSize = p.pageSize || 'a4';
  const orientation = p.orientation || 'portrait';
  return PAGE_MM[pageSize]?.[orientation] || PAGE_MM.a4.portrait;
}

/**
 * Pixel height of one html2pdf page slice: floor(pageWidth × innerWidth/innerHeight).
 * Watermark pattern tiles must use this height or PDF page breaks cut through the text.
 */
/** Printable content width in px (page width minus left/right margins). */
export function getPrintableWidthPx(profile, pageWidthPx = 794) {
  const p = normalizeBrandingProfile(profile);
  const pageMm = getPageDimensionsMm(p);
  const ml = p.marginLeft ?? 20;
  const mr = p.marginRight ?? 20;
  const innerW = pageMm.w - ml - mr;
  if (innerW <= 0) return Number(pageWidthPx) || 794;
  return Math.floor(Number(pageWidthPx) * (innerW / pageMm.w));
}

export function getPdfPageSliceHeightPx(profile, pageWidthPx = 794) {
  const p = normalizeBrandingProfile(profile);
  const pageMm = getPageDimensionsMm(p);
  const mt = p.marginTop ?? 20;
  const ml = p.marginLeft ?? 20;
  const mb = p.marginBottom ?? 20;
  const mr = p.marginRight ?? 20;
  const innerW = pageMm.w - ml - mr;
  const innerH = pageMm.h - mt - mb;
  if (innerH <= 0 || innerW <= 0) return Math.max(200, Number(pageWidthPx) || 794);
  return Math.floor(Number(pageWidthPx) * (innerW / innerH));
}

/** Extra bottom @page margin so Chromium PDF footer templates do not overlap body text. */
const PDF_FOOTER_BAND_MM = 14;

function _pageAtRule(profile, forPdf = false) {
  const p = normalizeBrandingProfile(profile);
  const size = (p.pageSize || 'a4').toUpperCase();
  const land = p.orientation === 'landscape' ? ' landscape' : '';
  /* For PDF, declare NO @page margin: a CSS @page margin (even 0) overrides the
     margins Playwright passes to Chromium's page.pdf(), printing edge-to-edge.
     Leaving it undeclared lets the profile's mm margins apply. */
  if (forPdf) return `@page{size:${size}${land};}`;
  return `@page{size:${size}${land};margin:0;}`;
}

/**
 * Fixed-position watermark for Chromium print (Playwright / Puppeteer).
 */
export function renderPrintWatermark(profile) {
  const p = normalizeBrandingProfile(profile);
  if (!p.watermark || !String(p.watermarkText || '').trim()) return '';
  const opacity = Math.min(0.2, Math.max(0.04, p.watermarkOpacity ?? 0.12));
  const rot = p.watermarkAngle ?? p.watermarkRotation ?? -30;
  const fs = p.watermarkFontSize ?? 72;
  const text = esc(p.watermarkText);
  return `<div class="brd-print-wm" aria-hidden="true">${text}</div>`;
}

/** Alias: letterhead block + accent rule (spec name `renderHeader`). */
export function renderHeader(profile) {
  return renderBrandingHeader(profile);
}

/**
 * Letterhead + accent rule (implementation).
 */
export function renderBrandingHeader(profile) {
  const p = normalizeBrandingProfile(profile);
  const primary = p.primaryColor || '#20b2aa';
  const logoSrc = p.logo || '';
  const w = p.logoWidth;
  const h = p.logoHeight;
  const logoHtml = logoSrc
    ? `<img class="brd-logo" src="${esc(logoSrc)}" alt="logo" width="${w}" height="${h}" crossorigin="anonymous">`
    : '';
  const align = p.letterheadAlignment || 'center';
  const logoPos = p.logoPosition || 'right';
  const textHtml = renderLetterheadText(profile);
  const logoW = w + 16;

  let inner;
  if (logoPos === 'center') {
    const logoRow = logoHtml
      ? `<tr><td align="center" class="brd-lh-logo-center-cell" style="text-align:center;padding:0 0 8pt 0;vertical-align:top;">${logoHtml}</td></tr>`
      : '';
    inner = `<table class="brd-lh-table brd-lh-center" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">
${logoRow}
<tr><td align="${align}" style="text-align:${align};vertical-align:top;">${textHtml}</td></tr>
</table>`;
  } else if (logoPos === 'left') {
    inner = `<table class="brd-lh-table"><tr>
      <td class="brd-lh-logo-cell" style="width:${logoW}px;">${logoHtml}</td>
      <td style="text-align:${align};">${textHtml}</td>
    </tr></table>`;
  } else {
    inner = `<table class="brd-lh-table"><tr>
      <td style="text-align:${align};">${textHtml}</td>
      ${logoHtml ? `<td class="brd-lh-logo-cell" style="width:${logoW}px;">${logoHtml}</td>` : ''}
    </tr></table>`;
  }

  const rule = p.showDivider !== false
    ? `<hr class="brd-rule" style="border-color:${esc(primary)};">`
    : '';

  return `<header class="brd-header brd-branding-header"><div class="brd-letterhead">${inner}${rule}</div></header>`;
}

export function renderLetterheadText(profile) {
  const p = normalizeBrandingProfile(profile);
  const rows = [];
  const firmLine = [p.firmName, p.advocateName].filter(Boolean).join(' · ');
  const firmStyle = `font-size:${p.firmNameFontSize ?? 16}pt;color:${p.firmNameColor || '#000000'} !important;`;
  const tagStyle  = `font-size:${p.taglineFontSize ?? 9}pt;color:${p.taglineColor || '#000000'} !important;`;
  const metaStyle = `font-size:${p.metaFontSize ?? 8.5}pt;color:${p.metaColor || '#000000'} !important;`;
  if (firmLine) rows.push(`<div class="brd-firm" style="${firmStyle}">${esc(firmLine)}</div>`);
  if (p.tagline) rows.push(`<div class="brd-tagline" style="${tagStyle}">${esc(p.tagline)}</div>`);
  if (p.barCouncilNo) rows.push(`<div class="brd-meta" style="${metaStyle}">Bar Council No: ${esc(p.barCouncilNo)}</div>`);
  if (p.officeAddress) rows.push(`<div class="brd-meta" style="${metaStyle}">${esc(p.officeAddress)}</div>`);
  const contact = [p.phone, p.email].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
  if (contact) rows.push(`<div class="brd-meta" style="${metaStyle}">${contact}</div>`);
  return rows.join('');
}

/**
 * Inline SVG watermark with a <pattern> element.
 *
 * Why inline SVG instead of CSS background-image:
 *   html2canvas silently drops SVG data-URI backgrounds on tall elements.
 *   Inline SVG is rendered faithfully across the full canvas height.
 *
 * The SVG is initially 9999 px tall; the onclone callback in brandingExport.js
 * sets it to the actual measured canvas height so it covers every PDF page.
 * Pattern tile = pageWidthPx × tileHeightPx (for PDF use getPdfPageSliceHeightPx).
 */
export function renderWatermark(profile, { pageWidthPx = 794, pageHeightPx = 1123, forPdf = false } = {}) {
  const p = normalizeBrandingProfile(profile);
  if (!p.watermark || !String(p.watermarkText || '').trim()) return '';

  const rawOpacity = p.watermarkOpacity ?? 0.12;
  /* html2canvas/JPEG exaggerate black fill-opacity — keep PDF watermarks lighter */
  const opacity = forPdf
    ? Math.min(0.12, Math.max(0.04, rawOpacity * 0.65))
    : Math.min(0.35, Math.max(0.04, rawOpacity));
  const rot     = p.watermarkAngle ?? p.watermarkRotation ?? -45;
  const fs      = p.watermarkFontSize ?? 72;
  const text    = String(p.watermarkText).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const w  = Number(pageWidthPx)  || 794;
  const h  = Number(pageHeightPx) || 1123;
  const cx = w / 2;
  const cy = h / 2;
  const fill = forPdf ? '#9ca3af' : '#000000';

  return (
    `<div class="brd-wm-layer" aria-hidden="true" style="position:absolute;top:0;left:0;width:${w}px;height:9999px;pointer-events:none;z-index:0;overflow:hidden;opacity:${opacity};">` +
    `<svg class="brd-wm-svg" xmlns="http://www.w3.org/2000/svg" width="${w}" height="9999" style="display:block;" aria-hidden="true">` +
    `<defs><pattern id="brd-wm-pat" x="0" y="0" width="${w}" height="${h}" patternUnits="userSpaceOnUse">` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" ` +
    `transform="rotate(${rot} ${cx} ${cy})" font-size="${fs}" font-weight="700" ` +
    `font-family="sans-serif" fill="${fill}" opacity="1">${text}</text>` +
    `</pattern></defs>` +
    `<rect x="0" y="0" width="${w}" height="9999" fill="url(#brd-wm-pat)"/>` +
    `</svg></div>`
  );
}

/** No longer used — watermark is now an inline SVG element, not a CSS background. */
function _watermarkBgCss() { return ''; }

export function renderDocumentHeader(profile) {
  const p = normalizeBrandingProfile(profile);
  if (!p.headerEnabled || !String(p.headerText || '').trim()) return '';
  const headerAlign = p.headerAlignment || 'center';
  const fs = p.headerFontSize || 12;
  const color = p.headerColor || '#000000';
  const headerLine = resolveBrandingTokens(p.headerText);
  return `<div class="brd-doc-header" style="text-align:${headerAlign};font-size:${fs}pt;color:${color} !important;">${esc(headerLine)}</div>`;
}

/**
 * Footer block (static footerText + optional page pattern).
 */
export function renderFooter(profile, { previewShell = false, forPrint = false, totalPagesHint = '1' } = {}) {
  const p = normalizeBrandingProfile(profile);
  if (!p.footerEnabled && !String(p.footerText || '').trim()) return '';

  const footerPos = p.footerPosition || 'bottom-center';
  /* flex-direction:column + justify-content only stacks vertically — use text-align / table align for L/C/R */
  const align = footerPos === 'bottom-left'
    ? 'left'
    : footerPos === 'bottom-right'
      ? 'right'
      : 'center';
  const footerNums = (p.footerPattern || 'Page {n} of {total}')
    .replace(/\{n\}/g, '1')
    .replace(/\{total\}/g, previewShell ? '12' : totalPagesHint);

  const staticLine = p.footerText
    ? `<div class="brd-footer-static" style="text-align:${align};">${esc(resolveBrandingTokens(p.footerText))}</div>`
    : '';
  const numsLine = p.footerEnabled
    ? `<div class="brd-footer-numbers" style="text-align:${align};">${esc(footerNums)}</div>`
    : '';
  const inner = `${staticLine}${numsLine}`;
  if (!inner.trim()) return '';

  const cls = forPrint
    ? 'brd-footer brd-footer-print'
    : previewShell
      ? 'brd-footer brd-footer-abs'
      : 'brd-footer';
  const fColor = p.footerColor || '#000000';
  const fs = p.footerFontSize || 10;
  return `<footer class="${cls}">
<table class="brd-footer-table" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;mso-table-lspace:0pt;mso-table-rspace:0pt;">
<tr><td align="${align}" style="text-align:${align};font-size:${fs}pt;color:${fColor};padding:8pt 0 0;border-top:1pt solid #e5e7eb;vertical-align:top;background:#fff;">
${inner}
</td></tr>
</table>
</footer>`;
}

export function getBrandingCss(profile, { forPdf = false, pageWidthPx, pageHeightPx, previewShell = false } = {}) {
  const p = normalizeBrandingProfile(profile);
  // PDF content typography mirrors the plain (reportlab) response exporter so
  // branded and non-branded PDF downloads read identically; the letterhead,
  // watermark, and footer keep the profile's brand fonts and colors.
  const ff = forPdf ? 'Helvetica' : (p.fontFamily || 'Times New Roman').replace(/'/g, "\\'");
  const fs = forPdf ? 11 : (p.fontSize ?? 15);
  const lh = forPdf ? 1.4 : (p.lineHeight ?? 1.5);
  const primary = p.primaryColor || '#20b2aa';
  const bodyC = p.bodyTextColor || '#000000';
  const mt = p.marginTop ?? 20;
  const mr = p.marginRight ?? 20;
  const mb = p.marginBottom ?? 20;
  const ml = p.marginLeft ?? 20;
  const W = pageWidthPx ? `${Number(pageWidthPx)}px` : '100%';
  const shellMinH = pageHeightPx ? `${Number(pageHeightPx)}px` : '297mm';
  const footerReserve = (p.footerEnabled || String(p.footerText || '').trim()) ? 14 : 0;
  const pdfContentPad = forPdf
    ? `8pt 0 ${mb + footerReserve}mm 0`
    : '4pt 0 0 0';
  const wmRot = p.watermarkAngle ?? p.watermarkRotation ?? -30;
  const wmFs = p.watermarkFontSize ?? 72;
  const wmOpacity = Math.min(0.2, Math.max(0.04, p.watermarkOpacity ?? 0.12));
  // Same heading scale as merged_pdf_service.py: max(10.5, 17 − 1.5×(level−1))
  const ffStack = forPdf ? `'${ff}',Arial,sans-serif` : `'${ff}','Times New Roman',Times,serif`;
  const h1 = forPdf ? 17 : brandingHeadingPt(p, 1);
  const h2 = forPdf ? 15.5 : brandingHeadingPt(p, 2);
  const h3 = forPdf ? 14 : brandingHeadingPt(p, 3);
  const h4 = forPdf ? 12.5 : brandingHeadingPt(p, 4);
  const h5 = forPdf ? 11 : brandingHeadingPt(p, 5);
  const h6 = forPdf ? 10.5 : brandingHeadingPt(p, 6);
  const headC = forPdf ? '#111827' : bodyC;
  const bodyTypo = `
  .brd-outer .brd-content,.brd-outer .brd-content p,.brd-outer .brd-content li,.brd-outer .brd-content td,.brd-outer .brd-content th,.brd-outer .brd-content span,.brd-outer .brd-content div:not(pre):not(code){
    font-family:inherit !important;font-size:${fs}pt !important;line-height:${lh} !important;color:${bodyC} !important;}
  .brd-outer .brd-content strong,.brd-outer .brd-content b{font-weight:700 !important;color:${bodyC} !important;}
  .brd-outer .brd-content em,.brd-outer .brd-content i{font-style:italic !important;color:${bodyC} !important;}`;
  const printExtras = forPdf
    ? `
  html,body,.brd-body-standalone{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .brd-print-wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    font-size:${wmFs}pt;font-weight:700;color:#9ca3af;opacity:${wmOpacity};transform:rotate(${wmRot}deg);
    pointer-events:none;z-index:0;white-space:nowrap;}
  .brd-page{padding:0;min-height:auto;}
  .brd-outer{width:100%;max-width:none;}
  ${bodyTypo}
  `
    : bodyTypo;

  // Scope ALL data-table styles under .brd-content so they never bleed into the
  // letterhead table (.brd-lh-table) which has its own layout and must not inherit
  // column-width hints, borders, or font-size overrides from content table rules.
  const tableStyles = forPdf
    ? `.brd-outer .brd-content table{width:100%;max-width:100%;border-collapse:collapse;margin:8pt 0;font-size:9.5pt;table-layout:auto;}
       .brd-outer .brd-content th{border:.75pt solid #9ca3af;padding:4pt 5pt;background:#f3f4f6;font-weight:700;text-align:left;color:#1f2937 !important;font-size:9.5pt !important;line-height:1.35 !important;overflow-wrap:break-word;white-space:normal;}
       .brd-outer .brd-content td{border:.75pt solid #d1d5db;padding:4pt 5pt;vertical-align:top;color:#374151 !important;font-size:9.5pt !important;line-height:1.35 !important;overflow-wrap:break-word;}
       .brd-outer .brd-content thead{display:table-header-group;}
       .brd-outer .brd-content tbody tr:nth-child(even) td{background:#f9fafb;}`
    : `.brd-outer .brd-content table{width:100%;border-collapse:collapse;margin:10pt 0;font-size:10pt;table-layout:auto;}
       .brd-outer .brd-content th{border:1pt solid #9ca3af;padding:5pt 7pt;background:#f3f4f6;font-weight:700;text-align:left;color:#1f2937;white-space:normal;word-break:break-word;}
       .brd-outer .brd-content td{border:1pt solid #d1d5db;padding:5pt 7pt;vertical-align:top;color:#374151;word-break:break-word;}
       .brd-outer .md-table-scroll{overflow-x:auto;}.brd-outer .brd-content thead{display:table-header-group;}.brd-outer .brd-content tbody tr:nth-child(even) td{background:#f9fafb;}`;

  return `
  ${_pageAtRule(p, forPdf)}
  ${printExtras}
  .brd-body-standalone,.brd-body-standalone .brd-root{-webkit-font-smoothing:auto;-moz-osx-font-smoothing:auto;}
  .brd-outer *,.brd-outer *::before,.brd-outer *::after{box-sizing:border-box;}
  .brd-root{position:relative;margin:0;padding:0;background:#fff;}
  .brd-outer{position:relative;font-family:${ffStack};font-size:${fs}pt;line-height:${lh};color:${bodyC};background:#fff;width:${W};margin:0 auto;}
  .brd-page{position:relative;width:100%;min-height:${shellMinH};padding:${forPdf ? '0' : `${mt}mm ${mr}mm ${mb}mm ${ml}mm`};background:#fff;overflow:${forPdf ? 'visible' : 'hidden'};display:flex;flex-direction:column;isolation:isolate;}
  .brd-wm-layer{z-index:0!important;}
  .brd-stack{position:relative;z-index:2;transform:translateZ(0);flex:1;display:flex;flex-direction:column;width:100%;}
  .brd-outer .brd-content h1{font-size:${h1}pt !important;font-weight:700;color:${headC} !important;margin:${forPdf ? '10pt 0 4pt' : '16pt 0 8pt'};${forPdf ? '' : 'border-bottom:1pt solid #e5e7eb;padding-bottom:4pt;'}page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content h2{font-size:${h2}pt !important;font-weight:700;color:${headC} !important;margin:${forPdf ? '10pt 0 4pt' : '13pt 0 7pt'};page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content h3{font-size:${h3}pt !important;font-weight:${forPdf ? 700 : 600};color:${headC} !important;margin:${forPdf ? '8pt 0 4pt' : '11pt 0 5pt'};page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content h4{font-size:${h4}pt !important;font-weight:${forPdf ? 700 : 600};color:${headC} !important;margin:${forPdf ? '8pt 0 4pt' : '9pt 0 4pt'};page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content h5{font-size:${h5}pt !important;font-weight:${forPdf ? 700 : 600};color:${headC} !important;margin:${forPdf ? '8pt 0 4pt' : '9pt 0 4pt'};page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content h6{font-size:${h6}pt !important;font-weight:${forPdf ? 700 : 600};color:${headC} !important;margin:${forPdf ? '8pt 0 4pt' : '9pt 0 4pt'};page-break-after:avoid;font-family:inherit !important;}
  .brd-outer .brd-content{position:relative;z-index:2;padding:${pdfContentPad};margin:0;page-break-inside:auto;color:${bodyC};flex:1;background:transparent;font-family:${ffStack};font-size:${fs}pt;line-height:${lh};}
  .brd-outer .brd-content p{margin:0 0 ${forPdf ? 7 : 8}pt;text-align:justify;text-justify:inter-word;orphans:3;widows:3;}
  .brd-outer .brd-content table{width:100%;border-collapse:collapse;page-break-inside:auto;}
  .brd-outer .brd-content tr{page-break-inside:avoid;page-break-after:auto;}
  .brd-outer .brd-content ul,.brd-outer .brd-content ol{margin:5pt 0 9pt;padding-left:18pt;}
  .brd-outer .brd-content li{margin-bottom:3pt;page-break-inside:avoid;}
  .brd-outer .brd-content blockquote{border-left:3pt solid ${primary};padding:7pt 11pt;margin:9pt 0;background:#eff6ff;color:#1e40af !important;font-style:italic;font-size:${fs}pt !important;}
  .brd-outer code{font-family:'Courier New',monospace;font-size:9pt;background:#f3f4f6;padding:1pt 3pt;border-radius:2pt;}
  .brd-outer pre{background:#1f2937;color:#f9fafb;padding:9pt;border-radius:3pt;font-family:'Courier New',monospace;font-size:8.5pt;margin:9pt 0;white-space:pre-wrap;word-break:break-all;}
  .brd-outer strong,.brd-outer b{font-weight:700;}.brd-outer em,.brd-outer i{font-style:italic;}
  .brd-outer hr{border:none;border-top:1pt solid #e5e7eb;margin:12pt 0;}
  .brd-outer .brd-content img{max-width:100%;height:auto;}
  .brd-outer .brd-content .batch-results-export,.brd-outer .brd-content .batch-export-item{max-width:100%;overflow-wrap:break-word;word-break:break-word;}
  .brd-outer .brd-content .batch-export-item{page-break-inside:auto;margin-bottom:24pt;}
  .brd-outer .brd-content .batch-export-item h2{page-break-after:avoid;}
  .brd-outer .html2pdf__page-break{page-break-before:always;}
  .brd-outer .brd-watermark{position:absolute;top:50%;left:50%;pointer-events:none;z-index:0;color:#000;font-weight:900;white-space:nowrap;}
  .brd-outer .brd-watermark-img img{max-width:280px;max-height:200px;object-fit:contain;display:block;}
  .brd-outer .brd-branding-header,.brd-outer .brd-doc-header,.brd-outer .brd-footer{position:relative;z-index:2;}
  .brd-outer .brd-letterhead{padding-top:0;padding-bottom:0;}
  .brd-outer .brd-letterhead .brd-meta:last-child{margin-bottom:10pt;}
  .brd-outer .brd-lh-table{width:100%;border-collapse:collapse;border:none;}
  .brd-outer .brd-lh-table td{border:none!important;background:none!important;padding:0;margin:0;font-size:inherit;vertical-align:top;}
  .brd-outer .brd-lh-logo-cell{vertical-align:top;padding:${p.logoPosition === 'left' ? '0 12px 0 0' : '0 0 0 12px'};}
  .brd-outer .brd-lh-center{width:100%;}
  .brd-outer .brd-lh-logo-center-cell{text-align:center;}
  .brd-outer .brd-logo-wrap-center{text-align:center;margin:0 auto 8px;width:100%;}
  .brd-outer .brd-logo{width:var(--brd-logo-w,${p.logoWidth}px);height:var(--brd-logo-h,${p.logoHeight}px);max-width:100%;object-fit:contain;display:block;margin-left:auto;margin-right:auto;}
  .brd-outer .brd-firm{font-size:${p.firmNameFontSize ?? 16}pt;font-weight:700;color:${p.firmNameColor || '#000000'} !important;letter-spacing:-.01em;}
  .brd-outer .brd-tagline{font-size:${p.taglineFontSize ?? 9}pt;color:${p.taglineColor || '#000000'} !important;margin-top:3pt;}
  .brd-outer .brd-meta{font-size:${p.metaFontSize ?? 8.5}pt;color:${p.metaColor || '#000000'} !important;margin-top:2pt;}
  .brd-outer hr.brd-rule{border:none;border-top:2.5px solid ${primary};margin:14pt 0 12pt;display:block;width:100%;clear:both;height:0;line-height:0;}
  .brd-outer .brd-doc-header{font-weight:600;color:${p.headerColor || '#000000'} !important;padding:6pt 0 0;margin:0;}
  .brd-outer .brd-footer{padding:0;margin-top:0;background:#fff;width:100%;}
  .brd-outer .brd-footer-table{width:100%;}
  .brd-outer .brd-footer-abs{position:absolute;bottom:0;left:0;right:0;margin-top:0;width:100%;}
  ${previewShell ? `.brd-page-shell{position:relative;min-height:${shellMinH};}` : ''}
  ${tableStyles}
  @media print{
    .brd-outer pre{white-space:pre-wrap;}
  }
  ${_watermarkBgCss(p, { pageWidthPx: Number(pageWidthPx) || 794, pageHeightPx: Number(pageHeightPx) || 1123 })}`;
}

/**
 * Full HTML document used by preview iframe, Playwright PDF, Word blob, and HTML download.
 */
export function buildBrandedHtml(contentHtml, profile, {
  forPdf = false,
  pageWidthPx = 794,
  pageHeightPx = 1123,
  previewShell = false,
  sanitize = true,
} = {}) {
  const p = normalizeBrandingProfile(profile);
  const safeInner = sanitize ? sanitizeBrandingContentHtml(contentHtml || '') : String(contentHtml || '');

  const googleFonts = ['Lato', 'Roboto', 'Montserrat', 'Open Sans', 'DM Sans'];
  const ff = p.fontFamily || 'Times New Roman';
  const fontLink = googleFonts.includes(ff)
    ? `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(ff)}:wght@400;700&display=swap" rel="stylesheet">`
    : '';

  const css = getBrandingCss(p, {
    forPdf,
    pageWidthPx,
    pageHeightPx,
    previewShell,
  });

  const logoW = p.logoWidth;
  const logoH = p.logoHeight;
  const layoutW = forPdf ? pageWidthPx : pageWidthPx;

  const wm = forPdf
    ? renderPrintWatermark(p)
    : renderWatermark(p, { pageWidthPx: layoutW, pageHeightPx, forPdf: false });
  const hdr = renderBrandingHeader(p);
  const docHdr = renderDocumentHeader(p);
  /* PDF page numbers: Chromium footer template on server (not CSS counters / fixed footer). */
  const foot = forPdf ? '' : renderFooter(p, { previewShell, forPrint: false, totalPagesHint: '~' });

  const pageInner = `
${wm}
<div class="brd-stack">
${hdr}
${docHdr}
<div class="brd-content">
${safeInner}
</div>
${foot}
</div>
`;

  const outerStyle = forPdf
    ? `--brd-logo-w:${logoW}px;--brd-logo-h:${logoH}px;width:100%;max-width:100%;`
    : `--brd-logo-w:${logoW}px;--brd-logo-h:${logoH}px;width:${layoutW}px;max-width:100%;`;
  const body = previewShell
    ? `<div class="brd-root"><div class="brd-outer" style="${outerStyle}"><div class="brd-page brd-page-shell">${pageInner}</div></div></div>`
    : `<div class="brd-root"><div class="brd-outer" style="${outerStyle}"><div class="brd-page">${pageInner}</div></div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${fontLink}
<style>${css}</style>
</head>
<body class="brd-body-standalone">
${body}
</body>
</html>`;
}

function mmToPt(mm) {
  return Math.round(((Number(mm) || 0) * 72) / 25.4 * 100) / 100;
}

/**
 * Microsoft Word (HTML-as-.doc) often turns <div> blocks into floating text boxes with move handles.
 * This builder uses only <p class="MsoNormal"> + fixed table grids, table-cell borders (no <hr>),
 * and percentage column widths so left/right letterhead stays stable.
 */
export function buildBrandedWordHtml(contentHtml, profile, {
  pageWidthPx  = 794,
  pageHeightPx = 1123,
  sanitize = true,
} = {}) {
  const p = normalizeBrandingProfile(profile);
  const safeInner = sanitize ? sanitizeBrandingContentHtml(contentHtml || '') : String(contentHtml || '');

  const ff = String(p.fontFamily || 'Times New Roman').replace(/'/g, '&#39;');
  const fs = p.fontSize ?? 15;
  const lh = p.lineHeight ?? 1.5;
  const primary = p.primaryColor || '#20b2aa';
  const padT = mmToPt(p.marginTop ?? 20);
  const padR = mmToPt(p.marginRight ?? 20);
  const padB = mmToPt(p.marginBottom ?? 20);
  const padL = mmToPt(p.marginLeft ?? 20);

  // Watermark: VML shape inside a Word header element, positioned absolutely relative to the page.
  // This is how Word's own native watermark feature works — CSS background-image is ignored by Word.
  let wmHeaderHtml = '';
  let wmHeaderRef = '';
  if (p.watermark && String(p.watermarkText || '').trim()) {
    const wmOpacity = p.watermarkOpacity ?? 0.12;
    const wmRot     = p.watermarkAngle ?? p.watermarkRotation ?? -45;
    const wmFs      = p.watermarkFontSize ?? 72;
    const wmText    = esc(String(p.watermarkText));
    // Map opacity to a gray color (VML doesn't support CSS opacity on shapes).
    // opacity 0.12 → ~230 gray;  opacity 0.3 → ~190 gray
    const grayVal   = Math.max(160, Math.min(240, Math.round(255 - wmOpacity * 300)));
    const gHex      = grayVal.toString(16).padStart(2, '0');
    const wmColor   = `#${gHex}${gHex}${gHex}`;

    wmHeaderHtml = `<div style="mso-element:header" id="hdr_wm">
<p class="MsoHeader" style="margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;">
<!--[if gte vml 1]><v:shape id="wm_1" o:spid="_x0000_s1026" type="#_x0000_t202"
  style="position:absolute;left:0;text-align:left;margin-left:0;margin-top:0;
         width:600pt;height:220pt;z-index:-251657216;
         mso-position-horizontal:center;mso-position-horizontal-relative:page;
         mso-position-vertical:center;mso-position-vertical-relative:page;
         mso-wrap-style:none;rotation:${wmRot}"
  o:allowincell="f" fillcolor="none" strokecolor="none">
  <v:fill on="f"/>
  <v:stroke on="f"/>
  <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:f">
    <div style="text-align:center;font-size:${wmFs}pt;font-weight:bold;
                color:${wmColor};font-family:sans-serif;">${wmText}</div>
  </v:textbox>
</v:shape><![endif]-->
</p>
</div>`;
    wmHeaderRef = '\n  mso-header: hdr_wm;';
  }

  const logoSrc = p.logo ? String(p.logo) : '';
  const lw = p.logoWidth;
  const logoH = p.logoHeight;
  const align = p.letterheadAlignment || 'center';
  const logoPos = p.logoPosition || 'right';
  // Convert px → pt (1pt = 1.333px). Only CSS style used — HTML width/height attrs
  // cause Word to treat values as pt not px, producing the wrong rendered size.
  const imgWpt = Math.max(8, Math.round((Number(lw) || 80) * 0.75));
  const imgHpt = Math.max(8, Math.round((Number(logoH) || 80) * 0.75));

  const firmLine = [p.firmName, p.advocateName].filter(Boolean).join(' · ');
  const contactLine = [p.phone, p.email].filter(Boolean).join(' · ');

  const pBase = `margin:0 0 3pt 0;mso-margin-top-alt:0;mso-margin-bottom-alt:3pt;mso-line-height-rule:exactly;line-height:115%;font-family:'${ff}','Times New Roman',serif;`;

  const firmC = p.firmNameColor || '#000000';
  const tagC = p.taglineColor || '#000000';
  const metaC = p.metaColor || '#000000';
  const hdrC = p.headerColor || '#000000';
  const footC = p.footerColor || '#000000';
  const textParas = [
    firmLine
      ? `<p class="MsoNormal" style="${pBase}font-size:${p.firmNameFontSize ?? 16}pt;font-weight:bold;color:${firmC};text-align:${align};"><b>${esc(firmLine)}</b></p>`
      : '',
    p.tagline
      ? `<p class="MsoNormal" style="${pBase}font-size:${p.taglineFontSize ?? 9}pt;color:${tagC};text-align:${align};">${esc(p.tagline)}</p>`
      : '',
    p.barCouncilNo
      ? `<p class="MsoNormal" style="${pBase}font-size:${p.metaFontSize ?? 8.5}pt;color:${metaC};text-align:${align};">Bar Council No: ${esc(p.barCouncilNo)}</p>`
      : '',
    p.officeAddress
      ? `<p class="MsoNormal" style="${pBase}font-size:${p.metaFontSize ?? 8.5}pt;color:${metaC};text-align:${align};">${esc(p.officeAddress)}</p>`
      : '',
    contactLine
      ? `<p class="MsoNormal" style="${pBase}font-size:${p.metaFontSize ?? 8.5}pt;color:${metaC};text-align:${align};">${esc(contactLine)}</p>`
      : '',
  ].filter(Boolean).join('');

  // Word treats unitless HTML width/height attrs as POINTS (not pixels), so we pass
  // the pt-converted values in both the attrs AND the CSS style so both sources agree.
  // mso-width-source:userset prevents Word from auto-rescaling on open.
  const logoImgTag = logoSrc
    ? `<img src="${esc(logoSrc)}" width="${imgWpt}" height="${imgHpt}" style="width:${imgWpt}pt;height:${imgHpt}pt;mso-width-source:userset;mso-height-source:userset;" />`
    : '';

  // table-layout:fixed forces Word to honour percentage column widths regardless
  // of content size — without it Word auto-expands the logo column.
  const tbl = (inner) =>
    `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">${inner}</table>`;

  const logoCell = (align) => logoImgTag
    ? `<p class="MsoNormal" style="margin:0;mso-line-height-rule:exactly;text-align:${align};">${logoImgTag}</p>`
    : '&nbsp;';

  let letterheadBlock = '';
  if (logoPos === 'center') {
    const logoBlock = logoImgTag
      ? `<p class="MsoNormal" align="center" style="margin:0 0 6pt 0;mso-line-height-rule:exactly;text-align:center;">${logoImgTag}</p>`
      : '';
    letterheadBlock = tbl(`<tr><td valign="top" style="padding:0;vertical-align:top;overflow:hidden;">${logoBlock}${textParas}</td></tr>`);
  } else if (logoPos === 'left') {
    letterheadBlock = tbl(`<tr>
<td valign="top" width="28%" style="width:28.0%;vertical-align:top;padding:0 10pt 0 0;overflow:hidden;">${logoCell('left')}</td>
<td valign="top" width="72%" style="width:72.0%;vertical-align:top;padding:0;overflow:hidden;">${textParas || '&nbsp;'}</td>
</tr>`);
  } else {
    letterheadBlock = tbl(`<tr>
<td valign="top" width="72%" style="width:72.0%;vertical-align:top;padding:0 10pt 0 0;overflow:hidden;">${textParas || '&nbsp;'}</td>
<td valign="top" width="28%" style="width:28.0%;vertical-align:top;padding:0;overflow:hidden;">${logoCell('right')}</td>
</tr>`);
  }

  const rule = p.showDivider !== false
    ? tbl(`<tr><td style="padding:0;mso-line-height-rule:exactly;line-height:1pt;font-size:1pt;border:none;border-top:solid ${primary} 2.25pt;">&nbsp;</td></tr>`)
    : '';

  const docHdr = p.headerEnabled && String(p.headerText || '').trim()
    ? `<p class="MsoNormal" align="${p.headerAlignment || 'center'}" style="${pBase}font-size:${p.headerFontSize || 12}pt;font-weight:bold;color:${hdrC};padding-top:6pt;text-align:${p.headerAlignment || 'center'};"><b>${esc(resolveBrandingTokens(p.headerText))}</b></p>`
    : '';

  const wmNote = '';

  const footerAlign = p.footerPosition === 'bottom-left'
    ? 'left'
    : p.footerPosition === 'bottom-right'
      ? 'right'
      : 'center';
  const hasFooter   = p.footerEnabled || String(p.footerText || '').trim();
  const footerFontPt = p.footerFontSize || 9;
  const fp = `margin:0;font-family:'${ff}','Times New Roman',serif;mso-line-height-rule:exactly;font-size:${footerFontPt}pt;`;

  // Word-native per-page footer using mso-element:footer + PAGE / NUMPAGES field codes.
  // This replaces the old static footerBlock (which only appeared at end of document).
  let nativeFooterHtml = '';
  if (hasFooter) {
    const lines = [];
    if (p.footerText) {
      lines.push(
        `<p class="MsoFooter" align="${footerAlign}" style="${fp}margin-bottom:2pt;color:${footC};text-align:${footerAlign};">` +
        `<b>${esc(resolveBrandingTokens(p.footerText))}</b></p>`,
      );
    }
    if (p.footerEnabled) {
      lines.push(
        `<p class="MsoFooter" align="${footerAlign}" style="${fp}color:${footC};text-align:${footerAlign};">` +
        `Page <!--[if supportFields]><span style='mso-element:field-begin'></span> PAGE \\* ARABIC \\* MERGEFORMAT ` +
        `<span style='mso-element:field-separator'></span><![endif]-->1` +
        `<!--[if supportFields]><span style='mso-element:field-end'></span><![endif]--> of ` +
        `<!--[if supportFields]><span style='mso-element:field-begin'></span> NUMPAGES \\* ARABIC \\* MERGEFORMAT ` +
        `<span style='mso-element:field-separator'></span><![endif]-->1` +
        `<!--[if supportFields]><span style='mso-element:field-end'></span><![endif]-->` +
        `</p>`,
      );
    }
    nativeFooterHtml = `<div style="mso-element:footer" id="ftr1">\n${lines.join('\n')}\n</div>`;
  }

  const bodyBlock = safeInner.trim()
    ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;"><tr><td valign="top" style="padding:10pt 0 0 0;vertical-align:top;font-size:${fs}pt;line-height:${lh};mso-line-height-rule:exactly;color:#1f1f1f;font-family:'${ff}','Times New Roman',serif;">${safeInner}</td></tr></table>`
    : `<p class="MsoNormal" style="${pBase}font-size:${fs}pt;">&nbsp;</p>`;

  // Footer removed from body flow — Word renders it natively on every page
  const bodyFlow = `
${letterheadBlock}
${rule}
${docHdr}
${wmNote}
${bodyBlock}
`;

  // @page Section1 controls all four margins so Word-native header/footer are
  // horizontally aligned with the body content (no separate <td> indentation needed).
  const pageSizes = { a4: '210mm 297mm', letter: '8.5in 11in', legal: '8.5in 14in' };
  const pageSizeCss = `${pageSizes[p.pageSize || 'a4']}${p.orientation === 'landscape' ? ' landscape' : ''}`;
  // Footer starts 12 mm from the bottom edge; bottom margin gives the footer its band.
  const footerMarginPt = Math.round(mmToPt(12));

  // L/R are now part of @page, so the body wrapper <td> uses padding:0.
  const wrapped = tbl(
    `<tr><td valign="top" style="padding:0;vertical-align:top;">${bodyFlow}</td></tr>`,
  );

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="en">
<head>
<meta charset="UTF-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word 15">
<!--[if gte mso 9]><xml>
<w:WordDocument>
  <w:View>Print</w:View>
  <w:Zoom>100</w:Zoom>
  <w:DoNotShowRevisions/>
  <w:DoNotPrintRevisions/>
  <w:DisplayHorizontalDrawingGridEvery>0</w:DisplayHorizontalDrawingGridEvery>
  <w:DisplayVerticalDrawingGridEvery>0</w:DisplayVerticalDrawingGridEvery>
  <w:UseMarginsForDocumentGrid/>
</w:WordDocument>
</xml><![endif]-->
<style type="text/css">
p.MsoNormal, li.MsoNormal, div.MsoNormal { mso-line-height-rule: exactly; }
table td { vertical-align: top; }
div.Section1 { page: Section1; }
@page Section1 {
  size: ${pageSizeCss};
  margin: ${padT}pt ${padR}pt ${padB}pt ${padL}pt;
  mso-header-margin: ${wmHeaderHtml ? '0.1in' : '.3in'};
  mso-footer-margin: ${footerMarginPt}pt;
  mso-paper-source: 0;${hasFooter ? '\n  mso-footer: ftr1;' : ''}${wmHeaderRef}
}
p.MsoFooter { mso-style-name: "Footer"; margin: 0; mso-pagination: widow-orphan; }
</style>
</head>
<body lang="EN-US" style="tab-interval:36.0pt;">
<div class="Section1">
${wrapped}
</div>
${nativeFooterHtml}
${wmHeaderHtml}
</body>
</html>`;
}

export function buildPreviewSampleContentHtml(profile) {
  const p = normalizeBrandingProfile(profile);
  const firmSig = p.firmName || p.advocateName || '[Firm / Advocate Name]';
  const contactSig = [p.phone, p.email].filter(Boolean).join(' · ');
  return `
<h2 style="text-align:center;font-size:11pt;margin-bottom:10pt;">IN THE HIGH COURT OF JUDICATURE</h2>
<p style="text-align:center;font-size:8.5pt;color:#9ca3af;margin-bottom:14pt;">— Letterhead &amp; Branding Preview — Not a Legal Document —</p>
<p><strong>Writ Petition No. 1234 of 2024</strong></p>
<p><strong>In the matter of:</strong><br />ABC Corporation Limited <span style="font-style:italic;">Petitioner</span></p>
<p><strong>Versus</strong></p>
<p>State of Maharashtra <span style="font-style:italic;">Respondent</span></p>
<h3>SYNOPSIS</h3>
<p>This document previews how your branded letterhead will appear on exports from Jurinex AI — including case summaries, legal notices, petition drafts, and client correspondence.</p>
<p>The font family, size, line height, accent colour, header, and footer shown here reflect your current branding profile settings.</p>
<p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore veritatis quasi architecto beatae vitae.</p>
<p>Yours faithfully,</p>
<p><strong>${esc(firmSig)}</strong></p>
${p.barCouncilNo ? `<p style="font-size:9pt;color:#6b7280;">Bar Council No: ${esc(p.barCouncilNo)}</p>` : ''}
${contactSig ? `<p style="font-size:9pt;color:#6b7280;">${esc(contactSig)}</p>` : ''}
`.trim();
}
