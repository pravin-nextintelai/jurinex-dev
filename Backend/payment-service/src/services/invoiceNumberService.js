'use strict';
/**
 * Professional invoice numbers, shared by plan purchases, token top-ups,
 * and storage add-ons so the sequence never repeats across email types.
 *
 * Format: {PREFIX}/{FY}/{SEQUENCE}
 *   JNX/2026-27/000001
 *   PREFIX    company code (APP_INVOICE_PREFIX, default JNX)
 *   FY        Indian financial year, April–March, Asia/Kolkata
 *   SEQUENCE  zero-padded, allocated from app_invoice_sequences
 */

function fiscalYearIST(date) {
  const ist = new Date(new Date(date || Date.now()).getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function invoicePrefix(explicit) {
  const raw = explicit || process.env.APP_INVOICE_PREFIX || 'JNX';
  const cleaned = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned || 'JNX';
}

function formatInvoiceNumber(fy, sequenceNo, prefix) {
  return `${invoicePrefix(prefix)}/${fy}/${String(sequenceNo).padStart(6, '0')}`;
}

async function allocateSequence(client, fy) {
  const seq = await client.query(
    `INSERT INTO app_invoice_sequences (fiscal_year, last_value) VALUES ($1, 1)
     ON CONFLICT (fiscal_year) DO UPDATE SET last_value = app_invoice_sequences.last_value + 1
     RETURNING last_value`,
    [fy]
  );
  return Number(seq.rows[0].last_value);
}

/**
 * Issue one invoice for a purchase that is not a payments row.
 * Idempotent on (source_kind, source_id). Must run inside the caller's transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ userId: number, sourceKind: string, sourceId: number, currency?: string,
 *   basicPaise: number, cgstPaise?: number, sgstPaise?: number, igstPaise?: number,
 *   totalPaise: number, issuedAt?: Date|string }} spec
 */
async function issuePurchaseInvoice(client, spec) {
  const sourceKind = String(spec.sourceKind || '').trim();
  const sourceId = Number(spec.sourceId);
  if (!sourceKind || !Number.isInteger(sourceId) || sourceId <= 0) {
    throw new Error('issuePurchaseInvoice requires sourceKind and sourceId');
  }

  const existing = await client.query(
    'SELECT * FROM app_invoices WHERE source_kind = $1 AND source_id = $2',
    [sourceKind, sourceId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const fy = fiscalYearIST(spec.issuedAt);
  const sequenceNo = await allocateSequence(client, fy);
  const invoiceNumber = formatInvoiceNumber(fy, sequenceNo);
  const ins = await client.query(
    `INSERT INTO app_invoices (
       invoice_number, invoice_kind, payment_id, user_id, fiscal_year, sequence_no, currency,
       basic_amount_paise, cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_amount_paise, issued_at,
       source_kind, source_id)
     VALUES ($1, 'application_generated', NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12)
     RETURNING *`,
    [
      invoiceNumber,
      spec.userId,
      fy,
      sequenceNo,
      spec.currency || 'INR',
      spec.basicPaise,
      spec.cgstPaise || 0,
      spec.sgstPaise || 0,
      spec.igstPaise || 0,
      spec.totalPaise,
      sourceKind,
      sourceId,
    ]
  );
  return ins.rows[0];
}

module.exports = {
  fiscalYearIST,
  invoicePrefix,
  formatInvoiceNumber,
  allocateSequence,
  issuePurchaseInvoice,
};
