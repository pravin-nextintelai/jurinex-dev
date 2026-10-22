/**
 * Real .docx export using the `docx` library.
 *
 * Architecture:
 *   branding profile JSON
 *     ↓
 *   Word Header   (logo + firm details table + accent rule + optional doc-header line)
 *   Word Footer   (page numbers + optional custom footer text)
 *   Watermark     (Phase 1: large gray text in header — Phase 2 VML can replace later)
 *   Body          (HTML content → docx paragraphs/tables)
 *     ↓
 *   Real .docx blob  (application/vnd.openxmlformats-officedocument.wordprocessingml.document)
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  NumberFormat,
  Numbering,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
  convertToXmlComponent,
} from 'docx';
import { normalizeBrandingProfile, logBrandingExport } from './brandingProfileDefaults';
import { hexToDocxColor } from './brandingColorUtils';
import { brandingDocxLineSpacing, brandingHeadingPt, getBrandingBodyTypography } from './brandingTypography';
import { xml2js } from 'xml-js';

// ── Unit helpers ──────────────────────────────────────────────────────────────

const mmToTwip = (mm) => Math.round(convertMillimetersToTwip(Number(mm) || 0));
// docx uses half-points for font sizes (24 = 12pt)
const ptToHp = (pt) => Math.round((Number(pt) || 12) * 2);

// Page sizes in twips (1 inch = 1440 twips, 1mm ≈ 56.69 twips)
const PAGE_TWIP = {
  a4:     { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
  legal:  { width: 12240, height: 20160 },
};

// ── Logo buffer ───────────────────────────────────────────────────────────────

async function fetchLogoBuffer(src) {
  if (!src) return null;
  try {
    if (src.startsWith('data:')) {
      const b64 = src.split(',')[1];
      if (!b64) return null;
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf;
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function logoMimeToDocxType(src) {
  if (!src) return 'png';
  if (src.includes('data:image/jpeg') || src.includes('data:image/jpg') || /\.jpe?g/i.test(src)) return 'jpg';
  if (src.includes('data:image/gif') || /\.gif/i.test(src)) return 'gif';
  if (src.includes('data:image/bmp') || /\.bmp/i.test(src)) return 'bmp';
  return 'png';
}

// ── Border helpers ────────────────────────────────────────────────────────────

function noBorders() {
  const side = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side };
}

function cellBorder(colorHex) {
  const side = { style: BorderStyle.SINGLE, size: 4, color: colorHex.replace('#', '') };
  return { top: side, bottom: side, left: side, right: side };
}

// ── Alignment ─────────────────────────────────────────────────────────────────

function docxAlign(value) {
  if (value === 'left') return AlignmentType.LEFT;
  if (value === 'right') return AlignmentType.RIGHT;
  return AlignmentType.CENTER;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Returns an ImportedXmlComponent for a diagonal watermark using Word's native
// VML WordArt format (v:shape + v:textpath) — the same markup Word itself
// writes for Design → Watermark. DrawingML shape rotation is ignored by several
// viewers; the VML form renders rotated everywhere (Word, LibreOffice, Google Docs).
function buildWatermarkComponent(p) {
  const wmText = String(p.watermarkText || '').trim();
  if (!wmText) return null;

  // SVG preview uses fill="black" fill-opacity=X on white background.
  // Equivalent solid color on white: gray = 255 * (1 - opacity)
  const opacity = p.watermarkOpacity ?? 0.12;
  const grayVal = Math.max(10, Math.min(254, Math.round(255 * (1 - opacity))));
  const gHex = grayVal.toString(16).padStart(2, '0');
  const wmColor = `#${gHex}${gHex}${gHex}`;

  // VML rotation: degrees clockwise in [0, 360). Profile -45 (up-to-the-right
  // diagonal, same as the SVG preview) maps to Word's classic rotation:315.
  const rotation = Number(p.watermarkAngle ?? p.watermarkRotation ?? -45);
  const vmlRot = ((Math.round(rotation) % 360) + 360) % 360;

  // v:textpath scales text to fill the shape, so the shape box must be derived
  // from the profile font size for parity with the PDF/preview watermark:
  // width ≈ chars × fontSize × 0.62 (Arial bold), height ≈ fontSize × 1.4.
  const wmFontSizePt = Number(p.watermarkFontSize) || 72;
  const shapeW = Math.round(Math.max(60, wmText.length * wmFontSizePt * 0.62) * 100) / 100;
  const shapeH = Math.round(wmFontSizePt * 1.4 * 100) / 100;

  const wmSafe = escapeXml(wmText);

  const xml = `<w:p
    xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:v="urn:schemas-microsoft-com:vml"
    xmlns:o="urn:schemas-microsoft-com:office:office">
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <w:pict>
        <v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">
          <v:formulas>
            <v:f eqn="sum #0 0 10800"/>
            <v:f eqn="prod #0 2 1"/>
            <v:f eqn="sum 21600 0 @1"/>
            <v:f eqn="sum 0 0 @2"/>
            <v:f eqn="sum 21600 0 @3"/>
            <v:f eqn="if @0 @3 0"/>
            <v:f eqn="if @0 21600 @1"/>
            <v:f eqn="if @0 0 @2"/>
            <v:f eqn="if @0 @4 21600"/>
            <v:f eqn="mid @5 @6"/>
            <v:f eqn="mid @8 @5"/>
            <v:f eqn="mid @7 @8"/>
            <v:f eqn="mid @6 @7"/>
            <v:f eqn="sum @6 0 @5"/>
          </v:formulas>
          <v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/>
          <v:textpath on="t" fitshape="t"/>
          <v:handles>
            <v:h position="#0,bottomRight" xrange="6629,14971"/>
          </v:handles>
          <o:lock v:ext="edit" text="t" shapetype="t"/>
        </v:shapetype>
        <v:shape id="JuriNexWatermark" o:spid="_x0000_s2049" type="#_x0000_t136"
          style="position:absolute;margin-left:0;margin-top:0;width:${shapeW}pt;height:${shapeH}pt;rotation:${vmlRot};z-index:-251656192;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin"
          o:allowincell="f" fillcolor="${wmColor}" stroked="f">
          <v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt" string="${wmSafe}"/>
        </v:shape>
      </w:pict>
    </w:r>
  </w:p>`;

  try {
    // convertToXmlComponent expects a parsed element object (xml-js format), not a raw string
    const parsed = xml2js(xml, { compact: false });
    return convertToXmlComponent(parsed.elements[0]);
  } catch {
    return null;
  }
}

// ── Word Header builder ───────────────────────────────────────────────────────

// Default printable width: A4 minus 20 mm margins each side.
const DEFAULT_CONTENT_TWIP = 11906 - 2 * mmToTwip(20);

function buildHeader(p, logoBuffer, { forPdf = false, contentWidthTwip = DEFAULT_CONTENT_TWIP } = {}) {
  const ff = p.fontFamily || 'Times New Roman';
  const logoPos = p.logoPosition || 'right';
  const align = docxAlign(p.letterheadAlignment);
  const logoW = Math.max(20, Math.round(Number(p.logoWidth) || 80));
  const logoH = Math.max(20, Math.round(Number(p.logoHeight) || 80));
  const imgType = logoMimeToDocxType(p.logo);
  const firmC = hexToDocxColor(p.firmNameColor);
  const tagC = hexToDocxColor(p.taglineColor);
  const metaC = hexToDocxColor(p.metaColor);
  const hdrC = hexToDocxColor(p.headerColor);

  const firmLine = [p.firmName, p.advocateName].filter(Boolean).join(' · ');
  const contact  = [p.phone, p.email].filter(Boolean).join(' · ');

  // ── Firm details cell ──
  const detailParas = [];
  if (firmLine) detailParas.push(new Paragraph({
    alignment: align,
    spacing: { after: 40 },
    children: [new TextRun({ text: firmLine, bold: true, size: ptToHp(p.firmNameFontSize ?? 16), font: ff, color: firmC })],
  }));
  if (p.tagline) detailParas.push(new Paragraph({
    alignment: align, spacing: { after: 20 },
    children: [new TextRun({ text: p.tagline, size: ptToHp(p.taglineFontSize ?? 9), font: ff, color: tagC })],
  }));
  if (p.barCouncilNo) detailParas.push(new Paragraph({
    alignment: align, spacing: { after: 20 },
    children: [new TextRun({ text: `Bar Council No: ${p.barCouncilNo}`, size: ptToHp(p.metaFontSize ?? 8.5), font: ff, color: metaC })],
  }));
  if (p.officeAddress) detailParas.push(new Paragraph({
    alignment: align, spacing: { after: 20 },
    children: [new TextRun({ text: p.officeAddress, size: ptToHp(p.metaFontSize ?? 8.5), font: ff, color: metaC })],
  }));
  if (contact) detailParas.push(new Paragraph({
    alignment: align, spacing: { after: 0 },
    children: [new TextRun({ text: contact, size: ptToHp(p.metaFontSize ?? 8.5), font: ff, color: metaC })],
  }));
  if (!detailParas.length) detailParas.push(new Paragraph({ children: [] }));

  // ── Logo paragraph ──
  const makeLogoPara = (logoAlign) => logoBuffer
    ? new Paragraph({
        alignment: logoAlign,
        children: [new ImageRun({ data: logoBuffer, transformation: { width: logoW, height: logoH }, type: imgType })],
      })
    : new Paragraph({ children: [] });

  // Explicit twip (DXA) widths + fixed layout: percentage cell widths serialize
  // as non-conformant `w:w="25%"` with a 100-twip fallback grid, which collapses
  // the letterhead columns in LibreOffice / Google Docs / docx viewers.
  const logoColTwip = Math.round(contentWidthTwip * 0.25);
  const textColTwip = contentWidthTwip - logoColTwip;
  const makeCell = (widthTwip, children, vAlign = VerticalAlign.TOP) =>
    new TableCell({ width: { size: widthTwip, type: WidthType.DXA }, borders: noBorders(), verticalAlign: vAlign, children });

  let rows;
  let columnWidths;

  if (logoPos === 'center') {
    // Logo above firm details, all centered in one wide cell
    columnWidths = [contentWidthTwip];
    rows = [new TableRow({
      children: [makeCell(contentWidthTwip, [
        ...(logoBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: logoBuffer, transformation: { width: logoW, height: logoH }, type: imgType })] })] : []),
        ...detailParas,
      ])],
    })];
  } else if (logoPos === 'left') {
    columnWidths = [logoColTwip, textColTwip];
    rows = [new TableRow({
      children: [
        makeCell(logoColTwip, [makeLogoPara(AlignmentType.LEFT)]),
        makeCell(textColTwip, detailParas),
      ],
    })];
  } else {
    // right (default)
    columnWidths = [textColTwip, logoColTwip];
    rows = [new TableRow({
      children: [
        makeCell(textColTwip, detailParas),
        makeCell(logoColTwip, [makeLogoPara(AlignmentType.RIGHT)]),
      ],
    })];
  }

  const headerTable = new Table({
    width: { size: contentWidthTwip, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: noBorders(),
    rows,
  });

  const headerChildren = [headerTable];

  // Accent divider
  if (p.showDivider !== false) {
    const hex = (p.primaryColor || '#20b2aa').replace('#', '');
    headerChildren.push(new Paragraph({
      border: { bottom: { color: hex, space: 1, style: BorderStyle.SINGLE, size: 12 } },
      spacing: { before: 80, after: 60 },
      children: [],
    }));
  }

  // Optional document header text
  if (p.headerEnabled && String(p.headerText || '').trim()) {
    headerChildren.push(new Paragraph({
      alignment: docxAlign(p.headerAlignment),
      spacing: { before: 60, after: 40 },
      children: [new TextRun({ text: p.headerText, bold: true, size: ptToHp(p.headerFontSize || 12), font: ff, color: hdrC })],
    }));
  }

  // DrawingML watermark breaks docx-preview → PDF (renders as a dark rectangle). Word keeps it.
  if (!forPdf && p.watermark && String(p.watermarkText || '').trim()) {
    const wmComp = buildWatermarkComponent(p);
    if (wmComp) headerChildren.push(wmComp);
  }

  return new Header({ children: headerChildren });
}

// ── Word Footer builder ───────────────────────────────────────────────────────

function buildFooter(p) {
  const ff = p.fontFamily || 'Times New Roman';
  const fAlign = p.footerPosition === 'bottom-left'
    ? AlignmentType.LEFT
    : p.footerPosition === 'bottom-right'
      ? AlignmentType.RIGHT
      : AlignmentType.CENTER;
  const fSize = ptToHp(p.footerFontSize || 9);
  const footC = hexToDocxColor(p.footerColor);
  const children = [];

  if (p.footerText) {
    children.push(new Paragraph({
      alignment: fAlign,
      spacing: { before: 40, after: 20 },
      children: [new TextRun({ text: p.footerText, bold: true, size: fSize, font: ff, color: footC })],
    }));
  }

  if (p.footerEnabled) {
    children.push(new Paragraph({
      alignment: fAlign,
      spacing: { before: 20, after: 0 },
      children: [
        new TextRun({ text: 'Page ', size: fSize, font: ff, color: footC }),
        new TextRun({ children: [PageNumber.CURRENT], size: fSize, font: ff, color: footC }),
        new TextRun({ text: ' of ', size: fSize, font: ff, color: footC }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: fSize, font: ff, color: footC }),
      ],
    }));
  }

  if (!children.length) children.push(new Paragraph({ children: [] }));
  return new Footer({ children });
}

// ── HTML → docx paragraph converter ──────────────────────────────────────────

function hexColor(cssColor) {
  if (!cssColor) return undefined;
  const c = String(cssColor).trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
  return undefined;
}

function collectInlineRuns(node, inherited = {}) {
  const runs = [];
  if (!node) return runs;

  if (node.nodeType === 3) {
    const text = node.textContent || '';
    if (text) runs.push(new TextRun({ text, ...inherited }));
    return runs;
  }

  if (node.nodeType !== 1) return runs;

  const tag = node.tagName.toLowerCase();
  const props = { ...inherited };

  if (tag === 'strong' || tag === 'b') props.bold = true;
  if (tag === 'em' || tag === 'i') props.italics = true;
  if (tag === 'u') props.underline = { type: UnderlineType.SINGLE };
  if (tag === 's' || tag === 'del') props.strike = true;
  if (tag === 'code') props.font = 'Courier New';
  if (tag === 'br') {
    runs.push(new TextRun({ text: '', break: 1, ...inherited }));
    return runs;
  }
  if (tag === 'a') {
    // keep text, drop link for simplicity
    for (const child of node.childNodes) runs.push(...collectInlineRuns(child, props));
    return runs;
  }
  // skip block-level children rendered as inline (div, p, span treated as inline here)
  for (const child of node.childNodes) runs.push(...collectInlineRuns(child, props));
  return runs;
}

function bodyParagraphSpacing(listTrackers) {
  const line = listTrackers?.lineSpacing ?? 360;
  return { after: 120, line, lineRule: LineRuleType.AUTO };
}

function nodeToDocxItems(node, items, ff, fontSize, listTrackers) {
  if (!node) return;
  const bodyColor = listTrackers?.bodyColor || '000000';
  const baseRun = { font: ff, size: ptToHp(fontSize), color: bodyColor };
  const paraSpacing = () => bodyParagraphSpacing(listTrackers);

  if (node.nodeType === 3) {
    const text = (node.textContent || '').trim();
    if (text) items.push(new Paragraph({ spacing: paraSpacing(), children: [new TextRun({ text, ...baseRun })] }));
    return;
  }
  if (node.nodeType !== 1) return;

  const tag = node.tagName.toLowerCase();

  // ── Block elements ──────────────────────────────────────────────────────────
  if (tag === 'p') {
    const runs = [];
    for (const child of node.childNodes) runs.push(...collectInlineRuns(child, { ...baseRun }));
    if (runs.length) {
      items.push(new Paragraph({ spacing: paraSpacing(), children: runs }));
    } else {
      items.push(new Paragraph({ spacing: { after: 60, line: listTrackers?.lineSpacing ?? 360, lineRule: LineRuleType.AUTO }, children: [] }));
    }
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const hPt = listTrackers?.headingPt?.(level) ?? fontSize;
    const runs = [];
    for (const child of node.childNodes) {
      runs.push(...collectInlineRuns(child, { ...baseRun, bold: true, size: ptToHp(hPt) }));
    }
    const headingLevel = [
      HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
    ][level - 1];
    items.push(new Paragraph({
      heading: headingLevel,
      spacing: { before: 200, after: 100 },
      children: runs.length ? runs : [new TextRun({ text: node.textContent, bold: true, font: ff, size: ptToHp(hPt), color: bodyColor })],
    }));
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    const isOrdered = tag === 'ol';
    let idx = 1;
    for (const li of node.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const runs = [];
      for (const child of li.childNodes) {
        // Nested lists are emitted as their own paragraphs below.
        if (child.nodeType === 1 && /^(ul|ol)$/.test(child.tagName.toLowerCase())) continue;
        // Loose list items wrap their text in <p> (ReactMarkdown) — inline it,
        // separating successive blocks with a line break.
        const isBlock = child.nodeType === 1 && /^(p|div|h[1-6])$/.test(child.tagName.toLowerCase());
        if (isBlock && runs.length) runs.push(new TextRun({ text: '', break: 1, ...baseRun }));
        runs.push(...collectInlineRuns(child, { ...baseRun }));
      }
      const bullet = isOrdered ? `${idx++}.  ` : '•  ';
      items.push(new Paragraph({
        spacing: { after: 60, line: listTrackers?.lineSpacing ?? 360, lineRule: LineRuleType.AUTO },
        indent: { left: 360, hanging: 360 },
        children: [
          new TextRun({ text: bullet, font: ff, size: ptToHp(fontSize), bold: isOrdered }),
          ...runs,
        ],
      }));
      // recurse into nested lists inside li
      for (const child of li.childNodes) {
        if (child.nodeType === 1 && /^(ul|ol)$/.test(child.tagName.toLowerCase())) {
          nodeToDocxItems(child, items, ff, fontSize, listTrackers);
        }
      }
    }
    return;
  }

  if (tag === 'blockquote') {
    for (const child of node.childNodes) {
      const innerItems = [];
      nodeToDocxItems(child, innerItems, ff, fontSize, listTrackers);
      for (const item of innerItems) {
        if (item instanceof Paragraph) {
          items.push(new Paragraph({
            spacing: { after: 80 },
            indent: { left: 480 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: '3B82F6', space: 8 } },
            children: item.root?.children?.[0]?.children ?? [new TextRun({ text: node.textContent, italics: true, color: '4b5563', font: ff, size: ptToHp(fontSize) })],
          }));
        } else {
          items.push(item);
        }
      }
    }
    return;
  }

  if (tag === 'pre') {
    const text = node.textContent || '';
    for (const line of text.split('\n')) {
      items.push(new Paragraph({
        spacing: { after: 0 },
        shading: { type: 'clear', fill: '1F2937' },
        children: [new TextRun({ text: line || ' ', font: 'Courier New', size: ptToHp(9), color: 'F9FAFB' })],
      }));
    }
    items.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    return;
  }

  if (tag === 'table') {
    const docxRows = [];
    const trs = Array.from(node.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'));
    const tableWidthTwip = listTrackers?.contentWidthTwip || DEFAULT_CONTENT_TWIP;
    const nCols = Math.max(1, ...trs.map((tr) =>
      Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName)).length));
    const colTwip = Math.floor(tableWidthTwip / nCols);
    for (const tr of trs) {
      const docxCells = [];
      for (const cell of tr.children) {
        const cellTag = cell.tagName.toLowerCase();
        if (cellTag !== 'td' && cellTag !== 'th') continue;
        const isHeader = cellTag === 'th';
        const cellRuns = [];
        for (const child of cell.childNodes) {
          cellRuns.push(...collectInlineRuns(child, {
            font: ff,
            size: ptToHp(isHeader ? Math.max(8, fontSize - 1) : fontSize),
            bold: isHeader,
            color: bodyColor,
          }));
        }
        docxCells.push(new TableCell({
          width: { size: colTwip, type: WidthType.DXA },
          shading: isHeader ? { type: 'clear', fill: 'F3F4F6' } : undefined,
          borders: cellBorder('D1D5DB'),
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({
            spacing: { after: 40 },
            children: cellRuns.length ? cellRuns : [new TextRun('')],
          })],
        }));
      }
      if (docxCells.length) docxRows.push(new TableRow({ children: docxCells }));
    }
    if (docxRows.length) {
      items.push(new Table({
        width: { size: tableWidthTwip, type: WidthType.DXA },
        columnWidths: Array(nCols).fill(colTwip),
        layout: TableLayoutType.FIXED,
        rows: docxRows,
      }));
      items.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
    return;
  }

  if (tag === 'hr') {
    items.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB', space: 1 } },
      spacing: { before: 120, after: 120 },
      children: [],
    }));
    return;
  }

  if (tag === 'br') {
    items.push(new Paragraph({ spacing: { after: 0 }, children: [] }));
    return;
  }

  // div / span / section / article → recurse into children
  if (['div', 'span', 'section', 'article', 'main', 'aside'].includes(tag)) {
    for (const child of node.childNodes) nodeToDocxItems(child, items, ff, fontSize, listTrackers);
    return;
  }

  // Fallback: paragraph from text content
  const text = node.textContent?.trim();
  if (text) items.push(new Paragraph({
    spacing: bodyParagraphSpacing(listTrackers),
    children: [new TextRun({ text, font: ff, size: ptToHp(fontSize), color: bodyColor })],
  }));
}

function htmlToDocxParagraphs(html, profile, contentWidthTwip = DEFAULT_CONTENT_TWIP) {
  if (!html || !html.trim()) return [new Paragraph({ children: [] })];

  const p = normalizeBrandingProfile(profile);
  const { fontFamily: ff, fontSizePt: fontSize, bodyColor: bodyHex } = getBrandingBodyTypography(p);
  const bodyC = hexToDocxColor(bodyHex);
  const lineSpacing = brandingDocxLineSpacing(p);
  const headingPt = (level) => brandingHeadingPt(p, level);

  const div = document.createElement('div');
  div.innerHTML = html;

  const items = [];
  const trackers = { bodyColor: bodyC, lineSpacing, headingPt, contentWidthTwip };
  for (const child of div.childNodes) {
    nodeToDocxItems(child, items, ff, fontSize, trackers);
  }
  return items.length ? items : [new Paragraph({ children: [] })];
}

// ── Compute body top margin that safely clears the letterhead in the header ───

function computeBodyTopMm(p) {
  // The DOCX header region spans from HEADER_EDGE_MM to bodyTopMm from the page top.
  // We estimate the letterhead height and ensure the body never overlaps it.
  const HEADER_EDGE_MM = 12; // header content starts 12 mm from page top

  let lhMm = 2; // base buffer

  if (p.logo) {
    // ImageRun uses px at 96 dpi; convert to mm (25.4 mm/in ÷ 96 px/in)
    lhMm += Math.max(15, (Number(p.logoHeight) || 80) * (25.4 / 96));
  }

  const textLines = [
    p.firmName || p.advocateName,
    p.tagline,
    p.barCouncilNo,
    p.officeAddress,
    p.phone || p.email,
  ].filter(Boolean).length;

  if (textLines > 0) {
    lhMm += 6.5;                      // firm-name line at 16 pt ≈ 5.6 mm + spacing
    lhMm += (textLines - 1) * 4;      // remaining lines at ~9 pt + spacing
  }

  if (p.showDivider !== false) lhMm += 4;

  if (p.headerEnabled && String(p.headerText || '').trim()) {
    lhMm += ((p.headerFontSize || 12) * 0.353) + 4; // pt→mm + gap
  }

  return Math.max(p.marginTop ?? 25, HEADER_EDGE_MM + lhMm + 5); // 5 mm gap before body
}

// ── Main export ───────────────────────────────────────────────────────────────

/** Build the same .docx blob used for Word download (shared with PDF-via-docx path). */
export async function buildBrandedDocxBlob(profile, contentHtml, { forPdf = false } = {}) {
  const p = normalizeBrandingProfile(profile);
  const logoBuffer = await fetchLogoBuffer(p.logo || '');

  const pageSize = PAGE_TWIP[p.pageSize || 'a4'] || PAGE_TWIP.a4;
  const isLandscape = p.orientation === 'landscape';
  const pageWidth  = isLandscape ? pageSize.height : pageSize.width;
  const pageHeight = isLandscape ? pageSize.width  : pageSize.height;

  const contentWidthTwip = pageWidth - mmToTwip(p.marginLeft ?? 20) - mmToTwip(p.marginRight ?? 20);
  const contentItems = htmlToDocxParagraphs(contentHtml || '', p, contentWidthTwip);
  const bodyTopMm = computeBodyTopMm(p);

  const doc = new Document({
    numbering: { config: [] },
    sections: [{
      properties: {
        page: {
          size: { width: pageWidth, height: pageHeight, orientation: isLandscape ? 'landscape' : 'portrait' },
          margin: {
            top:    mmToTwip(bodyTopMm),
            right:  mmToTwip(p.marginRight ?? 20),
            bottom: mmToTwip(p.marginBottom ?? 20),
            left:   mmToTwip(p.marginLeft ?? 20),
            header: mmToTwip(12),
            footer: mmToTwip(10),
          },
        },
      },
      headers: { default: buildHeader(p, logoBuffer, { forPdf, contentWidthTwip }) },
      footers: { default: buildFooter(p) },
      children: contentItems,
    }],
  });

  return Packer.toBlob(doc);
}

export async function downloadBrandedDocx({ profile, contentHtml, filename = 'branded-document.docx', module: mod = 'unknown' }) {
  const p = normalizeBrandingProfile(profile);
  const blob = await buildBrandedDocxBlob(p, contentHtml);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : filename.replace(/\.doc$/, '.docx');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logBrandingExport({ module: mod, exportType: 'word', profile: p, engine: 'docx-lib', success: true });
}

export async function downloadBrandingProfilePreviewDocx(profile, filename) {
  const p = normalizeBrandingProfile(profile);
  const { buildPreviewSampleContentHtml } = await import('./brandingTemplate');
  await downloadBrandedDocx({
    profile: p,
    contentHtml: buildPreviewSampleContentHtml(p),
    filename: filename || 'branding-preview.docx',
    module: 'branding-editor-preview',
  });
}
