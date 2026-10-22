const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const HEADER_BLUE = "#5B9BD5";
const LOGO_PATH = path.join(__dirname, "../../assets/jurinex-logo.png");

const ones = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function convertBelowThousand(num) {
  if (!num) return "";
  if (num < 20) return ones[num];
  const t = Math.floor(num / 10);
  const o = num % 10;
  return tens[t] + (o ? ` ${ones[o]}` : "");
}

function convertHundreds(num) {
  if (!num) return "";
  if (num < 100) return convertBelowThousand(num);
  const h = Math.floor(num / 100);
  const rest = num % 100;
  return `${ones[h]} hundred${rest ? ` ${convertBelowThousand(rest)}` : ""}`;
}

function rupeesToWordsINR(amount) {
  const n = Math.round(Number(amount) * 100) / 100;
  let rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);

  if (rupees === 0 && paise === 0) return "ZERO RUPEES ONLY";

  const parts = [];
  const crores = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakhs = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousands = Math.floor(rupees / 1000);
  rupees %= 1000;

  if (crores) parts.push(`${convertHundreds(crores)} crore`);
  if (lakhs) parts.push(`${convertHundreds(lakhs)} lakh`);
  if (thousands) parts.push(`${convertHundreds(thousands)} thousand`);
  if (rupees) parts.push(convertHundreds(rupees));

  let words = `${parts.join(" ").replace(/\s+/g, " ").trim()} rupees`;
  if (paise > 0) words += ` and ${convertHundreds(paise)} paise`;
  words += " only";
  return words.toUpperCase();
}

function formatMoneyINR(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDateDDMMYYYY(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return "N/A";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function defaultCompanyLines() {
  return ["Digital legal technology platform", "India", "support@jurinex.com"];
}

/**
 * Resolve the tax lines to print. Prefers the stored breakdown (integer paise from the payments row);
 * falls back to the historical "18% inclusive split" only when no breakdown was supplied.
 */
function resolveTaxLines({ amount, tax }) {
  if (tax && tax.totalPaise !== undefined && tax.totalPaise !== null) {
    const toR = (p) => Number(p || 0) / 100;
    const type = tax.taxType || (Number(tax.igstPaise) > 0 ? "IGST" : "CGST_SGST");
    const lines = [];
    if (type === "CGST_SGST") {
      lines.push({ label: `CGST ${Number(tax.cgstRate ?? 9)}%`, rate: Number(tax.cgstRate ?? 9), amount: toR(tax.cgstPaise) });
      lines.push({ label: `SGST ${Number(tax.sgstRate ?? 9)}%`, rate: Number(tax.sgstRate ?? 9), amount: toR(tax.sgstPaise) });
    } else if (type === "IGST") {
      lines.push({ label: `IGST ${Number(tax.igstRate ?? 18)}%`, rate: Number(tax.igstRate ?? 18), amount: toR(tax.igstPaise) });
    }
    const totalTax = lines.reduce((s, l) => s + l.amount, 0);
    return {
      subTotal: toR(tax.basicPaise),
      gstRate: lines.reduce((s, l) => s + l.rate, 0),
      gstAmt: totalTax,
      grandTotal: toR(tax.totalPaise),
      lines,
      basisNote: tax.basis === "exclusive" ? "GST added on the plan price." : (type === "NONE" ? "No GST applied." : "Plan price is inclusive of GST."),
    };
  }
  const gstRate = 18;
  const total = Number(amount) || 0;
  const taxable = total > 0 ? total / (1 + gstRate / 100) : 0;
  const gstAmt = total - taxable;
  return {
    subTotal: taxable,
    gstRate,
    gstAmt,
    grandTotal: total,
    lines: [
      { label: "CGST 9%", rate: 9, amount: gstAmt / 2 },
      { label: "SGST 9%", rate: 9, amount: gstAmt / 2 },
    ],
    basisNote: "GST shown is indicative (18% inclusive split).",
  };
}

function renderProformaPdf(doc, {
  kind, customerName, customerEmail, planName, amount, paymentId, orderId, purchaseDate, paymentStatus,
  tax, appInvoiceNumber, razorpayInvoiceNumber, receipt, paymentMethod,
}) {
  const docTitle = kind === "invoice" ? "TAX INVOICE" : "PAYMENT RECEIPT";
  const detailHeader = kind === "invoice" ? "INVOICE DETAILS" : "RECEIPT DETAILS";
  const refLabel = kind === "invoice" ? "INVOICE NO" : "RECEIPT NO";
  // Invoice number: the application-generated number (app_invoices). Never derived from the payment id.
  const refValue =
    kind === "invoice"
      ? String(appInvoiceNumber || "N/A")
      : String(receipt || paymentId || "N/A");

  const { subTotal, gstRate, gstAmt, grandTotal, lines: taxLines, basisNote } = resolveTaxLines({ amount, tax });
  const dateStr = formatDateDDMMYYYY(purchaseDate);
  const status = paymentStatus || "captured";

  const margin = 40;
  const pageW = doc.page.width;
  const contentW = pageW - margin * 2;
  let y = margin;

  doc.save();
  doc.opacity(0.1).fontSize(72).fillColor("#cccccc").text("₹", margin, 320, { width: contentW, align: "center" });
  doc.restore();

  doc.fillColor(HEADER_BLUE).fontSize(18).font("Helvetica-Bold").text(docTitle, margin, y);
  y += 22;
  doc.strokeColor(HEADER_BLUE).lineWidth(2).moveTo(margin, y).lineTo(margin + contentW * 0.82, y).stroke();
  y += 14;

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, pageW - margin - 95, margin - 4, { width: 90 });
    } catch {
      /* ignore */
    }
  }

  const colW = contentW / 2 - 6;
  let yLeft = y;
  let yRight = y;
  doc.fillColor("#111111").fontSize(9).font("Helvetica-Bold").text("YOUR COMPANY NAME", margin, yLeft);
  doc.text("PARTY DETAIL'S", margin + colW + 12, yRight);
  yLeft += 12;
  yRight += 12;
  doc.font("Helvetica-Bold").fontSize(10).text(process.env.JURINEX_COMPANY_NAME || "JuriNex", margin, yLeft, { width: colW });
  doc.text(`CUSTOMER'S NAME: ${customerName || "Customer"}`, margin + colW + 12, yRight, { width: colW });
  yLeft += 14;
  yRight += 14;
  doc.font("Helvetica").fontSize(8.5);
  defaultCompanyLines().forEach((line) => {
    doc.text(line, margin, yLeft, { width: colW });
    yLeft += 11;
  });
  if (customerEmail) {
    doc.text(`EMAIL: ${customerEmail}`, margin + colW + 12, yRight, { width: colW });
    yRight += 11;
  }
  y = Math.max(yLeft, yRight) + 10;
  doc.font("Helvetica-Bold").fontSize(9).text(detailHeader, margin, y);
  doc.text("SHIPPING DETAILS", margin + colW + 12, y);
  y += 12;
  doc.font("Helvetica").fontSize(8);
  const leftBlock = [
    `${refLabel}: ${refValue}`,
    `DATE: ${dateStr}`,
    `ORDER ID: ${orderId || "N/A"}`,
    `PAYMENT ID: ${paymentId || "N/A"}`,
    ...(kind === "invoice" && receipt ? [`RECEIPT: ${receipt}`] : []),
    ...(razorpayInvoiceNumber ? [`RAZORPAY INVOICE NO: ${razorpayInvoiceNumber}`] : []),
    `STATUS: ${status}${paymentMethod ? ` (${paymentMethod})` : ""}`,
    ...(kind === "invoice" ? ["Application-generated invoice (JuriNex)"] : []),
  ];
  const rightBlock = ["STREET ADDRESS: —", "CITY / DIST / STATE / PIN: —", "PHONE NO: —"];
  let ly = y;
  leftBlock.forEach((line) => {
    doc.text(line, margin, ly, { width: colW });
    ly += 11;
  });
  let ry = y;
  rightBlock.forEach((line) => {
    doc.text(line, margin + colW + 12, ry, { width: colW });
    ry += 11;
  });
  y = Math.max(ly, ry) + 8;

  const tableTop = y;
  const colWidths = [140, 38, 32, 62, 48, 62, 68];
  const headers = ["ITEMS", "QTY", "UNIT", "PRICE/UNIT", "GST %", "GST AMT", "TOTAL"];
  let x = margin;
  doc.font("Helvetica-Bold").fontSize(7);
  headers.forEach((h, i) => {
    doc.rect(x, tableTop, colWidths[i], 18).stroke();
    doc.text(h, x + 3, tableTop + 5, { width: colWidths[i] - 6, align: "center" });
    x += colWidths[i];
  });
  y = tableTop + 18;
  x = margin;
  const rowH = 22;
  doc.font("Helvetica").fontSize(7);
  const cells = [
    planName || "Subscription Plan",
    "1",
    "—",
    formatMoneyINR(subTotal),
    String(gstRate),
    formatMoneyINR(gstAmt),
    formatMoneyINR(grandTotal),
  ];
  const aligns = ["left", "center", "center", "right", "center", "right", "right"];
  cells.forEach((text, i) => {
    doc.rect(x, y, colWidths[i], rowH).stroke();
    doc.text(String(text), x + 3, y + 6, {
      width: colWidths[i] - 6,
      align: aligns[i],
    });
    x += colWidths[i];
  });
  y += rowH + 10;

  doc.font("Helvetica-Bold").fontSize(8).text("TOTAL QUANTITY : 1", margin, y);
  y += 12;
  const words = rupeesToWordsINR(grandTotal);
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .text("AMOUNT IN WORDS : ", margin, y, { continued: true })
    .font("Helvetica-Bold")
    .text(words, { width: contentW * 0.52 });

  const boxX = margin + contentW * 0.54;
  const boxW = contentW * 0.46;
  let by = y - 12;
  const summary = [
    ["BASIC AMOUNT", `₹ ${formatMoneyINR(subTotal)}`],
    ...taxLines.map((l) => [l.label.toUpperCase(), `₹ ${formatMoneyINR(l.amount)}`]),
    ["GRAND TOTAL", `₹ ${formatMoneyINR(grandTotal)}`],
  ];
  summary.forEach(([k, v], idx) => {
    const isTotal = idx === summary.length - 1;
    const h = isTotal ? 20 : 14;
    doc.rect(boxX, by, boxW * 0.52, h).stroke();
    doc.rect(boxX + boxW * 0.52, by, boxW * 0.48, h).stroke();
    doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 9 : 8);
    doc.text(k, boxX + 4, by + 3, { width: boxW * 0.5 });
    doc.text(v, boxX + boxW * 0.52 + 4, by + 3, { width: boxW * 0.44, align: "right" });
    by += h;
  });

  y = by + 14;
  const boxH = 52;
  doc.rect(margin, y, contentW * 0.48, boxH).stroke();
  doc.rect(margin + contentW * 0.52, y, contentW * 0.48, boxH).stroke();
  doc.font("Helvetica-Bold").fontSize(8).text("TERMS & CONDITIONS :", margin + 4, y + 4);
  doc
    .font("Helvetica")
    .fontSize(7)
    .text(
      `Payment processed digitally. For billing queries, contact JuriNex support. ${basisNote}`,
      margin + 4,
      y + 16,
      { width: contentW * 0.48 - 8 }
    );
  doc.font("Helvetica-Bold").text("SEAL & SIGNATURE", margin + contentW * 0.52, y + 18, {
    width: contentW * 0.48,
    align: "center",
  });
  y += boxH + 12;

  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor("#333333")
    .text("Thanks for doing business with us. Please visit us again !!!", margin, y, { width: contentW, align: "center" });
  y += 22;
  doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor("#999999").lineWidth(0.5).stroke();
  y += 8;
  doc.font("Helvetica").fontSize(7).fillColor("#555555");
  const disc = kind === "invoice" ? "invoice" : "receipt";
  doc.text(
    `DISCLAIMER : This is a computer generated ${disc}. The amount shown is digitally calculated.`,
    margin,
    y,
    { width: contentW }
  );
  y += 16;
  doc.fontSize(7).fillColor("#666666").text("Powered by", margin + contentW - 118, y, { lineBreak: false });
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, margin + contentW - 62, y - 4, { width: 58 });
    } catch {
      /* ignore */
    }
  }
}

function pdfToBuffer(drawFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawFn(doc);
    } catch (e) {
      reject(e);
      return;
    }
    doc.end();
  });
}

function commonParams(params) {
  return {
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    planName: params.planName,
    amount: params.amount,
    paymentId: params.paymentId,
    orderId: params.orderId,
    purchaseDate: params.purchaseDate,
    paymentStatus: params.paymentStatus || "captured",
    paymentMethod: params.paymentMethod,
    tax: params.tax || null,
    appInvoiceNumber: params.appInvoiceNumber || null,
    razorpayInvoiceNumber: params.razorpayInvoiceNumber || null,
    receipt: params.receipt || null,
  };
}

function buildInvoicePdfBuffer(params) {
  return pdfToBuffer((doc) => renderProformaPdf(doc, { kind: "invoice", ...commonParams(params) }));
}

function buildReceiptPdfBuffer(params) {
  return pdfToBuffer((doc) => renderProformaPdf(doc, { kind: "receipt", ...commonParams(params) }));
}

module.exports = {
  buildInvoicePdfBuffer,
  buildReceiptPdfBuffer,
  resolveTaxLines,
};
