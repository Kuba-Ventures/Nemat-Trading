import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import scryfallRouter, { parseTcgProductUrl } from "./scryfall";

const ADMIN = "test-admin-secret";
const realFetch = globalThis.fetch;
let upstreamCalls: string[] = [];
let server: Server;
let base = "";

// Stand in for every upstream site so the tests never touch the network. Calls to
// our own test server go through untouched.
function installUpstreamStub() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(base)) return realFetch(input, init);
    upstreamCalls.push(url);
    if (url.includes("mp-search-api.tcgplayer.com")) {
      return new Response(JSON.stringify({ results: [{ results: [{ price: 42.75, shippingPrice: 0 }] }] }), { status: 200 });
    }
    if (url.includes("api.scryfall.com/cards/")) {
      return new Response(JSON.stringify({ prices: { usd: "1.23" } }), { status: 200 });
    }
    return new Response("upstream says no: secret-ish internals", { status: 500 });
  }) as typeof fetch;
}

before(async () => {
  process.env.ADMIN_SECRET = ADMIN;
  const app = express();
  app.use(express.json());
  app.use("/api", scryfallRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  installUpstreamStub();
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

beforeEach(() => { upstreamCalls = []; });

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const PRODUCT_URL = "https://www.tcgplayer.com/product/657851/magic-some-set-collector-booster";

// ─── Admin-gated routes ─────────────────────────────────────────────────────

test("admin routes reject a missing or wrong admin key and never call upstream", async () => {
  const cases: Array<() => Promise<Response>> = [
    () => fetch(`${base}/api/scryfall/0000aaaa-0000-0000-0000-000000000000/price`),
    () => fetch(`${base}/api/tcgplayer/price-check?id=657851`),
    () => post("/api/lookup/tcgplayer", { url: PRODUCT_URL }),
    () => post("/api/lookup/tcgplayer", { url: PRODUCT_URL }, { "x-admin-key": "wrong" }),
  ];
  for (const call of cases) {
    const res = await call();
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  }
  assert.deepEqual(upstreamCalls, []);
});

test("admin routes work with the admin key", async () => {
  const scry = await fetch(`${base}/api/scryfall/0000aaaa-0000-0000-0000-000000000000/price`, { headers: { "x-admin-key": ADMIN } });
  assert.equal(scry.status, 200);
  assert.deepEqual(await scry.json(), { usd: "1.23" });

  const check = await fetch(`${base}/api/tcgplayer/price-check?id=657851`, { headers: { "x-admin-key": ADMIN } });
  assert.equal(check.status, 200);
  assert.equal(((await check.json()) as { lowestPrice: string | null }).lowestPrice, "42.75");
});

test("admin routes still validate their inputs", async () => {
  const badScry = await fetch(`${base}/api/scryfall/not-a-uuid/price`, { headers: { "x-admin-key": ADMIN } });
  assert.equal(badScry.status, 400);
  const badCheck = await fetch(`${base}/api/tcgplayer/price-check?id=abc`, { headers: { "x-admin-key": ADMIN } });
  assert.equal(badCheck.status, 400);
  assert.deepEqual(upstreamCalls, []);
});

test("the debug route is gone, with or without the admin key", async () => {
  assert.equal((await fetch(`${base}/api/tcgplayer/debug?id=657851`)).status, 404);
  assert.equal((await fetch(`${base}/api/tcgplayer/debug?id=657851`, { headers: { "x-admin-key": ADMIN } })).status, 404);
});

test("with ADMIN_SECRET unset, admin routes fail closed even for an empty key", async () => {
  delete process.env.ADMIN_SECRET;
  try {
    const res = await fetch(`${base}/api/tcgplayer/price-check?id=657851`, { headers: { "x-admin-key": "" } });
    assert.equal(res.status, 401);
  } finally {
    process.env.ADMIN_SECRET = ADMIN;
  }
});

// ─── Public storefront price route ─────────────────────────────────────────

test("public price route needs no auth and returns only the price", async () => {
  const res = await post("/api/tcgplayer/price", { url: PRODUCT_URL }, { "x-forwarded-for": "198.51.100.1" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { lowestPrice: "42.75" });
  // It always hits the canonical product URL, never the caller-supplied string.
  assert.ok(upstreamCalls.every((u) => u.includes("/product/657851/")));
});

test("public price route rejects anything that is not a tcgplayer product url", async () => {
  for (const url of [undefined, "", "https://evil.example/product/1/x", "https://www.tcgplayer.com/search?q=1", 42, "x".repeat(600)]) {
    const res = await post("/api/tcgplayer/price", { url }, { "x-forwarded-for": "198.51.100.2" });
    assert.equal(res.status, 400, `expected 400 for ${String(url).slice(0, 40)}`);
  }
  assert.deepEqual(upstreamCalls, []);
});

test("public price route does not leak upstream errors or bodies", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    return new Response("upstream says no: secret-ish internals", { status: 503 });
  }) as typeof fetch;
  try {
    const res = await post("/api/tcgplayer/price", { url: PRODUCT_URL }, { "x-forwarded-for": "198.51.100.3" });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { lowestPrice: null });
    assert.ok(!text.includes("secret-ish"));
  } finally {
    globalThis.fetch = prev;
  }
});

test("public price route is rate limited per client (30 per window)", async () => {
  const ip = { "x-forwarded-for": "198.51.100.77" };
  for (let i = 0; i < 30; i++) {
    const ok = await post("/api/tcgplayer/price", { url: PRODUCT_URL }, ip);
    assert.equal(ok.status, 200, `request ${i + 1} should pass`);
  }
  const blocked = await post("/api/tcgplayer/price", { url: PRODUCT_URL }, ip);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  // A different client is unaffected.
  const other = await post("/api/tcgplayer/price", { url: PRODUCT_URL }, { "x-forwarded-for": "198.51.100.78" });
  assert.equal(other.status, 200);
});

// ─── URL parsing ─────────────────────────────────────────────────────────────

test("parseTcgProductUrl accepts real product urls and rejects everything else", () => {
  assert.equal(parseTcgProductUrl(PRODUCT_URL), "657851");
  assert.equal(parseTcgProductUrl("https://tcgplayer.com/product/657851/x?Language=English"), "657851");
  assert.equal(parseTcgProductUrl("www.tcgplayer.com/product/657851/x"), "657851");
  assert.equal(parseTcgProductUrl("https://www.tcgplayer.com/product/657851"), "657851");
  assert.equal(parseTcgProductUrl("https://www.tcgplayer.com.evil.example/product/1/x"), null);
  assert.equal(parseTcgProductUrl("javascript:alert(1)"), null);
  assert.equal(parseTcgProductUrl("ftp://www.tcgplayer.com/product/1/x"), null);
  assert.equal(parseTcgProductUrl({}), null);
});
