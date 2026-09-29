import { describe, expect, it } from "vitest";

import { coalesceFills } from "@/lib/juno/fills";
import type { PoolSwap } from "@/lib/juno/swaps";

const TOKEN = "0xF3F7F7c85E92A4718A87CD67285569c7a5c4c5b8";
const TRADER = "0x00219DB1E8D5676E06b45bA3E2bBBe1f36b315Aa";
const TX = "0xf7108c37973e4b62790b1cbe9910b16dc4ef258d88405baa680371737c265fba";

function fill(logIndex: number, overrides: Partial<PoolSwap> = {}): PoolSwap {
  return {
    id: `${TX}:${logIndex}`,
    txHash: TX,
    logIndex,
    token: TOKEN,
    side: "sell",
    baseAmount: 1_000,
    quoteAmount: 0.5,
    fee: 0.0015,
    price: 0.0005 - logIndex * 0.000001,
    trader: TRADER,
    timestamp: "2026-09-29T07:26:50.000Z",
    blockNumber: 66_545_300,
    venue: "kuru",
    ...overrides,
  };
}

describe("coalesceFills", () => {
  it("makes one trade of one order's fills, newest first", () => {
    const fills = [fill(100), fill(99), fill(98)];
    const [trade, ...rest] = coalesceFills(fills);
    expect(rest).toEqual([]);
    expect(trade.baseAmount).toBe(3_000);
    expect(trade.quoteAmount).toBeCloseTo(1.5, 12);
    expect(trade.fee).toBeCloseTo(0.0045, 12);
    // The mark the order left behind is its last level, not its first.
    expect(trade.price).toBe(fill(100).price);
    // The id is the first fill's, so it is the same on every read.
    expect(trade.id).toBe(`${TX}:98`);
    expect(trade.logIndex).toBe(98);
  });

  it("gives the same trade oldest first", () => {
    const [newest] = coalesceFills([fill(100), fill(99), fill(98)]);
    const [oldest] = coalesceFills([fill(98), fill(99), fill(100)]);
    expect(oldest).toEqual(newest);
  });

  it("does not change the rows it was given", () => {
    const fills = [fill(2), fill(1)];
    const before = structuredClone(fills);
    coalesceFills(fills);
    expect(fills).toEqual(before);
  });

  it("keeps different orders apart: another tx, trader, side or token", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const rows = coalesceFills([
      fill(5),
      fill(4, { txHash: "0xabc", id: "0xabc:4" }),
      fill(3, { trader: other }),
      fill(2, { side: "buy" }),
      fill(1, { token: other }),
    ]);
    expect(rows).toHaveLength(5);
  });

  it("leaves curve and v2 trades alone", () => {
    const curve = fill(7, { venue: undefined });
    const pair = fill(6, { venue: "uniswap-v2" });
    expect(coalesceFills([curve, pair, fill(5, { venue: undefined })])).toEqual([curve, pair, fill(5, { venue: undefined })]);
  });

  it("rejoins an order split across two pages", () => {
    const all = Array.from({ length: 10 }, (_, i) => fill(99 - i));
    const whole = coalesceFills(all);
    const paged = coalesceFills([...coalesceFills(all.slice(0, 4)), ...coalesceFills(all.slice(4))]);
    expect(paged).toHaveLength(1);
    expect(paged[0].baseAmount).toBe(whole[0].baseAmount);
    expect(paged[0].quoteAmount).toBeCloseTo(whole[0].quoteAmount, 12);
    expect(paged[0].price).toBe(whole[0].price);
    expect(paged[0].id).toBe(whole[0].id);
  });
});
