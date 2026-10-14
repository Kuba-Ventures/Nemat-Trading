import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncCache } from "./syncCache";

function setup() {
  let t = 1_000_000;
  let loads = 0;
  const get = createSyncCache(60_000, 10_000, () => t);
  const load = async () => ++loads;
  return { get, load, advance: (ms: number) => { t += ms; }, loads: () => loads, now: () => t };
}

test("reuses a value inside the TTL and reports when it was fetched", async () => {
  const s = setup();
  const first = await s.get("k", s.load);
  s.advance(59_000);
  const second = await s.get("k", s.load);
  assert.equal(s.loads(), 1);
  assert.equal(second.at, first.at);
});

test("reloads after the TTL with a new sync time", async () => {
  const s = setup();
  await s.get("k", s.load);
  s.advance(60_000);
  const next = await s.get("k", s.load);
  assert.equal(s.loads(), 2);
  assert.equal(next.at, s.now());
});

test("a forced sync skips the cache once the value is 10s old", async () => {
  const s = setup();
  await s.get("k", s.load);
  s.advance(10_000);
  const forced = await s.get("k", s.load, true);
  assert.equal(s.loads(), 2);
  assert.equal(forced.value, 2);
});

test("repeated forced syncs inside 10s reuse the fresh value", async () => {
  const s = setup();
  await s.get("k", s.load);
  s.advance(3_000);
  await s.get("k", s.load, true);
  assert.equal(s.loads(), 1);
});

test("keys are cached separately", async () => {
  const s = setup();
  await s.get("a", s.load);
  await s.get("b", s.load);
  assert.equal(s.loads(), 2);
});
