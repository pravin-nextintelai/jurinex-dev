import { jsPDF } from 'jspdf';
import { toast } from 'react-toastify';
import { eventCite, phaseLabel, roleLabel, showDaySummary } from './chronologyDisplay';
import { datesFromStartToLast } from './chronologyOrder';

function safeFilename(name, suffix = 'chronology') {
  const base = String(name || 'case')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${base || 'case'}-${suffix}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PRINT_STYLES = `
  @page { margin: 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111827; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .date-block { margin: 0 0 18px; padding-left: 14px; border-left: 2px solid #21C1B6; page-break-inside: avoid; }
  .date { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .phase { font-size: 11px; color: #0f766e; text-transform: capitalize; }
  .summary { font-size: 13px; line-height: 1.5; margin: 6px 0; }
  .event-title { font-weight: 600; font-size: 13px; margin-top: 8px; }
  .event-body { font-size: 12px; line-height: 1.45; color: #374151; }
  .quote { font-size: 12px; font-style: italic; color: #4b5563; }
  .cite { font-size: 11px; color: #6b7280; }
`;

function buildPrintHtml(title, tree) {
  const dates = datesFromStartToLast(tree?.dates);
  const blocks = dates.map((node) => {
    const events = Array.isArray(node.events) ? node.events : [];
    const eventHtml = events.map((event) => {
      const cite = eventCite(event);
      const role = roleLabel(event.sourceRole);
      const flags = [event.disputed ? 'Disputed' : '', role].filter(Boolean).join(' · ');
      return `
      <div class="event-title">${escapeHtml(event.title)}${flags ? ` <span class="phase">(${escapeHtml(flags)})</span>` : ''}</div>
      ${event.particulars ? `<div class="event-body">${escapeHtml(event.particulars)}</div>` : ''}
      ${event.sourceQuote ? `<div class="quote">“${escapeHtml(event.sourceQuote)}”</div>` : ''}
      ${cite ? `<div class="cite">${escapeHtml(cite)}</div>` : ''}
    `;
    }).join('');
    return `
      <div class="date-block">
        <div class="date">${escapeHtml(node.displayDate || node.date)}
          <span class="phase"> · ${escapeHtml(phaseLabel(node.phase))}</span>
        </div>
        ${showDaySummary(node) ? `<div class="summary">${escapeHtml(node.summary)}</div>` : ''}
        ${eventHtml}
      </div>
    `;
  }).join('');

  const safe = escapeHtml(title);
  return `<!doctype html><html><head><title>${safe}</title><style>${PRINT_STYLES}</style></head>
    <body>
      <h1>Case chronology</h1>
      <p class="meta">${safe}</p>
      ${blocks}
    </body></html>`;
}

export function printChronology(title, tree) {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!popup) {
    toast.error('Allow pop-ups to print the chronology.');
    return;
  }
  popup.document.open();
  popup.document.write(buildPrintHtml(title, tree));
  popup.document.close();
  const triggerPrint = () => {
    if (popup.closed || popup.__chronologyPrinted) return;
    popup.__chronologyPrinted = true;
    popup.focus();
    popup.print();
  };
  popup.onload = triggerPrint;
  window.setTimeout(triggerPrint, 400);
  popup.onafterprint = () => {
    try {
      popup.close();
    } catch {
      /* ignore */
    }
  };
}

function writeWrapped(doc, text, x, y, maxWidth, lineHeight, fontSize = 11) {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottom = pageHeight - 16;
  let cursor = y;
  for (const line of lines) {
    if (cursor + lineHeight > bottom) {
      doc.addPage();
      cursor = 18;
    }
    doc.text(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

export function downloadChronologyPdf(title, tree) {
  const dates = datesFromStartToLast(tree?.dates);
  if (!dates.length) {
    toast.info('No chronology events to download.');
    return;
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - 32;
  let y = 20;

  doc.setFont('helvetica', 'bold');
  y = writeWrapped(doc, 'Case chronology', 16, y, maxWidth, 7, 16);
  doc.setFont('helvetica', 'normal');
  y = writeWrapped(doc, title, 16, y + 2, maxWidth, 5, 10);
  y += 6;

  dates.forEach((node) => {
    if (y > doc.internal.pageSize.getHeight() - 28) {
      doc.addPage();
      y = 18;
    }
    const heading = `${node.displayDate || node.date}  ·  ${phaseLabel(node.phase)}`;
    doc.setFont('helvetica', 'bold');
    y = writeWrapped(doc, heading, 16, y, maxWidth, 6, 12);
    doc.setFont('helvetica', 'normal');
    if (showDaySummary(node)) {
      y = writeWrapped(doc, node.summary, 16, y + 1, maxWidth, 5, 10);
    }
    (node.events || []).forEach((event) => {
      const flags = [event.disputed ? 'Disputed' : '', roleLabel(event.sourceRole)].filter(Boolean);
      const heading = flags.length ? `${event.title || 'Event'}  (${flags.join(' · ')})` : (event.title || 'Event');
      y = writeWrapped(doc, heading, 18, y + 3, maxWidth - 2, 5.5, 11);
      if (event.particulars) {
        y = writeWrapped(doc, event.particulars, 18, y + 0.5, maxWidth - 2, 5, 10);
      }
      if (event.sourceQuote) {
        doc.setFont('helvetica', 'italic');
        y = writeWrapped(doc, `"${event.sourceQuote}"`, 18, y + 0.5, maxWidth - 2, 5, 9);
        doc.setFont('helvetica', 'normal');
      }
      const cite = eventCite(event);
      if (cite) {
        y = writeWrapped(doc, cite, 18, y + 0.5, maxWidth - 2, 4.5, 8);
      }
    });
    y += 6;
  });

  doc.save(`${safeFilename(title)}.pdf`);
}

export { safeFilename };
