import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  ADMIN_TOKEN_TTL_MS,
  checkAdminPassword,
  isAdminKey,
  signAdminToken,
  verifyAdminToken,
} from "./adminAuth";
import adminLoginRouter from "../routes/adminLogin";

beforeEach(() => {
  process.env.ADMIN_SECRET = "test-secret";
  process.env.ADMIN_PASSWORD = "correct horse";
  delete process.env.ADMIN_ACCEPT_LEGACY_KEY;
});

test("a signed token verifies until it expires", () => {
  const now = 1_800_000_000_000;
  const { token, expiresAt } = signAdminToken(now)!;
  assert.equal(expiresAt, now + ADMIN_TOKEN_TTL_MS);
  assert.equal(verifyAdminToken(token, now), true);
  assert.equal(verifyAdminToken(token, expiresAt - 1), true);
  assert.equal(verifyAdminToken(token, expiresAt), false);
});

test("a tampered or foreign token is rejected", () => {
  const { token } = signAdminToken()!;
  const [payload, mac] = token.split(".");
  const later = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * ADMIN_TOKEN_TTL_MS })).toString("base64url");
  assert.equal(verifyAdminToken(`${later}.${mac}`), false);
  assert.equal(verifyAdminToken(`${payload}.${mac.slice(0, -1)}A`), false);
  assert.equal(verifyAdminToken(`${token}.extra`), false);
  assert.equal(verifyAdminToken(""), false);
  assert.equal(verifyAdminToken(undefined), false);
  process.env.ADMIN_SECRET = "rotated";
  assert.equal(verifyAdminToken(token), false);
});

test("fails closed without ADMIN_SECRET", () => {
  delete process.env.ADMIN_SECRET;
  assert.equal(signAdminToken(), null);
  assert.equal(isAdminKey(""), false);
  process.env.ADMIN_ACCEPT_LEGACY_KEY = "1";
  assert.equal(isAdminKey(""), false);
});

test("the raw ADMIN_SECRET works only while ADMIN_ACCEPT_LEGACY_KEY=1", () => {
  assert.equal(isAdminKey("test-secret"), false);
  process.env.ADMIN_ACCEPT_LEGACY_KEY = "1";
  assert.equal(isAdminKey("test-secret"), true);
  assert.equal(isAdminKey("wrong"), false);
  assert.equal(isAdminKey(signAdminToken()!.token), true);
});

test("password check is exact and fails closed without ADMIN_PASSWORD", () => {
  assert.equal(checkAdminPassword("correct horse"), true);
  assert.equal(checkAdminPassword("correct horse "), false);
  assert.equal(checkAdminPassword(undefined), false);
  delete process.env.ADMIN_PASSWORD;
  assert.equal(checkAdminPassword(""), false);
});

test("POST /admin/login returns a working token only for the right password", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", adminLoginRouter);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/login`;
  const post = (password: unknown) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  try {
    const wrong = await post("nope");
    assert.equal(wrong.status, 401);
    const right = await post("correct horse");
    assert.equal(right.status, 200);
    const { token, expiresAt } = (await right.json()) as { token: string; expiresAt: number };
    assert.equal(verifyAdminToken(token), true);
    assert.ok(expiresAt > Date.now());
  } finally {
    server.close();
  }
});
