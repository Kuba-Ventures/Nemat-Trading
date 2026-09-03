import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWindowEnd, DEAL_WINDOW_MS, DEAL_WINDOW_DAYS } from "./drop-window";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const days = (n: number) => n * 24 * 60 * 60 * 1000;

test("the window is ten days", () => {
  assert.equal(DEAL_WINDOW_DAYS, 10);
  assert.equal(DEAL_WINDOW_MS, days(10));
});

test("a future deadline is returned unchanged, so no write is triggered", () => {
  const future = new Date(NOW.getTime() + days(6));
  assert.equal(currentWindowEnd(future, NOW).getTime(), future.getTime());
});

test("a deadline that lapsed yesterday rolls one window from where it was", () => {
  const lapsed = new Date(NOW.getTime() - days(1));
  // Not "now + 10 days" (2026-09-13): one window on from the original date.
  assert.equal(
    currentWindowEnd(lapsed, NOW).toISOString(),
    new Date(lapsed.getTime() + days(10)).toISOString(),
  );
});

test("a deadline lapsed longer than one window skips whole windows, not part of one", () => {
  const lapsed = new Date(NOW.getTime() - days(23)); // two full windows and three days
  const rolled = currentWindowEnd(lapsed, NOW);
  assert.equal(rolled.getTime(), lapsed.getTime() + days(30));
  // Lands seven days out, keeping the original clock face rather than resetting to ten.
  assert.equal(rolled.getTime() - NOW.getTime(), days(7));
});

test("the result is always strictly in the future", () => {
  for (const agoDays of [0, 0.5, 1, 9.9, 10, 10.1, 20, 100, 365]) {
    const lapsed = new Date(NOW.getTime() - days(agoDays));
    assert.ok(
      currentWindowEnd(lapsed, NOW).getTime() > NOW.getTime(),
      `lapsed ${agoDays}d ago did not roll into the future`,
    );
  }
});

test("a deadline landing exactly on now counts as lapsed and rolls a full window", () => {
  const rolled = currentWindowEnd(NOW, NOW);
  assert.equal(rolled.getTime(), NOW.getTime() + days(10));
});

test("rolling is idempotent: re-running against the rolled value changes nothing", () => {
  const lapsed = new Date(NOW.getTime() - days(4));
  const once = currentWindowEnd(lapsed, NOW);
  assert.equal(currentWindowEnd(once, NOW).getTime(), once.getTime());
});
