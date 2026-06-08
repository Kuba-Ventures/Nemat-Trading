// Best-effort IP geolocation for the Email Signups "Location" column.
// Uses ip-api.com's free, keyless endpoint. Never throws — returns "" on any
// failure (timeout, rate limit, private/unknown IP) so it can't break a signup.

export async function locationFromIp(ip: string | undefined): Promise<string> {
  if (!ip) return "";

  // Strip IPv6-mapped IPv4 prefix and zone id; skip local/private addresses.
  const clean = ip.replace(/^::ffff:/, "").split("%")[0].trim();
  if (
    !clean ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.startsWith("10.") ||
    clean.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean)
  ) {
    return "";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,city,region,countryCode`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return "";

    const data = (await res.json()) as {
      status?: string;
      city?: string;
      region?: string; // state/region code, e.g. "VA"
      countryCode?: string; // e.g. "US"
    };
    if (data.status !== "success") return "";

    // Format like "Warrenton, VA, US"
    return [data.city, data.region, data.countryCode].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}
