/**
 * Nemat / TTD Admin Sheet — Google Sheets webhook receiver + one-time setup.
 *
 * This script MUST be bound to the Admin Sheet it should write to:
 *   Open the Nemat/TTD Admin Sheet → Extensions → Apps Script → paste this file.
 *
 * Deploy as a web app:
 *   Deploy → New deployment → type "Web app"
 *     Execute as:      Me
 *     Who has access:  Anyone
 *   → Deploy → copy the /exec URL.
 *   Put that URL in Railway's SHEETS_WEBHOOK_URL (and local .env), then redeploy the API.
 *
 * One-time formatting:
 *   In the editor, Run ▸ setupSheets once (authorize when prompted) to write and
 *   format the "Email List" and "Orders" header rows. Leaves "Credentials" and
 *   all other tabs untouched.
 *
 * SECRET below MUST exactly match SHEETS_WEBHOOK_SECRET in the API server env.
 */

const SECRET = 'PASTE_YOUR_SHEETS_WEBHOOK_SECRET_HERE';

const HEADERS = {
  'Email List': ['Timestamp', 'Email', 'Location', 'Status'],
  'Orders': [
    'Timestamp', 'Order ID', 'Email', 'Order Count', 'Phone', 'Name', 'Item',
    'Subtotal', 'Shipping', 'Tax', 'Tax Rate', 'Total', 'Currency',
    'Ship To Name', 'Address 1', 'Address 2', 'City', 'State', 'ZIP', 'Country',
    'Payment Intent',
  ],
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(body.tab);
    if (!sheet) {
      return json({ ok: false, error: 'unknown tab: ' + body.tab });
    }
    // action:'clear' wipes data rows (keeps the header). Kept for manual use only —
    // the API no longer calls it, because clearing is destructive to any rows that
    // aren't in the database.
    if (body.action === 'clear') {
      const last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
      return json({ ok: true, cleared: Math.max(0, last - 1) });
    }
    // Idempotent append: if dedupeCol (1-based) is given and that key already exists
    // in the tab, skip instead of adding a duplicate. Makes backfills safe to re-run
    // and never removes anything.
    if (body.dedupeCol) {
      const rows = sheet.getLastRow() - 1; // exclude header
      if (rows > 0) {
        const existing = sheet.getRange(2, body.dedupeCol, rows, 1).getValues();
        const key = String(body.row[body.dedupeCol - 1]);
        for (var i = 0; i < existing.length; i++) {
          if (String(existing[i][0]) === key) return json({ ok: true, skipped: true });
        }
      }
    }
    sheet.appendRow(body.row);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run once from the editor. Writes + formats the header row for "Email List" and
 * "Orders" only. Idempotent — re-running just rewrites row 1 of those two tabs.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    const cols = HEADERS[name];
    sheet.getRange(1, 1, 1, cols.length)
      .setValues([cols])
      .setFontWeight('bold')
      .setBackground('#1f3864')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Status dropdown (Admin / Member) on the Email List tab.
    if (name === 'Email List') {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['Admin', 'Member'], true)
        .build();
      sheet.getRange(2, 4, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setDataValidation(rule);
    }
  });
}
