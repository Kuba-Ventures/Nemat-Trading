import { describe, expect, it } from "vitest";
import { isShareOfPulls } from "./PullProbabilityChart";

const t = (percent: number) => ({ label: String(percent), abbr: "", color: "", percent });

describe("isShareOfPulls", () => {
  it("treats tiers that sum to 100 as a share of pulls (the live TMNT data)", () => {
    expect(isShareOfPulls([27, 23, 22, 14, 9, 5].map(t))).toBe(true);
  });

  it("treats per-pack hit rates, which do not sum to 100, as at-least-one odds", () => {
    expect(isShareOfPulls([100, 100, 100, 59, 100, 1].map(t))).toBe(false);
  });
});
