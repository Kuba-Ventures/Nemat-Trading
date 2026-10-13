import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildShippingPdf, type SlipInput } from "./packingSlip";

const SLIP: SlipInput = {
  orderId: "cs_live_abcdefghijkl",
  date: new Date("2026-10-13T12:00:00Z"),
  item: "Teenage Mutant Ninja Turtles Play Booster Pack",
  quantity: 2,
  shipTo: ["Zoë Ünïcode 李", "123 Example St", "Austin, TX 78701"],
  trackingNumber: "9400100000000000000000",
  service: "USPS Ground Advantage",
};

test("slip alone is one 4 x 6 in page, even with non-Latin names", async () => {
  const bytes = await buildShippingPdf(SLIP, null);
  assert.ok(bytes);
  const doc = await PDFDocument.load(bytes!);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.deepEqual([width, height], [288, 432]);
});

test("label pages come first, then the slip", async () => {
  const label = await PDFDocument.create();
  label.addPage([288, 432]);
  const bytes = await buildShippingPdf(SLIP, await label.save());
  assert.equal((await PDFDocument.load(bytes!)).getPageCount(), 2);
});

test("an unreadable label still yields the slip", async () => {
  const bytes = await buildShippingPdf(SLIP, new Uint8Array([1, 2, 3]));
  assert.equal((await PDFDocument.load(bytes!)).getPageCount(), 1);
});
