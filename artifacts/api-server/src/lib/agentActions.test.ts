import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentUpdate } from "./agentActions";

const ok = { approval: "thread/msg", reason: "Shawn counted 66" };

test("stock change passes", () => {
  const r = parseAgentUpdate({ ...ok, changes: { stock: 66 } });
  assert.ok(!("error" in r));
  assert.deepEqual((r as any).updates, { stock: 66 });
});

test("price and other admin fields are refused", () => {
  for (const field of ["price", "discountPercent", "pullProbabilities", "imageUrl"]) {
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
