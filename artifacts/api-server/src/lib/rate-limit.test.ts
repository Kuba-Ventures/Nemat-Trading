import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { clientKey, createRateLimiter } from "./rate-limit";

function fakeReq(headers: Record<string, string> = {}, remoteAddress = "10.0.0.1"): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

function fakeRes() {
  const out = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    setHeader(k: string, v: string) { out.headers[k] = v; },
    status(code: number) { out.status = code; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  return { res: res as unknown as Response, out };
}

function hit(limiter: ReturnType<typeof createRateLimiter>, req: Request) {
  const { res, out } = fakeRes();
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return { passed, out };
}

test("allows up to max requests per window, then 429s with Retry-After", () => {
  let t = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => t });
  const req = fakeReq();
  for (let i = 0; i < 3; i++) assert.equal(hit(limiter, req).passed, true);
  const blocked = hit(limiter, req);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.out.status, 429);
  assert.deepEqual(blocked.out.body, { error: "Too many requests" });
  assert.equal(blocked.out.headers["Retry-After"], "60");
});

test("the window resets after windowMs", () => {
  let t = 0;
  const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: () => t });
  const req = fakeReq();
  assert.equal(hit(limiter, req).passed, true);
  assert.equal(hit(limiter, req).passed, false);
  t = 1_000;
  assert.equal(hit(limiter, req).passed, true);
});

test("clients are counted separately", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
  assert.equal(hit(limiter, fakeReq({}, "1.1.1.1")).passed, true);
  assert.equal(hit(limiter, fakeReq({}, "2.2.2.2")).passed, true);
  assert.equal(hit(limiter, fakeReq({}, "1.1.1.1")).passed, false);
});

test("a spoofed leftmost X-Forwarded-For entry does not dodge the limit", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
  assert.equal(hit(limiter, fakeReq({ "x-forwarded-for": "6.6.6.1, 203.0.113.9" })).passed, true);
  assert.equal(hit(limiter, fakeReq({ "x-forwarded-for": "6.6.6.2, 203.0.113.9" })).passed, false);
});

test("clientKey uses the rightmost X-Forwarded-For entry, else the socket", () => {
  assert.equal(clientKey(fakeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "5.6.7.8");
  assert.equal(clientKey(fakeReq({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(fakeReq({}, "127.0.0.1")), "127.0.0.1");
});

test("tracked clients are capped so a key flood cannot grow memory without limit", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2, now: () => 0 });
  hit(limiter, fakeReq({}, "a"));
  hit(limiter, fakeReq({}, "b"));
  hit(limiter, fakeReq({}, "c")); // evicts "a"
  assert.equal(hit(limiter, fakeReq({}, "a")).passed, true);
});
