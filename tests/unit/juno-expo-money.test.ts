import { describe, it, expect } from "vitest";

import { bookPrice, money, sum, tokens } from "../../juno-expo/lib/format";

/**
 * The mobile app's number formatter.
 *
 * The case worth testing is the small one. Every coin on Juno launches around
 * 1e-7, so a unit price below `0.0001` is the *normal* reading rather than an
 * edge case — and it was rendering as `$1.86e-7` in a social feed, which is a
 * correct number nobody reads on a card whose whole job is to be glanced at.
 *
 * Subscript notation is what traders actually use: the subscript counts the
 * zeros after the point, so `0.0₆186` is `0.000000186`.
 */

describe("money", () => {
  it("writes a sub-0.0001 price with a subscript zero count", () => {
    expect(money(0.000000186, "USD", { compact: false })).toBe("$0.0₆186");
    expect(money(0.0000224, "USD", { compact: false })).toBe("$0.0₄224");
  });

  it("carries correctly when rounding crosses a power of ten", () => {
    // 9.999e-7 rounds to three figures as 1.00e-6, which has one zero fewer.
    // Without the carry this rendered as `0.0₆1000`.
    expect(money(0.0000009999, "USD", { compact: false })).toBe("$0.0₅100");
  });

  it("leaves readable decimals alone", () => {
    expect(money(0.000224, "USD", { compact: false })).toBe("$0.0002");
    expect(money(0.89, "USD", { compact: false })).toBe("$0.8900");
    expect(money(144.54, "USD", { compact: false })).toBe("$144.54");
  });

  it("groups thousands when not compacting", () => {
    expect(money(84_333.3, "USD", { compact: false })).toBe("$84,333.30");
    expect(money(-1_234.5, "USD", { compact: false })).toBe("-$1,234.50");
  });

  it("compacts large figures and labels a non-USD quote", () => {
    expect(money(225_118, "USD")).toBe("$225.12k");
    expect(money(1_240_000, "USD")).toBe("$1.24M");
    expect(money(950_000_000_000, "USD")).toBe("$950.00B");
    expect(money(14_000_000_000, "USD")).toBe("$14.00B");
    expect(money(2_500_000_000_000, "USD")).toBe("$2.50T");
    // The tier is chosen after rounding.
    expect(money(999_999_999, "USD")).toBe("$1.00B");
    expect(money(999_999, "USD")).toBe("$1.00M");
    expect(money(999_990_000, "USD")).toBe("$999.99M");
    expect(money(2.5, "MON", { compact: false })).toBe("2.50 MON");
  });

  it("signs a negative rather than losing it in the subscript", () => {
    expect(money(-0.000000186, "USD", { compact: false })).toBe("-$0.0₆186");
  });

  it("returns a dash for what it was not given", () => {
    // The app leans on this: an unreadable value must never render as zero.
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(Number.NaN)).toBe("—");
    expect(money(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("still writes a true zero as zero", () => {
    expect(money(0, "USD", { compact: false })).toBe("$0");
  });
});

describe("tokens", () => {
  it("compacts millions and groups thousands", () => {
    expect(tokens(778_090_000)).toBe("778.09M");
    expect(tokens(24_843)).toBe("24,843");
  });

  it("keeps enough decimals to distinguish small holdings", () => {
    expect(tokens(0.5)).toBe("0.5000");
    expect(tokens(12.5)).toBe("12.50");
  });

  it("does not claim four decimals of precision about zero", () => {
    // "0.0000 of 50.00 MON" was what a savings goal with no contributions
    // read as. Zero has no fraction to show.
    expect(tokens(0)).toBe("0");
  });

  it("returns a dash rather than NaN", () => {
    expect(tokens(Number.NaN)).toBe("—");
  });
});

describe("bookPrice", () => {
  it("keeps two levels 1% apart distinct", () => {
    expect(bookPrice(0.001029644783)).toBe("0.00103 MON");
    expect(bookPrice(0.001039941231)).toBe("0.00104 MON");
    expect(bookPrice(84_333.3, "USD")).toBe("$84,333.3");
    expect(bookPrice(0)).toBe("—");
  });
});

describe("sum", () => {
  it("calls dust dust instead of writing it like a price", () => {
    expect(sum(8.67e-20)).toBe("<$0.0001");
    expect(sum(3e-9, "MON")).toBe("<0.0001 MON");
  });

  it("reads like money otherwise", () => {
    expect(sum(0)).toBe("$0");
    expect(sum(0.0039)).toBe("$0.0039");
    expect(sum(6950)).toBe("$6.95k");
    expect(sum(null)).toBe("—");
  });
});
