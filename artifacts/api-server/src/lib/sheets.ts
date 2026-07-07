type SheetTab = "Email List" | "Orders";

export type SheetResult = { ok: boolean; error?: string };

/**
 * POST a payload to the Apps Script web app. The Apps Script ALWAYS responds 200
 * (Google's ContentService can't set status codes), and a misconfigured "Who has
 * access" returns an HTML Google login page — so checking res.ok is NOT enough to
 * know the write landed. We parse the JSON body: a non-JSON/HTML response or an
 * {ok:false} payload is a failure, with a specific reason so it's diagnosable from
 * the Railway logs (or the admin "Re-sync" button) instead of failing silently.
 */
async function postToSheet(payload: Record<string, unknown>): Promise<SheetResult> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url) return { ok: false, error: "SHEETS_WEBHOOK_URL not set" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      // Not our JSON contract — almost always the web app's access setting.
      const looksLikeLogin = /accounts\.google\.com|sign in|<html/i.test(text);
      return {
        ok: false,
        error: looksLikeLogin
          ? "got a Google login/HTML page instead of JSON — set the web app's 'Who has access' to Anyone and redeploy, then confirm SHEETS_WEBHOOK_URL is the current /exec URL"
          : `non-JSON response (status ${res.status})`,
      };
    }
    if (!res.ok || body?.ok === false) {
      // body.error === "unauthorized" means the deployed Apps Script SECRET does not
      // match SHEETS_WEBHOOK_SECRET.
      return { ok: false, error: body?.error ?? `status ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "request failed" };
  }
}

/**
 * Append one row to a tab. Returns success + a reason on failure (never throws).
 * Pass `dedupeCol` (1-based column of the row's unique key — Email for the Email
 * List, Order ID for Orders) to make the append idempotent: the Apps Script skips
 * the row if that key already exists, so backfills never create duplicates.
 */
export async function appendToSheet(
  tab: SheetTab,
  row: unknown[],
  opts?: { dedupeCol?: number },
): Promise<SheetResult> {
  const result = await postToSheet({ tab, row, dedupeCol: opts?.dedupeCol });
  if (!result.ok) console.error(`[sheets] ${tab} append failed: ${result.error}`);
  return result;
}

/** Clear a tab's data rows (keeps the header). Used before a full re-sync. */
export async function clearSheet(tab: SheetTab): Promise<SheetResult> {
  const result = await postToSheet({ tab, action: "clear" });
  if (!result.ok) console.error(`[sheets] ${tab} clear failed: ${result.error}`);
  return result;
}
