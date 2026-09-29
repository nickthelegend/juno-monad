import { describe, expect, it } from "vitest";

import { uiToWei } from "@/lib/juno/launchpad";

describe("uiToWei", () => {
  it("converts the number as written, not its binary expansion", () => {
    expect(uiToWei(0.1, 18)).toBe(100_000_000_000_000_000n);
    expect(uiToWei(63140.7, 18)).toBe(63_140_700_000_000_000_000_000n);
    expect(uiToWei(3.53, 18)).toBe(3_530_000_000_000_000_000n);
  });

  it("handles exponent notation at both ends", () => {
    expect(uiToWei(1e-7, 18)).toBe(100_000_000_000n);
    expect(uiToWei(1.5e-12, 6)).toBe(0n);
    expect(uiToWei(1e21, 18)).toBe(10n ** 39n);
    expect(uiToWei(2.5e21, 6)).toBe(2_500_000_000_000_000_000_000_000_000n);
  });

  it("truncates below the token's precision and refuses non-positive input", () => {
    expect(uiToWei(1.2345678, 6)).toBe(1_234_567n);
    expect(uiToWei(0, 18)).toBe(0n);
    expect(uiToWei(-1, 18)).toBe(0n);
    expect(uiToWei(Number.NaN, 18)).toBe(0n);
  });
});
