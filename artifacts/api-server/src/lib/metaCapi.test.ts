import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildPurchasePayload, sendPurchaseEvent } from "./metaCapi";

const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const base = {
  eventId: "cs_live_abc",
  eventTimeSec: 1791936000,
  valueCents: 4307,
  currency: "usd",
};

test("uses the Stripe session id as event_id so Meta dedups with the browser Purchase", () => {
  const { data } = buildPurchasePayload(base);
  assert.equal(data[0].event_name, "Purchase");
  assert.equal(data[0].event_id, "cs_live_abc");
  assert.equal(data[0].action_source, "website");
  assert.deepEqual(data[0].custom_data, { currency: "USD", value: 43.07, order_id: "cs_live_abc" });
});

test("hashes normalized PII and passes fbp, fbc, IP and user agent through", () => {
  const { data } = buildPurchasePayload({
    ...base,
    email: "  Buyer@Example.com ",
    phone: "+1 (555) 010-2000",
    name: "Ada Mary Lovelace",
    city: "New York",
    zip: "10001",
    country: "US",
    clientIp: "203.0.113.9",
    clientUserAgent: "UA",
    fbp: "fb.1.1.2",
    fbc: "fb.1.1.click",
  });
  const u = data[0].user_data as Record<string, unknown>;
  assert.deepEqual(u.em, [hash("buyer@example.com")]);
  assert.deepEqual(u.external_id, [hash("buyer@example.com")]);
  assert.deepEqual(u.ph, [hash("15550102000")]);
  assert.deepEqual(u.fn, [hash("ada")]);
  assert.deepEqual(u.ln, [hash("mary lovelace")]);
  assert.deepEqual(u.ct, [hash("newyork")]);
  assert.deepEqual(u.country, [hash("us")]);
  assert.equal(u.client_ip_address, "203.0.113.9");
  assert.equal(u.client_user_agent, "UA");
  assert.equal(u.fbp, "fb.1.1.2");
  assert.equal(u.fbc, "fb.1.1.click");
  assert.ok(!JSON.stringify(data).includes("Buyer@Example.com"));
});

test("omits empty user fields and adds test_event_code only when given", () => {
  const plain = buildPurchasePayload(base);
  assert.deepEqual(plain.data[0].user_data, {});
  assert.ok(!("test_event_code" in plain));
  assert.equal(buildPurchasePayload(base, "TEST123").test_event_code, "TEST123");
});

test("logs and skips without Meta credentials", async () => {
  delete process.env.META_PIXEL_ID;
  delete process.env.META_CAPI_ACCESS_TOKEN;
  delete process.env.META_CAPI_TOKEN;
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  let called = false;
  let warned = "";
  console.warn = (msg: string) => {
    warned = msg;
  };
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;
  try {
    await sendPurchaseEvent(base);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
  assert.equal(called, false);
  assert.match(warned, /skipped Purchase for cs_live_abc/);
});

test("posts to the pixel's /events endpoint, with META_CAPI_TOKEN accepted as the token", async () => {
  process.env.META_PIXEL_ID = "123";
  delete process.env.META_CAPI_ACCESS_TOKEN;
  process.env.META_CAPI_TOKEN = "alias-token";
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  console.log = () => {};
  let url = "";
  let init: RequestInit | undefined;
  globalThis.fetch = (async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return new Response("{}");
  }) as unknown as typeof fetch;
  try {
    await sendPurchaseEvent({ ...base, email: "a@b.co", eventSourceUrl: "https://tommytopdecker.com/success" });
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
  }
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123\/events$/);
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer alias-token");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.data[0].event_id, "cs_live_abc");
  assert.equal(body.data[0].event_source_url, "https://tommytopdecker.com/success");
  assert.deepEqual(body.data[0].user_data.em, [hash("a@b.co")]);
});

test("never throws when Meta rejects or the network fails", async () => {
  process.env.META_PIXEL_ID = "123";
  process.env.META_CAPI_ACCESS_TOKEN = "token";
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = (async () => new Response("bad", { status: 400 })) as typeof fetch;
    await sendPurchaseEvent(base);
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await sendPurchaseEvent(base);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_ACCESS_TOKEN;
  }
});
