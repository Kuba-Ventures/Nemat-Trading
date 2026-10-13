import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// One printable PDF per order for the sales@ email: the Shippo label page(s)
// followed by a 4 x 6 in packing slip, so both come off the same label printer.

export type SlipInput = {
  orderId: string;
  date: Date;
  item: string;
  quantity: number;
  shipTo: string[];
  trackingNumber?: string;
  service?: string;
};

const W = 288; // 4 in
const H = 432; // 6 in
const INK = rgb(0.11, 0.11, 0.125);
const GOLD = rgb(0.79, 0.66, 0.38);
const MUTED = rgb(0.42, 0.42, 0.45);

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// pdf-lib's standard fonts only cover WinAnsi; drop anything else so a name
// with unusual characters can't fail the whole slip.
function safe(s: string): string {
  return s.replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function drawSlip(page: PDFPage, bold: PDFFont, reg: PDFFont, s: SlipInput) {
  const x = 22;
  let y = H - 34;
  page.drawText("TOMMY TOP DECKER", { x, y, size: 15, font: bold, color: INK });
  y -= 14;
  page.drawText("PACKING SLIP", { x, y, size: 8, font: bold, color: GOLD });
  page.drawText(s.date.toISOString().slice(0, 10), {
    x: W - x - reg.widthOfTextAtSize(s.date.toISOString().slice(0, 10), 8),
    y,
    size: 8,
    font: reg,
    color: MUTED,
  });
  y -= 10;
  page.drawLine({ start: { x, y }, end: { x: W - x, y }, thickness: 0.75, color: GOLD });

  const label = (t: string) => {
    y -= 22;
    page.drawText(t, { x, y, size: 7, font: bold, color: MUTED });
    y -= 13;
  };

  label("SHIP TO");
  for (const l of s.shipTo) {
    page.drawText(safe(l), { x, y, size: 10, font: reg, color: INK });
    y -= 13;
  }

  label("ITEMS");
  const qty = `x${s.quantity}`;
  for (const [i, l] of wrap(safe(s.item), bold, 11, W - 2 * x - 30).entries()) {
    page.drawText(l, { x, y, size: 11, font: bold, color: INK });
    if (i === 0) page.drawText(qty, { x: W - x - bold.widthOfTextAtSize(qty, 11), y, size: 11, font: bold, color: INK });
    y -= 14;
  }

  if (s.trackingNumber) {
    label("TRACKING");
    page.drawText(safe(`${s.service ?? ""} ${s.trackingNumber}`.trim()), { x, y, size: 9, font: reg, color: INK });
  }

  page.drawText("Thank you for buying under market.", { x, y: 46, size: 9, font: bold, color: INK });
  page.drawText(safe(`Order #${s.orderId.slice(-8).toUpperCase()}  \u00B7  tommytopdecker.com`), { x, y: 32, size: 7, font: reg, color: MUTED });
}

/** Label pages (if any) then the slip. Returns null only if even the slip fails. */
export async function buildShippingPdf(slip: SlipInput, labelPdf: Uint8Array | null): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.create();
    if (labelPdf) {
      try {
        const label = await PDFDocument.load(labelPdf);
        for (const p of await doc.copyPages(label, label.getPageIndices())) doc.addPage(p);
      } catch (err) {
        console.error("[packing-slip] could not read label PDF:", err);
      }
    }
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    drawSlip(doc.addPage([W, H]), bold, reg, slip);
    return await doc.save();
  } catch (err) {
    console.error("[packing-slip] failed:", err);
    return null;
  }
}

export async function fetchLabelPdf(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error("[packing-slip] label download failed:", err);
    return null;
  }
}
