import { describe, expect, it } from "vitest";

import { crowdFromSwaps } from "@/lib/juno/crowd";
import type { PoolSwap } from "@/lib/juno/swaps";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** A fill in block `block`; the log index defaults to 0. */
function swap(over: Partial<PoolSwap> & { block: number }): PoolSwap {
  const { block, ...rest } = over;
  const logIndex = rest.logIndex ?? 0;
  const txHash = `0x${block.toString(16).padStart(64, "0")}`;
  return {
    id: `${txHash}:${logIndex}`,
    txHash,
    logIndex,
    token: "0x2222222222222222222222222222222222222222",
    side: "buy",
    baseAmount: 100,
    quoteAmount: 1,
    fee: 0,
    price: 0.01,
    trader: "alice",
    timestamp: new Date(NOW - HOUR).toISOString(),
    blockNumber: block,
    ...rest,
  };
}

describe("crowdFromSwaps", () => {
  it("counts distinct traders, not fills", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 1, trader: "alice" }),
        swap({ block: 2, trader: "alice" }),
        swap({ block: 3, trader: "bob" }),
      ],
      false,
      0.01,
      1,
      NOW,
    );
    expect(crowd.traders).toBe(2);
  });

  it("counts a wallet that sold everything back as no longer holding", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 1, trader: "alice", side: "buy", baseAmount: 100 }),
        swap({ block: 2, trader: "alice", side: "sell", baseAmount: 100 }),
        swap({ block: 3, trader: "bob", side: "buy", baseAmount: 50 }),
      ],
      false,
      0.01,
      1,
      NOW,
    );
    expect(crowd.holdersStill).toBe(1);
  });

  it("takes the earliest buy by block, not by list order", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 9, trader: "late", price: 0.05 }),
        swap({ block: 2, trader: "early", price: 0.01 }),
      ],
      false,
      0.02,
      1,
      NOW,
    );
    expect(crowd.firstBuyer?.wallet).toBe("early");
    expect(crowd.firstBuyer?.price).toBe(0.01);
  });

  it("breaks a same-block tie on log index", () => {
    // Two buys land in one Monad block. The earlier log is the first buyer,
    // whichever order the history was read in.
    const crowd = crowdFromSwaps(
      [
        swap({ block: 5, logIndex: 8, trader: "second", price: 0.02 }),
        swap({ block: 5, logIndex: 3, trader: "first", price: 0.01 }),
      ],
      false,
      0.02,
      1,
      NOW,
    );
    expect(crowd.firstBuyer?.wallet).toBe("first");
  });

  it("measures the first buyer's return in the unit a fill is priced in", () => {
    // The bug this covers: comparing a quote-denominated fill price against a
    // USD price reported a 113x return on an entry that was flat, because the
    // quote token happened to cost $114.
    const crowd = crowdFromSwaps([swap({ block: 1, price: 0.01 })], false, 0.02, 114, NOW);
    expect(crowd.firstBuyer?.multiple).toBeCloseTo(2, 10);
    expect(crowd.quoteUsdRate).toBe(114);
  });

  it("refuses a multiple it cannot define", () => {
    const crowd = crowdFromSwaps([swap({ block: 1, price: 0 })], false, 0.02, 1, NOW);
    expect(crowd.firstBuyer?.multiple).toBeNull();
  });

  it("nets buys against sells inside each window", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 1, side: "buy", quoteAmount: 5, timestamp: new Date(NOW - HOUR).toISOString() }),
        swap({ block: 2, side: "sell", quoteAmount: 2, timestamp: new Date(NOW - 2 * HOUR).toISOString() }),
        // Outside 24h, inside the week.
        swap({ block: 3, side: "buy", quoteAmount: 9, timestamp: new Date(NOW - 48 * HOUR).toISOString() }),
      ],
      false,
      0.01,
      1,
      NOW,
    );
    expect(crowd.netFlow24h).toBeCloseTo(3, 10);
    expect(crowd.netFlow7d).toBeCloseTo(12, 10);
    expect(crowd.fills24h).toBe(2);
  });

  it("has no first buyer when the window holds only sells", () => {
    const crowd = crowdFromSwaps([swap({ block: 1, side: "sell" })], false, 0.01, 1, NOW);
    expect(crowd.firstBuyer).toBeNull();
    expect(crowd.biggestBuy).toBeNull();
  });

  it("reports the biggest buy and ignores sells for it", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 1, side: "buy", quoteAmount: 3 }),
        swap({ block: 2, side: "sell", quoteAmount: 50 }),
        swap({ block: 3, side: "buy", quoteAmount: 7 }),
      ],
      true,
      0.01,
      1,
      NOW,
    );
    expect(crowd.biggestBuy).toBe(7);
    expect(crowd.partial).toBe(true);
  });

  it("does not count selling-back dust as still holding", () => {
    const crowd = crowdFromSwaps(
      [
        swap({ block: 1, side: "buy", baseAmount: 0.1 + 0.2 }),
        swap({ block: 2, side: "sell", baseAmount: 0.3 }),
      ],
      false,
      0.01,
      1,
      NOW,
    );
    expect(crowd.holdersStill).toBe(0);
  });
});
