/************************************************************************
 * GROWTH TAB — LIVE DATA PULL
 * Paste into Extensions ▸ Apps Script (in the workbook that holds the
 * "Growth" and "Credentials" tabs). See setup steps in the chat / README.
 *
 * No advanced services required — GA4 and Search Console are called directly
 * over HTTP using your login token (ScriptApp.getOAuthToken()).
 *
 * All values are read from the existing "Credentials" tab — none in this file.
 ************************************************************************/

/**
 * @OnlyCurrentDoc
 * OAuth scopes needed (Apps Script usually requests these automatically from
 * the code, but they are listed here for reference):
 *   https://www.googleapis.com/auth/webmasters.readonly   (Search Console)
 *   https://www.googleapis.com/auth/spreadsheets
 *   https://www.googleapis.com/auth/script.external_request
 */

const SHEETS = { GROWTH: 'Growth', CRED: 'Credentials' };
const METRICS_DATE_COL = 14; // column N on the Growth tab
let CFG = {};

/** Master entry point — set the daily trigger on this function. */
function refreshAll() {
  CFG = getConfig_();
  const metrics = {};
  try { Object.assign(metrics, pullGA4()); }          catch (e) { console.log('GA4 failed: ' + e); }
  try { Object.assign(metrics, pullSearchConsole()); } catch (e) { console.log('GSC failed: ' + e); }
  try { Object.assign(metrics, pullMeta()); }          catch (e) { console.log('Meta failed: ' + e); }
  writeDashboard_(metrics);
  appendLog_(metrics);
  stamp_();
}

// --------------------------- read config ------------------------------
function getConfig_() {
  // Credentials tab layout: LABEL in the "Service / Platform" column (C),
  // VALUE in the "Username / Email" column (A). If A is blank the Password
  // column (B) is used instead — handy for keeping the Meta token in B.
  const map = {
    'google analytics':  'GA4_PROPERTY_ID',
    'gsc site url':      'GSC_SITE_URL',
    'meta acct id':      'META_ACCOUNT_ID',
    'meta access token': 'META_TOKEN',
    'lookback (days)':   'LOOKBACK_DAYS'
  };
  const cfg = { GA4_PROPERTY_ID: '', GSC_SITE_URL: '', META_ACCOUNT_ID: '', META_TOKEN: '', LOOKBACK_DAYS: 30 };
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.CRED);
  if (!sh || sh.getLastRow() === 0) return cfg;
  const rows = sh.getRange(1, 1, sh.getLastRow(), 3).getValues(); // columns A, B, C
  const clean = v => {
    const s = String(v).trim();
    return (s === '' || s.toLowerCase() === 'value?' || s.charAt(0) === '[') ? '' : s;
  };
  rows.forEach(r => {
    const key = map[String(r[2]).trim().toLowerCase()]; // C = label
    if (!key) return;
    const val = clean(r[0]) || clean(r[1]);             // A first, then B
    if (val) cfg[key] = (key === 'LOOKBACK_DAYS') ? Number(val) : val;
  });
  return cfg;
}

// ------------------------------ GA4 -----------------------------------
function pullGA4() {
  if (!CFG.GA4_PROPERTY_ID) return {};
  const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + CFG.GA4_PROPERTY_ID + ':runReport';
  const payload = {
    dateRanges: [{ startDate: CFG.LOOKBACK_DAYS + 'daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
      { name: 'engagementRate' }, { name: 'userEngagementDuration' },
      { name: 'conversions' }, { name: 'totalRevenue' }
    ]
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  const v = (data.rows && data.rows[0]) ? data.rows[0].metricValues.map(m => Number(m.value)) : [0,0,0,0,0,0,0];
  const sessions = v[0];
  return {
    'Sessions': sessions, 'Total users': v[1], 'New users': v[2],
    'Engagement rate': v[3],
    'Avg. engagement time (sec)': sessions ? v[4] / sessions : 0,
    'Key events / conversions': v[5],
    'Conversion rate': sessions ? v[5] / sessions : 0,
    'Revenue / value': v[6]
  };
}

// -------------------------- Search Console ----------------------------
function pullSearchConsole() {
  if (!CFG.GSC_SITE_URL) return {};
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - CFG.LOOKBACK_DAYS);
  const fmt = d => Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' +
              encodeURIComponent(CFG.GSC_SITE_URL) + '/searchAnalytics/query';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: [], rowLimit: 1 }),
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  const row = (data.rows && data.rows[0]) ? data.rows[0] : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    'GSC clicks': row.clicks, 'GSC impressions': row.impressions,
    'GSC avg. CTR': row.ctr, 'GSC avg. position': row.position
  };
}

// ------------------------------ Meta ----------------------------------
function pullMeta() {
  if (!CFG.META_TOKEN || !CFG.META_ACCOUNT_ID) return {}; // blank = skip
  const fields = 'spend,impressions,inline_link_clicks,cpc,purchase_roas';
  const url = 'https://graph.facebook.com/v20.0/' + CFG.META_ACCOUNT_ID +
              '/insights?fields=' + fields + '&date_preset=last_' + CFG.LOOKBACK_DAYS + 'd' +
              '&access_token=' + encodeURIComponent(CFG.META_TOKEN);
  const data = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  const d = (data.data && data.data[0]) ? data.data[0] : {};
  const roas = (d.purchase_roas && d.purchase_roas[0]) ? Number(d.purchase_roas[0].value) : 0;
  return {
    'Meta spend': Number(d.spend || 0), 'Meta impressions': Number(d.impressions || 0),
    'Meta link clicks': Number(d.inline_link_clicks || 0), 'Meta CPC': Number(d.cpc || 0), 'Meta ROAS': roas
  };
}

// --------------------------- write helpers ----------------------------
/** Match each metric to its Dashboard row by label in column B of Growth; shift C→D; write new C. */
function writeDashboard_(metrics) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.GROWTH);
  const labels = sh.getRange('B1:B200').getValues().map(r => String(r[0]).trim());
  Object.keys(metrics).forEach(name => {
    const i = labels.indexOf(name);
    if (i === -1) return;
    const row = i + 1, cur = sh.getRange(row, 3), prev = cur.getValue();
    if (typeof prev === 'number') sh.getRange(row, 4).setValue(prev);
    cur.setValue(metrics[name]);
  });
}

/** Append a dated row to the Metrics Log (finds "Date" in column N of Growth, writes next empty row below). */
function appendLog_(m) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.GROWTH);
  const col = sh.getRange(1, METRICS_DATE_COL, sh.getMaxRows(), 1).getValues().map(r => String(r[0]).trim());
  const header = col.indexOf('Date') + 1;
  if (header === 0) throw 'Metrics Log header ("Date" in column N) not found on Growth tab';
  let writeRow = header + 1;
  for (let i = header; i < col.length; i++) if (col[i] !== '') writeRow = i + 2;
  const row = [
    new Date(), 'auto-pull',
    m['Sessions'] || '', m['Total users'] || '', m['New users'] || '',
    m['Key events / conversions'] || '', m['Conversion rate'] || '', m['Engagement rate'] || '',
    m['GSC clicks'] || '', m['GSC impressions'] || '', m['GSC avg. CTR'] || '', m['GSC avg. position'] || '',
    m['Meta spend'] || '', m['Meta link clicks'] || '', m['Meta ROAS'] || '', ''
  ];
  sh.getRange(writeRow, METRICS_DATE_COL, 1, row.length).setValues([row]);
}

function stamp_() {
  SpreadsheetApp.getActive().getSheetByName(SHEETS.GROWTH).getRange('C3').setValue(new Date());
}