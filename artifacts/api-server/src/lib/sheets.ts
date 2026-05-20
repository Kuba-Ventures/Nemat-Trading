type SheetTab = "Waitlist" | "Orders";

export async function appendToSheet(tab: SheetTab, row: unknown[]): Promise<void> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url) {
    console.warn(`[sheets] SHEETS_WEBHOOK_URL not set — skipping ${tab} append`);
    return;
  }
  console.log(`[sheets] -> POST ${tab} to ${url.slice(0, 60)}... (secret set: ${!!secret})`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab, row, secret }),
    });
    const text = await res.text();
    console.log(`[sheets] <- ${res.status} redirected=${res.redirected} body="${text.slice(0, 200).replace(/\n/g, " ")}"`);
    if (!res.ok) {
      console.error(`[sheets] append failed: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[sheets] append error:", err);
  }
}
