// Tracking numbers typed in from Pirate Ship on the label page (routes/labels.ts).
// Pirate Ship has no API, so the client buys the label there and pastes the
// tracking number back; these helpers clean it up and link to the carrier.

/** Spaces and dashes removed, upper-cased. Null if it can't be a tracking number. */
export function normalizeTracking(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8,40}$/.test(t) ? t : null;
}

/** UPS numbers start with 1Z; everything else Pirate Ship sells is USPS. */
export function carrierFor(tracking: string): "UPS" | "USPS" {
  return /^1Z/.test(tracking) ? "UPS" : "USPS";
}

export function trackingUrlFor(tracking: string): string {
  const t = encodeURIComponent(tracking);
  return carrierFor(tracking) === "UPS"
    ? `https://www.ups.com/track?tracknum=${t}`
    : `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
}
