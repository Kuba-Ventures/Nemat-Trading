import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSheets,
  classifyAnthropicFailure,
  classifyCloudinaryProbe,
  classifyRemoveBgAccount,
  classifyResendDomains,
  classifySheetsWebhookCall,
  classifyShippoList,
  classifyStorefrontResponse,
  classifyStripeBalance,
  sendingDomainFrom,
} from "./dependencyChecks";

test("Anthropic's credit balance error is recognised", () => {
  assert.equal(
    classifyAnthropicFailure(400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }),
    "out_of_credits",
  );
  assert.equal(classifyAnthropicFailure(401, { error: { type: "authentication_error" } }), "key_rejected");
  assert.equal(classifyAnthropicFailure(529, { error: { type: "overloaded_error" } }), "provider_outage");
});

test("remove.bg is down under one credit, and its invalid key reply is a rejected key", () => {
  const account = (total: number) => ({ data: { attributes: { credits: { total } } } });
  assert.deepEqual(classifyRemoveBgAccount(200, account(12)), { status: "working", failureKind: null });
  assert.deepEqual(classifyRemoveBgAccount(200, account(0.25)), { status: "down", failureKind: "out_of_credits" });
  assert.deepEqual(classifyRemoveBgAccount(403, { errors: [{ title: "API Key invalid", code: "auth_failed" }] }), { status: "down", failureKind: "key_rejected" });
});

test("Stripe: a restricted key without balance access is unknown, a bad key is down", () => {
  assert.equal(classifyStripeBalance(200).status, "working");
  assert.deepEqual(classifyStripeBalance(403), { status: "unknown", failureKind: "cannot_check" });
  assert.deepEqual(classifyStripeBalance(401), { status: "down", failureKind: "key_rejected" });
});

test("Shippo: a missing token is rejected", () => {
  assert.deepEqual(classifyShippoList(401), { status: "down", failureKind: "key_rejected" });
  assert.equal(classifyShippoList(200).status, "working");
});

test("Resend: the sending domain must be verified, a sending-only key can't check", () => {
  assert.equal(classifyResendDomains(200, { data: [{ name: "tommytopdecker.com", status: "verified" }] }, "tommytopdecker.com").status, "working");
  assert.deepEqual(classifyResendDomains(200, { data: [{ name: "tommytopdecker.com", status: "pending" }] }, "tommytopdecker.com"), {
    status: "down",
    failureKind: "domain_not_verified",
  });
  assert.deepEqual(classifyResendDomains(401, { name: "restricted_api_key" }, "tommytopdecker.com"), { status: "unknown", failureKind: "cannot_check" });
  assert.deepEqual(classifyResendDomains(400, { name: "validation_error", message: "API key is invalid" }, "tommytopdecker.com"), {
    status: "down",
    failureKind: "key_rejected",
  });
  assert.equal(sendingDomainFrom("Tommy Top Decker <orders@TommyTopDecker.com>"), "tommytopdecker.com");
});

test("the storefront is up on a 2xx or redirect", () => {
  assert.equal(classifyStorefrontResponse(200).status, "working");
  assert.equal(classifyStorefrontResponse(308).status, "working");
  assert.deepEqual(classifyStorefrontResponse(503), { status: "down", failureKind: "provider_outage" });
});

test("Cloudinary: the no-file probe proves the preset, a missing preset is down", () => {
  assert.equal(classifyCloudinaryProbe(400, "Missing required parameter - file").status, "working");
  assert.deepEqual(classifyCloudinaryProbe(400, "Upload preset not found"), { status: "down", failureKind: "key_not_allowed" });
  assert.deepEqual(classifyCloudinaryProbe(401, "Unknown API key "), { status: "down", failureKind: "key_rejected" });
});

test("Sheets: no call yet is unknown, never down; a failed last call is down", () => {
  assert.deepEqual(classifySheetsWebhookCall(null, true), { status: "unknown", failureKind: "no_recent_activity" });
  assert.deepEqual(classifySheetsWebhookCall(null, false), { status: "unknown", failureKind: "not_configured" });
  assert.equal(classifySheetsWebhookCall({ calledAt: "2026-10-21T20:00:00.000Z", ok: true, error: null }, true).status, "working");
  assert.deepEqual(classifySheetsWebhookCall({ calledAt: "2026-10-21T20:00:00.000Z", ok: false, error: "unauthorized" }, true), {
    status: "down",
    failureKind: "key_rejected",
  });
  const result = checkSheets({ calledAt: "2026-10-21T20:00:00.000Z", ok: true, error: null }, true, Date.parse("2026-10-21T23:00:00.000Z"));
  assert.equal(result.note, "Last worked 3h ago");
});
