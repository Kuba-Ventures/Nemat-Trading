import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentUpdate, parseRefund } from "./agentActions";

const ok = { approval: "thread/msg", reason: "Shawn counted 66" };

test("stock change passes", () => {
  const r = parseAgentUpdate({ ...ok, changes: { stock: 66 } });
  assert.ok(!("error" in r));
  assert.deepEqual((r as any).updates, { stock: 66 });
});

test("price and discount pass with valid values", () => {
  assert.deepEqual((parseAgentUpdate({ ...ok, changes: { priceCents: 3400, discountPercent: 10 } }) as any).updates, { price: 3400, discountPercent: 10 });
  assert.match((parseAgentUpdate({ ...ok, changes: { priceCents: 34.5 } }) as any).error, /priceCents/);
  assert.match((parseAgentUpdate({ ...ok, changes: { price: 3400 } }) as any).error, /can't be changed/);
  assert.match((parseAgentUpdate({ ...ok, changes: { discountPercent: 95 } }) as any).error, /discount/);
});

test("pull odds, images and unknown fields are refused", () => {
  for (const field of ["pullProbabilities", "imageUrl", "possiblePulls", "intelReport"]) {
    const r = parseAgentUpdate({ ...ok, changes: { [field]: 1 } });
    assert.match((r as any).error, /can't be changed/);
  }
});

test("approval and reason are required", () => {
  assert.match((parseAgentUpdate({ reason: "x", changes: { stock: 1 } }) as any).error, /approval/);
  assert.match((parseAgentUpdate({ approval: "a", changes: { stock: 1 } }) as any).error, /reason/);
});

test("bad values are refused", () => {
  assert.match((parseAgentUpdate({ ...ok, changes: { stock: -1 } }) as any).error, /stock/);
  assert.match((parseAgentUpdate({ ...ok, changes: { stock: 1.5 } }) as any).error, /stock/);
  assert.match((parseAgentUpdate({ ...ok, changes: { expiresAt: "soon" } }) as any).error, /expiresAt/);
  assert.match((parseAgentUpdate({ ...ok, changes: {} }) as any).error, /Nothing/);
});

test("refunds need approval and reason; amount optional", () => {
  assert.deepEqual(parseRefund({ approval: "t/m", reason: "damaged" }), { amountCents: null, approval: "t/m", reason: "damaged" });
  assert.equal((parseRefund({ approval: "t/m", reason: "x", amountCents: 500 }) as any).amountCents, 500);
  assert.match((parseRefund({ reason: "x" }) as any).error, /approval/);
  assert.match((parseRefund({ approval: "a", reason: "x", amountCents: -1 }) as any).error, /amountCents/);
});
