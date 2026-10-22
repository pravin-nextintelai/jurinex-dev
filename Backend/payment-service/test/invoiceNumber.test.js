'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatInvoiceNumber, issuePurchaseInvoice } = require('../src/services/invoiceNumberService');

test('invoice number is company code, Indian financial year, and a 6-digit sequence', () => {
  assert.equal(formatInvoiceNumber('2026-27', 1, 'JNX'), 'JNX/2026-27/000001');
  assert.equal(formatInvoiceNumber('2026-27', 42, 'jnx'), 'JNX/2026-27/000042');
});

test('a purchase invoice is stored once and reused for the same source', async () => {
  const previousPrefix = process.env.APP_INVOICE_PREFIX;
  process.env.APP_INVOICE_PREFIX = 'JNX';
  const rows = [];
  let nextSeq = 0;
  const client = {
    async query(sql, params) {
      if (sql.startsWith('SELECT * FROM app_invoices WHERE source_kind')) {
        const found = rows.find((r) => r.source_kind === params[0] && r.source_id === params[1]);
        return { rows: found ? [found] : [] };
      }
      if (sql.startsWith('INSERT INTO app_invoice_sequences')) {
        nextSeq += 1;
        return { rows: [{ last_value: nextSeq }] };
      }
      if (sql.startsWith('INSERT INTO app_invoices')) {
        const row = {
          id: rows.length + 1,
          invoice_number: params[0],
          user_id: params[1],
          fiscal_year: params[2],
          sequence_no: params[3],
          source_kind: params[10],
          source_id: params[11],
        };
        rows.push(row);
        return { rows: [row] };
      }
      throw new Error(`unhandled ${sql.slice(0, 60)}`);
    },
  };

  const first = await issuePurchaseInvoice(client, {
    userId: 7, sourceKind: 'topup', sourceId: 15, currency: 'INR',
    basicPaise: 8475, cgstPaise: 763, sgstPaise: 762, igstPaise: 0, totalPaise: 10000,
    issuedAt: new Date('2026-10-15T10:00:00Z'),
  });
  const second = await issuePurchaseInvoice(client, {
    userId: 7, sourceKind: 'topup', sourceId: 15, currency: 'INR',
    basicPaise: 8475, totalPaise: 10000,
    issuedAt: new Date('2026-10-15T10:00:00Z'),
  });

  assert.equal(first.invoice_number, 'JNX/2026-27/000001');
  assert.equal(second.invoice_number, first.invoice_number);
  assert.equal(rows.length, 1);
  assert.equal(nextSeq, 1);
  if (previousPrefix === undefined) delete process.env.APP_INVOICE_PREFIX;
  else process.env.APP_INVOICE_PREFIX = previousPrefix;
});
