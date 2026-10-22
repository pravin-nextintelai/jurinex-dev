const nodemailer = require("nodemailer");
const { buildInvoicePdfBuffer, buildReceiptPdfBuffer } = require("./proformaPdf");

const transportConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const transporter = transportConfigured
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

function formatCurrency(amount, currency = "INR") {
  const numericAmount = Number(amount || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

function formatDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taxRowsHtml(tax, currency) {
  if (!tax || tax.totalPaise === undefined || tax.totalPaise === null) return "";
  const toR = (p) => formatCurrency(Number(p || 0) / 100, currency);
  const row = (label, value) =>
    `<div style="margin-top:6px;font-size:14px;color:#334155;"><strong>${label}:</strong> ${value}</div>`;
  let rows = row("Basic Amount", toR(tax.basicPaise));
  if (tax.taxType === "IGST") {
    rows += row(`IGST ${Number(tax.igstRate ?? 18)}%`, toR(tax.igstPaise));
  } else if (tax.taxType !== "NONE") {
    rows += row(`CGST ${Number(tax.cgstRate ?? 9)}%`, toR(tax.cgstPaise));
    rows += row(`SGST ${Number(tax.sgstRate ?? 9)}%`, toR(tax.sgstPaise));
  }
  rows += row("Total", toR(tax.totalPaise));
  return rows;
}

function buildMailHtml({
  customerName, planName, amount, currency, paymentId, orderId, purchaseDate, transactionType,
  tax, appInvoiceNumber, razorpayInvoiceNumber,
}) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,0.08);">
      <div style="height:6px;background:#21C1B6;"></div>
      <div style="padding:32px;">
        <div style="font-size:28px;font-weight:800;color:#0f172a;">Plan Purchase Confirmed</div>
        <div style="margin-top:10px;font-size:15px;line-height:1.7;color:#475569;">
          Hello ${customerName || "there"}, your ${transactionType || "plan purchase"} was completed successfully.
          Your invoice and payment receipt are attached for your records.
        </div>
        <div style="margin-top:24px;padding:20px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Purchase Summary</div>
          ${appInvoiceNumber ? `<div style="margin-top:14px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:#0f766e;">INVOICE NO</div><div style="margin-top:2px;font-size:22px;font-weight:800;color:#0f172a;">${appInvoiceNumber}</div>` : ""}
          <div style="margin-top:14px;font-size:20px;font-weight:800;color:#0f172a;">${planName || "Subscription Plan"}</div>
          <div style="margin-top:10px;font-size:14px;color:#334155;"><strong>Amount:</strong> ${formatCurrency(amount, currency)}</div>
          ${taxRowsHtml(tax, currency)}
          <div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Purchase Date:</strong> ${formatDate(purchaseDate)}</div>
          ${razorpayInvoiceNumber ? `<div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Razorpay Invoice No:</strong> ${razorpayInvoiceNumber}</div>` : ""}
          <div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Payment ID:</strong> ${paymentId || "N/A"}</div>
          <div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Order ID:</strong> ${orderId || "N/A"}</div>
        </div>
      </div>
      <div style="padding:18px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#64748b;">
        Need help with billing? Reply to this email or contact the JuriNex support team.
      </div>
    </div>
  </body>
</html>`;
}

async function sendPurchaseConfirmationEmail({
  to,
  customerName,
  customerEmail,
  planName,
  amount,
  currency,
  paymentId,
  orderId,
  purchaseDate,
  transactionType,
  paymentStatus,
  paymentMethod,
  tax,                     // { basicPaise, cgstRate, cgstPaise, sgstRate, sgstPaise, igstRate, igstPaise, totalPaise, taxType, basis }
  appInvoiceNumber,        // application-generated invoice number (app_invoices.invoice_number)
  razorpayInvoiceNumber,   // genuine Razorpay invoice number, when Razorpay created one
  receipt,
}) {
  if (!to) {
    console.warn("[PurchaseMail] skipped: missing recipient email");
    return null;
  }

  if (!transporter) {
    console.warn(
      "[PurchaseMail] skipped: set EMAIL_USER and EMAIL_PASS in payment-service/.env (e.g. Gmail app password) to send invoice/receipt emails"
    );
    return null;
  }

  const pdfParams = {
    customerName,
    customerEmail,
    planName,
    amount,
    paymentId,
    orderId,
    purchaseDate,
    paymentStatus,
    paymentMethod,
    tax,
    appInvoiceNumber,
    razorpayInvoiceNumber,
    receipt,
  };
  const [invoicePdf, receiptPdf] = await Promise.all([
    buildInvoicePdfBuffer(pdfParams),
    buildReceiptPdfBuffer({ ...pdfParams, transactionType }),
  ]);

  const invoiceFileName = appInvoiceNumber
    ? `invoice-${String(appInvoiceNumber).replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`
    : `invoice-${paymentId || orderId || Date.now()}.pdf`;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: appInvoiceNumber
      ? `JuriNex Invoice ${appInvoiceNumber}`
      : `JuriNex ${transactionType || "Plan Purchase"} Confirmation - ${planName || "Subscription Plan"}`,
    html: buildMailHtml({
      customerName,
      planName,
      amount,
      currency,
      paymentId,
      orderId,
      purchaseDate,
      transactionType,
      tax,
      appInvoiceNumber,
      razorpayInvoiceNumber,
    }),
    attachments: [
      {
        filename: invoiceFileName,
        content: invoicePdf,
        contentType: "application/pdf",
      },
      {
        filename: `receipt-${paymentId || orderId || Date.now()}.pdf`,
        content: receiptPdf,
        contentType: "application/pdf",
      },
    ],
  });

  console.log("[PurchaseMail] success", {
    to,
    messageId: info?.messageId || null,
    accepted: info?.accepted || [],
  });

  return info;
}

module.exports = {
  sendPurchaseConfirmationEmail,
};
