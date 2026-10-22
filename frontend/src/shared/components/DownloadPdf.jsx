import React, { useState } from 'react';
import { Download, Printer, Loader2 } from 'lucide-react';

const DownloadPdf = ({ markdownOutputRef, contentRef, questionTitle }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [activeMethod, setActiveMethod] = useState('canvas');

  const getSourceElement = () => contentRef?.current || markdownOutputRef?.current || null;

  const containsDevanagari = (text) => /[\u0900-\u097F]/.test(text || '');

  const inlineComputedStyles = (sourceNode, targetNode) => {
    if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) return;
    const computed = window.getComputedStyle(sourceNode);
    const styleText = Array.from(computed)
      .map((prop) => `${prop}: ${computed.getPropertyValue(prop)};`)
      .join(' ');
    targetNode.setAttribute('style', styleText);
    const sourceChildren = Array.from(sourceNode.children);
    const targetChildren = Array.from(targetNode.children);
    for (let i = 0; i < sourceChildren.length; i++) {
      inlineComputedStyles(sourceChildren[i], targetChildren[i]);
    }
  };

  const loadHtml2Pdf = async () => {
    if (window.html2pdf) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      script.onload = () => {
        setTimeout(() => {
          if (window.html2pdf) resolve();
          else reject(new Error('html2pdf failed to initialize'));
        }, 100);
      };
      script.onerror = () => reject(new Error('Failed to load html2pdf.js'));
      document.head.appendChild(script);
    });
  };

  const ensureFontsLoaded = async () => {
    if (!document.querySelector('link[href*="Noto+Sans+Devanagari"]')) {
      const fontLink = document.createElement('link');
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
      fontLink.rel = 'stylesheet';
      document.head.appendChild(fontLink);
    }
    if (document.fonts) await document.fonts.ready;
  };

  const buildPdfHtmlString = (sourceElement, hasDevanagari) => {
    const fontStack = hasDevanagari
      ? '"Noto Sans Devanagari", "Times New Roman", Times, serif'
      : '"Times New Roman", Times, Georgia, serif';

    const reportDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    // Clone and strip buttons / conversational openers
    const cloned = sourceElement.cloneNode(true);
    cloned.querySelectorAll('button').forEach((b) => b.remove());

    const conversationalPhrases = [
      /^(Okay|Sure|Here'?s|I'?ll|Let me|I'?ve|Certainly|Of course|Absolutely|Great|Perfect|Alright),.*?\.(\s|$)/i,
    ];
    const walker = document.createTreeWalker(cloned, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    textNodes.slice(0, 3).forEach((tn) => {
      let text = tn.textContent.trim();
      conversationalPhrases.forEach((re) => { text = text.replace(re, ''); });
      if (text !== tn.textContent.trim()) {
        tn.textContent = text;
        if (!tn.textContent.trim()) {
          const p = tn.parentElement;
          if (p && p.tagName === 'P') p.remove();
        }
      }
    });

    // Strip oklch colours that html2canvas cannot parse, and remove Tailwind classes
    const allEls = [cloned, ...cloned.querySelectorAll('*')];
    allEls.forEach((el) => {
      el.removeAttribute('class');
      if (el.hasAttribute('style')) {
        const safe = el.getAttribute('style').split(';')
          .filter((s) => s.trim() && !s.toLowerCase().includes('oklch'))
          .join(';');
        if (safe) el.setAttribute('style', safe);
        else el.removeAttribute('style');
      }
    });

    // Return a self-contained HTML string — html2pdf mounts this itself at position 0,0
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${fontStack};
    font-size: 13pt;
    line-height: 1.75;
    color: #444;
    background: #fff;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: ${fontStack};
    font-weight: 700;
    page-break-after: avoid;
    break-after: avoid;
    page-break-inside: avoid;
    break-inside: avoid;
    orphans: 4; widows: 4;
    border-left-style: solid;
    border-radius: 0 4pt 4pt 0;
  }
  h1 {
    font-size: 20pt; margin: 20pt 0 10pt;
    color: #1a3d2b; background: #e8f4ee;
    border-left: 5pt solid #1f6b5f;
    padding: 7pt 12pt;
  }
  h2 {
    font-size: 16pt; margin: 16pt 0 9pt;
    color: #1a3d2b; background: #eef7f2;
    border-left: 4pt solid #2d8c72;
    padding: 6pt 12pt;
  }
  h3 {
    font-size: 13pt; margin: 13pt 0 7pt;
    color: #1f3d30; background: #f3faf6;
    border-left: 3pt solid #4aab87;
    padding: 5pt 10pt;
  }
  h4 {
    font-size: 12pt; margin: 10pt 0 6pt;
    color: #2a4a38; background: #f7fcf9;
    border-left: 2pt solid #6bbfa0;
    padding: 4pt 10pt;
  }
  h5, h6 { font-size: 11pt; margin: 9pt 0 5pt; color: #444; padding: 3pt 8pt; }
  p {
    margin: 0 0 10pt;
    text-align: justify;
    text-justify: inter-word;
    line-height: 1.75;
    orphans: 4; widows: 4;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  ul, ol { margin: 8pt 0 12pt; padding-left: 22pt; }
  li {
    margin-bottom: 5pt;
    line-height: 1.7;
    page-break-inside: avoid;
    break-inside: avoid;
    orphans: 3; widows: 3;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14pt 0;
    font-size: 11pt;
    page-break-inside: auto;
    table-layout: fixed;
    word-wrap: break-word;
  }
  thead { display: table-header-group; background-color: #e8e8e8; }
  tbody { display: table-row-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th {
    border: 1px solid #999;
    padding: 8pt 7pt;
    font-weight: 700;
    font-size: 11pt;
    text-align: left;
    background-color: #e8e8e8;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    vertical-align: middle;
    page-break-inside: avoid; break-inside: avoid;
  }
  td {
    border: 1px solid #ccc;
    padding: 7pt 7pt;
    font-size: 11pt;
    line-height: 1.55;
    vertical-align: top;
    color: #444;
    background-color: #fff;
    word-break: break-word;
    page-break-inside: avoid; break-inside: avoid;
  }
  tbody tr:nth-child(even) td { background-color: #f9f9f9; }
  pre {
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 3pt;
    padding: 10pt;
    font-family: "Courier New", Courier, monospace;
    font-size: 10pt;
    line-height: 1.5;
    margin: 10pt 0;
    page-break-inside: avoid; break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
  }
  code:not(pre code) {
    background: #f5f5f5;
    padding: 1pt 4pt;
    border-radius: 2pt;
    font-family: "Courier New", Courier, monospace;
    font-size: 10.5pt;
    color: #444;
  }
  blockquote {
    border-left: 4px solid #666;
    padding: 10pt 14pt;
    margin: 12pt 0;
    background: #f9f9f9;
    font-style: italic;
    color: #444;
    font-size: 12pt;
    page-break-inside: avoid; break-inside: avoid;
  }
  strong, b { font-weight: 700; color: #333; }
  a { color: #0056b3; text-decoration: underline; }
  hr { border: none; border-top: 1px solid #ccc; margin: 18pt 0; }
  img { max-width: 100%; height: auto; page-break-inside: avoid; break-inside: avoid; }
  .html2pdf__page-break { page-break-before: always; break-before: page; }

  /* ── Jurinex Analysis header ── */
  .jurinex-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10pt 0 10pt;
    margin-bottom: 18pt;
    border-bottom: 2pt solid #21C1B6;
  }
  .jurinex-header-left {
    display: flex;
    align-items: baseline;
    gap: 8pt;
  }
  .jurinex-logo {
    font-family: ${fontStack};
    font-size: 18pt;
    font-weight: 800;
    color: #21C1B6;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .jurinex-tag {
    font-family: ${fontStack};
    font-size: 10pt;
    font-weight: 600;
    color: #6b7280;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .jurinex-header-right {
    font-family: ${fontStack};
    font-size: 9pt;
    color: #9ca3af;
    text-align: right;
    line-height: 1.5;
  }
</style>
</head>
<body>
<div class="jurinex-header">
  <div class="jurinex-header-left">
    <span class="jurinex-logo">JuriNex</span>
    <span class="jurinex-tag">Analysis</span>
  </div>
  <div class="jurinex-header-right">
    ${questionTitle ? `<div style="font-weight:600;color:#374151;font-size:10pt;">${questionTitle.substring(0, 60)}${questionTitle.length > 60 ? '…' : ''}</div>` : ''}
    <div>${reportDate}</div>
  </div>
</div>
${cloned.innerHTML}
</body>
</html>`;
  };

  const generateCanvasPdf = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setActiveMethod('canvas');

    try {
      const originalElement = getSourceElement();
      if (!originalElement) throw new Error('No content available. Please ensure the content is loaded.');

      const textContent = (originalElement.textContent || originalElement.innerText || '').trim();
      if (!textContent) throw new Error('Content is empty. Please wait for the response to finish generating.');

      console.log(`📄 Preparing PDF (${textContent.length} characters) …`);

      await loadHtml2Pdf();
      await ensureFontsLoaded();

      const hasDevanagari = containsDevanagari(textContent);
      // Build a self-contained HTML string — no off-screen DOM needed
      const htmlString = buildPdfHtmlString(originalElement, hasDevanagari);

      const timestamp = new Date().toISOString().slice(0, 10);
      const cleanTitle = questionTitle
        ? questionTitle.replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 50)
        : 'Jurinex_Response';
      const filename = `${cleanTitle}_${timestamp}.pdf`;

      const opt = {
        margin: [12, 14, 12, 14], // mm: top, right, bottom, left
        filename,
        image: { type: 'jpeg', quality: 0.97 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          letterRendering: true,
          logging: false,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
          compress: true,
        },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'tr', 'thead', 'img',
            'pre', 'blockquote', 'li',
          ],
        },
      };

      console.log('🔄 Generating PDF with html2pdf.js …');

      // Pass as HTML string — html2pdf mounts it at 0,0 so html2canvas captures full width
      await window.html2pdf().set(opt).from(htmlString, 'string').save();

      console.log('✅ PDF saved:', filename);
      setSuccess('PDF downloaded successfully!');
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      console.error('PDF generation failed:', err);

      let userMessage = `PDF generation failed: ${err.message}`;
      if (err.message.includes('timeout') || err.message.includes('timed out')) {
        userMessage = 'PDF generation timed out. The content is very long — try using the Print button instead.';
      } else if (err.message.includes('Failed to load')) {
        userMessage = 'Could not load PDF library. Check your internet connection and try again.';
      }

      setError(userMessage);
      setTimeout(() => setError(null), 8000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEnhancedPrint = () => {
    const element = getSourceElement();
    if (!element) { setError('No content to print.'); return; }

    setActiveMethod('print');

    try {
      const hasDevanagari = containsDevanagari(element.textContent);
      const printWindow = window.open('', '_blank', 'width=820,height=700');
      const printableClone = element.cloneNode(true);
      inlineComputedStyles(element, printableClone);
      printableClone.querySelectorAll('button').forEach((b) => b.remove());

      const fontStack = hasDevanagari
        ? '"Noto Sans Devanagari", "Times New Roman", Times, serif'
        : '"Times New Roman", Times, Georgia, serif';

      const printDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

      const htmlContent = `<!DOCTYPE html>
<html lang="${hasDevanagari ? 'mr' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${questionTitle || 'Document'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @page { size: A4; margin: 2cm; }

    body {
      font-family: ${fontStack};
      font-size: 13pt;
      line-height: 1.75;
      color: #444;
      background: #fff;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, h5, h6 {
      font-family: ${fontStack};
      font-weight: 700;
      page-break-after: avoid;
      break-after: avoid;
      page-break-inside: avoid;
      break-inside: avoid;
      orphans: 4; widows: 4;
      border-radius: 0 4pt 4pt 0;
    }
    h1 {
      font-size: 20pt; margin: 20pt 0 10pt;
      color: #1a3d2b; background: #e8f4ee;
      border-left: 5pt solid #1f6b5f;
      padding: 7pt 12pt;
    }
    h2 {
      font-size: 16pt; margin: 16pt 0 9pt;
      color: #1a3d2b; background: #eef7f2;
      border-left: 4pt solid #2d8c72;
      padding: 6pt 12pt;
    }
    h3 {
      font-size: 13pt; margin: 13pt 0 7pt;
      color: #1f3d30; background: #f3faf6;
      border-left: 3pt solid #4aab87;
      padding: 5pt 10pt;
    }
    h4 {
      font-size: 12pt; margin: 10pt 0 6pt;
      color: #2a4a38; background: #f7fcf9;
      border-left: 2pt solid #6bbfa0;
      padding: 4pt 10pt;
    }
    h5, h6 { font-size: 11pt; margin: 9pt 0 5pt; color: #444; padding: 3pt 8pt; }

    p {
      margin: 0 0 10pt;
      text-align: justify;
      text-justify: inter-word;
      line-height: 1.75;
      orphans: 4; widows: 4;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    ul, ol { margin: 8pt 0 12pt; padding-left: 22pt; }
    li {
      margin-bottom: 5pt;
      line-height: 1.7;
      page-break-inside: avoid;
      break-inside: avoid;
      orphans: 3; widows: 3;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14pt 0;
      font-size: 11pt;
      page-break-inside: auto;
      table-layout: fixed;
      word-wrap: break-word;
    }
    thead { display: table-header-group; background-color: #e8e8e8; }
    tbody { display: table-row-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th {
      border: 1px solid #999;
      padding: 8pt 7pt;
      font-weight: 700;
      text-align: left;
      background-color: #e8e8e8;
      color: #333;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      vertical-align: middle;
    }
    td {
      border: 1px solid #ccc;
      padding: 7pt 7pt;
      font-size: 11pt;
      line-height: 1.55;
      vertical-align: top;
      color: #444;
      word-break: break-word;
    }
    tbody tr:nth-child(even) td { background-color: #f9f9f9; }

    pre {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 3pt;
      padding: 10pt;
      font-family: "Courier New", Courier, monospace;
      font-size: 10pt;
      line-height: 1.5;
      margin: 10pt 0;
      page-break-inside: avoid;
      break-inside: avoid;
      white-space: pre-wrap;
      word-break: break-all;
    }
    code:not(pre code) {
      background: #f5f5f5;
      padding: 1pt 4pt;
      border-radius: 2pt;
      font-family: "Courier New", Courier, monospace;
      font-size: 10.5pt;
    }
    blockquote {
      border-left: 4px solid #666;
      padding: 10pt 14pt;
      margin: 12pt 0;
      background: #f9f9f9;
      font-style: italic;
      color: #444;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    strong, b { font-weight: 700; color: #333; }
    a { color: #0056b3; text-decoration: underline; }
    hr { border: none; border-top: 1px solid #ccc; margin: 18pt 0; }
    img { max-width: 100%; height: auto; page-break-inside: avoid; }

    /* ── Jurinex Analysis header ── */
    .jurinex-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10pt 0 10pt;
      margin-bottom: 18pt;
      border-bottom: 2pt solid #21C1B6;
    }
    .jurinex-header-left {
      display: flex;
      align-items: baseline;
      gap: 8pt;
    }
    .jurinex-logo {
      font-family: ${fontStack};
      font-size: 18pt;
      font-weight: 800;
      color: #21C1B6;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .jurinex-tag {
      font-family: ${fontStack};
      font-size: 10pt;
      font-weight: 600;
      color: #6b7280;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .jurinex-header-right {
      font-family: ${fontStack};
      font-size: 9pt;
      color: #9ca3af;
      text-align: right;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="jurinex-header">
    <div class="jurinex-header-left">
      <span class="jurinex-logo">JuriNex</span>
      <span class="jurinex-tag">Analysis</span>
    </div>
    <div class="jurinex-header-right">
      ${questionTitle ? `<div style="font-weight:600;color:#374151;font-size:10pt;">${questionTitle.substring(0, 60)}${questionTitle.length > 60 ? '…' : ''}</div>` : ''}
      <div>${printDate}</div>
    </div>
  </div>
  ${printableClone.innerHTML}
  <script>
    window.onload = function () {
      (document.fonts ? document.fonts.ready : Promise.resolve())
        .then(function () { setTimeout(window.print, 600); });
    };
  <\/script>
</body>
</html>`;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setSuccess('Print dialog opened!');
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Print failed: ${err.message}`);
      setTimeout(() => setError(null), 3000);
    }
  };

  return (
    <>
      <button
        onClick={generateCanvasPdf}
        disabled={isGenerating && activeMethod === 'canvas'}
        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Download as PDF"
      >
        {isGenerating && activeMethod === 'canvas' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>

      <button
        onClick={handleEnhancedPrint}
        disabled={isGenerating}
        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Print with professional formatting"
      >
        <Printer className="h-4 w-4" />
      </button>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          <div className="font-semibold mb-1">Error</div>
          <div className="text-xs">{error}</div>
        </div>
      )}

      {success && (
        <div className="fixed bottom-4 right-4 z-50 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          <div className="font-semibold mb-1">Success</div>
          <div className="text-xs">{success}</div>
        </div>
      )}
    </>
  );
};

export default DownloadPdf;
