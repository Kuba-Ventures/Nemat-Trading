import { test } from "node:test";
import assert from "node:assert/strict";
import { labelPageUrl, labelToken, verifyLabelToken } from "./labelLink";

test("label links verify only for their own order and fail closed without a secret", () => {
  delete process.env.LABEL_LINK_SECRET;
  delete process.env.ADMIN_SECRET;
  assert.equal(labelToken("cs_live_a"), null);
  assert.equal(labelPageUrl("cs_live_a"), null);
  assert.equal(verifyLabelToken("cs_live_a", ""), false);

  process.env.ADMIN_SECRET = "test-secret";
  const t = labelToken("cs_live_a")!;
  assert.equal(t.length, 32);
  assert.equal(verifyLabelToken("cs_live_a", t), true);
  assert.equal(verifyLabelToken("cs_live_b", t), false);
  assert.equal(verifyLabelToken("cs_live_a", t.replace(/.$/, "0") === t ? t.replace(/.$/, "1") : t.replace(/.$/, "0")), false);
  assert.equal(verifyLabelToken("cs_live_a", undefined), false);
  assert.match(labelPageUrl("cs_live_a")!, /\/api\/labels\/cs_live_a\?t=[0-9a-f]{32}$/);
  delete process.env.ADMIN_SECRET;
});
