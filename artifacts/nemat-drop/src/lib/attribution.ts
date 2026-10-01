// Ad attribution: remember where a visitor came from (Meta click id + UTM
// tags) so checkout can attach it to the Stripe session and the order row.
// Meta appends `fbclid` to every ad click, tagged or not, so this works for
// untagged ads too. Last touch wins: a new tagged landing overwrites the old.

const STORAGE_KEY = "ttd_attribution";
const MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000; // matches Meta's longest click window

const URL_KEYS = [
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type Attribution = Partial<Record<(typeof URL_KEYS)[number] | "fbc" | "fbp" | "landed_at", string>>;

type Stored = Partial<Record<(typeof URL_KEYS)[number] | "fbc", string>> & { landed_at: string };

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Call once on page load. Only writes when the URL carries attribution params.
export function captureAttribution(search: string = window.location.search, now: Date = new Date()): void {
  const params = new URLSearchParams(search);
  const found: Stored = { landed_at: now.toISOString() };
  let hasAny = false;
  for (const key of URL_KEYS) {
    const value = params.get(key);
    if (value) {
      found[key] = value;
      hasAny = true;
    }
  }
  if (!hasAny) return;
  // Meta's documented _fbc format, so the click id survives even if the
  // GTM pixel hasn't set the cookie yet.
  if (found.fbclid) found.fbc = `fb.1.${now.getTime()}.${found.fbclid}`;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found));
  } catch {
    // Storage blocked (private mode etc). Attribution is best effort.
  }
}

// Read at checkout. Prefers the live _fbc/_fbp cookies set by the pixel.
export function getAttribution(now: Date = new Date()): Attribution {
  let stored: Stored | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Stored;
  } catch {
    stored = null;
  }
  if (stored && now.getTime() - new Date(stored.landed_at).getTime() > MAX_AGE_MS) {
    stored = null;
  }

  const result: Attribution = { ...(stored ?? {}) };
  const fbc = readCookie("_fbc");
  const fbp = readCookie("_fbp");
  if (fbc) result.fbc = fbc;
  if (fbp) result.fbp = fbp;
  return result;
}
