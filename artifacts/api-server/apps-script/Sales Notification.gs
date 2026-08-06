/**
 * Nemat / TTD Admin Sheet — new-order notification email.
 *
 * A STANDALONE module. Apps Script shares one global scope across every .gs file
 * in a project, so everything here is uniquely named and this file declares no
 * SECRET / HEADERS / doPost of its own — it can sit alongside the existing files
 * without colliding.
 *
 * WIRING (one edit, in whichever file defines `function doPost(e)`):
 *   Immediately after the `sheet.appendRow(body.row)` line, add:
 *
 *     if (body.tab === 'Orders') {
 *       try {
 *         sendOrderNotification(body.row);
 *       } catch (mailErr) {
 *         console.error('order notification failed: ' + mailErr);
 *       }
 *     }
 *
 *   It must go AFTER the dedupe early-return, so webhook retries and backfills
 *   don't re-notify. Its own try/catch keeps a mail failure from turning a
 *   successful sheet append into an {ok:false} the API logs as a sync failure.
 *
 * This runs as whoever owns the script, so mail is sent from that account.
 * MailApp is a new scope — re-authorize once when prompted.
 */

/**
 * Where new-order notifications go. Set to '' to turn the emails off — the sheet
 * append is unaffected either way, since the notification is strictly additive.
 */
const NOTIFY_EMAIL = 'sales@tommytopdecker.com';

/**
 * TTD logo, embedded as base64 rather than linked from the site. Keeps the email
 * self-contained: no extra OAuth scope, no dependency on the site being up, and
 * it renders without the recipient having to click "show images".
 * Source: logos/tommytopdecker_logo_transparent.png, resized to 360px wide.
 */
const LOGO_B64 = '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';

/** Decode LOGO_B64 into the blob MailApp attaches as an inline (cid:) image. */
function ttdLogoBlob() {
  return Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'ttdlogo.png');
}

/**
 * Column order of the "Orders" tab, mirroring what the API appends. Kept local
 * (not reusing the shared HEADERS) so this file stays self-contained and can't
 * collide with declarations in the other .gs files.
 */
const ORDER_COLUMNS = [
  'Timestamp', 'Order ID', 'Email', 'Order Count', 'Phone', 'Name', 'Item',
  'Subtotal', 'Shipping', 'Tax', 'Tax Rate', 'Total', 'Currency',
  'Ship To Name', 'Address 1', 'Address 2', 'City', 'State', 'ZIP', 'Country',
  'Payment Intent',
];

/**
 * Map an Orders row array onto its column names, so adding or reordering a column
 * means updating ORDER_COLUMNS once rather than hunting positional indexes through
 * the email template.
 */
function orderFields(row) {
  const out = {};
  for (var i = 0; i < ORDER_COLUMNS.length; i++) {
    out[ORDER_COLUMNS[i]] = row[i] === null || row[i] === undefined ? '' : String(row[i]);
  }
  return out;
}

/**
 * Email NOTIFY_EMAIL everything needed to pack and ship one order: what's in the
 * box, where it's going, and how to reach the customer. This exists because the
 * Stripe "successful payment" notification carries none of that — it's amount and
 * payer email only, so fulfilment otherwise means opening the Dashboard by hand.
 */
function sendOrderNotification(row) {
  if (!NOTIFY_EMAIL) return;
  const o = orderFields(row);

  // "City, ST 12345" — the conventional US layout, tolerant of any part missing.
  const locality = [o['City'], o['State']].filter(String).join(', ');
  const cityLine = [locality, o['ZIP']].filter(String).join(' ');
  const shipTo = [
    o['Ship To Name'] || o['Name'],
    o['Address 1'],
    o['Address 2'],
    cityLine,
    o['Country'],
  ].filter(String);

  const qty = o['Order Count'] || '1';
  const total = (o['Currency'] ? o['Currency'] + ' ' : '') + o['Total'];
  const subject = 'tommytopdecker.com; New Order · ' + (o['Item'] || 'Order') +
    (qty !== '1' ? ' ×' + qty : '') + ' · ' + total;

  const stripeUrl = o['Payment Intent']
    ? 'https://dashboard.stripe.com/payments/' + o['Payment Intent']
    : '';

  const plain = [
    'PACKING LIST',
    '  ' + (o['Item'] || 'Unknown item') + '  ×' + qty,
    '',
    'SHIP TO',
    shipTo.map(function (line) { return '  ' + line; }).join('\n'),
    '',
    'CUSTOMER',
    '  ' + o['Email'] + (o['Phone'] ? '\n  ' + o['Phone'] : ''),
    '',
    'ORDER',
    '  Subtotal  ' + o['Subtotal'],
    '  Shipping  ' + o['Shipping'],
    '  Tax       ' + o['Tax'] + (o['Tax Rate'] ? '  (' + o['Tax Rate'] + ')' : ''),
    '  Total     ' + total,
    '  Order ID  ' + o['Order ID'],
    stripeUrl ? '\nView in Stripe: ' + stripeUrl : '',
  ].join('\n');

  const html = [
    // Explicit white background: the wordmark is dark on transparency, so a
    // dark-mode client would otherwise render it near-invisible.
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;',
    'background:#ffffff;color:#111;padding:8px 4px">',
    // Centered via BOTH a wrapping text-align and margin:auto — some clients strip
    // auto margins, others ignore text-align on block images. Together they hold up.
    '<div style="text-align:center;margin:0 0 24px">',
    '<img src="cid:ttdlogo" width="180" alt="Tommy Top Decker" ',
    'style="display:block;border:0;width:180px;max-width:180px;height:auto;margin:0 auto">',
    '</div>',
    notifySection('Packing list',
      '<strong>' + notifyEsc(o['Item'] || 'Unknown item') + '</strong> &times;' + notifyEsc(qty)),
    notifySection('Ship to', shipTo.map(notifyEsc).join('<br>')),
    notifySection('Customer',
      notifyEsc(o['Email']) + (o['Phone'] ? '<br>' + notifyEsc(o['Phone']) : '')),
    notifySection('Order', [
      notifyRow('Subtotal', o['Subtotal']),
      notifyRow('Shipping', o['Shipping']),
      notifyRow('Tax', o['Tax'] + (o['Tax Rate'] ? ' (' + o['Tax Rate'] + ')' : '')),
      notifyRow('Total', '<strong>' + notifyEsc(total) + '</strong>', true),
      notifyRow('Order ID', o['Order ID']),
    ].join('')),
    stripeUrl
      ? '<p style="margin:20px 0 0"><a href="' + notifyEsc(stripeUrl) + '">View in Stripe &rarr;</a></p>'
      : '',
    '</div>',
  ].join('');

  const options = {
    to: NOTIFY_EMAIL,
    subject: subject,
    body: plain,
    htmlBody: html,
    inlineImages: { ttdlogo: ttdLogoBlob() },
  };
  // Replying to the notification reaches the customer directly.
  if (o['Email']) options.replyTo = o['Email'];
  MailApp.sendEmail(options);
}

function notifySection(title, inner) {
  return '<p style="margin:0 0 4px;font:600 11px/1.4 sans-serif;letter-spacing:.08em;' +
    'text-transform:uppercase;color:#6b7280">' + notifyEsc(title) + '</p>' +
    '<div style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#111">' + inner + '</div>';
}

/** One label/value line. `raw` skips escaping for values already built as HTML. */
function notifyRow(label, value, raw) {
  return '<div><span style="display:inline-block;min-width:88px;color:#6b7280">' +
    notifyEsc(label) + '</span>' + (raw ? value : notifyEsc(value)) + '</div>';
}

function notifyEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Run once from the editor to preview the notification without placing a real
 * order. Sends a clearly-marked fake to NOTIFY_EMAIL. Safe to re-run.
 */
function testOrderNotification() {
  sendOrderNotification([
    new Date().toISOString(), 'cs_test_TESTORDER', 'buyer@example.com', 2,
    '+1 555 010 1234', 'Test Buyer', '[TEST] Booster Pack', '49.98', '5.99',
    '4.62', '8.25%', '60.59', 'USD', 'Test Buyer', '123 Example St', 'Apt 4',
    'Austin', 'TX', '78701', 'US', 'pi_test_TESTPAYMENT',
  ]);
}
