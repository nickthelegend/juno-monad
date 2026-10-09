import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, type Hex, type Log } from "viem";

import { kuruOrderBookAbi } from "@/lib/juno/abi";
import { kuruFillsFromLogs } from "@/lib/juno/swaps";

/**
 * Kuru fills read out of a receipt Juno submitted, as the coin's trades.
 *
 * Without an indexer these were counted and dropped, so a coin that graduated
 * to Kuru had no activity afterwards and the landing's trade count left them
 * out. The logs here are encoded with Kuru's own `Trade` event, so the decoding
 * under test is the one a real receipt goes through.
 */

const MARKET = getAddress("0x4444444444444444444444444444444444444444");
const OTHER_MARKET = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x2222222222222222222222222222222222222222");
const TAKER = getAddress("0x3333333333333333333333333333333333333333");
const MAKER = getAddress("0x6666666666666666666666666666666666666666");
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const BLOCK_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
/** Juno's markets use one precision for size and price (`KuruGraduator`). */
const PRECISION = 10n ** 6n;
const WAD = 10n ** 18n;

const tradeEvent = getAbiItem({ abi: kuruOrderBookAbi, name: "Trade" });

function fill(logIndex: number, args: { isBuy: boolean; priceWad: bigint; filled: bigint; taker?: Hex; market?: Hex }): Log {
  return {
    address: args.market ?? MARKET,
    topics: encodeEventTopics({ abi: [tradeEvent], eventName: "Trade" }) as [Hex],
    data: encodeAbiParameters(tradeEvent.inputs, [
      0,
      MAKER,
      args.isBuy,
      args.priceWad,
      0n,
      args.taker ?? TAKER,
      args.taker ?? TAKER,
      args.filled,
    ]),
    blockHash: BLOCK_HASH,
    blockNumber: 66_000_123n,
    logIndex,
    transactionHash: TX,
    transactionIndex: 0,
    removed: false,
  };
}

const read = (logs: Log[]) =>
  kuruFillsFromLogs(logs, {
    from: TAKER,
    tokenOf: (market) => (market === MARKET ? TOKEN : null),
    sizePrecisionOf: (market) => (market === MARKET ? PRECISION : undefined),
    timestamp: 1_791_400_000n,
  });

describe("kuruFillsFromLogs", () => {
  it("makes one trade of a buy that took two price levels, as the indexer would", () => {
    const [trade, ...rest] = read([
      fill(3, { isBuy: true, priceWad: 2n * 10n ** 15n, filled: 1_000n * PRECISION }),
      fill(4, { isBuy: true, priceWad: 3n * 10n ** 15n, filled: 500n * PRECISION }),
    ]);
    expect(rest).toEqual([]);
    // Gross: 1,000 tokens at 0.002 and 500 at 0.003, for 2 + 1.5 = 3.5 MON.
    expect(trade).toMatchObject({
      id: `${TX}:3`,
      token: TOKEN,
      trader: TAKER,
      side: "buy",
      venue: "kuru",
      price: 0.003,
      blockNumber: 66_000_123,
      timestamp: new Date(1_791_400_000 * 1000).toISOString(),
    });
    // Kuru keeps 0.3% of what a buy receives: tokens. The fee is stated in MON.
    expect(trade.baseAmount).toBeCloseTo(1_500 * 0.997, 9);
    expect(trade.quoteAmount).toBeCloseTo(3.5, 12);
    expect(trade.fee).toBeCloseTo(3.5 * 0.003, 12);
  });

  it("takes a sell's fee out of the MON it received", () => {
    const [trade] = read([fill(7, { isBuy: false, priceWad: WAD / 400n, filled: 2_000n * PRECISION })]);
    expect(trade.side).toBe("sell");
    expect(trade.baseAmount).toBeCloseTo(2_000, 9);
    expect(trade.quoteAmount).toBeCloseTo(5 * 0.997, 12);
    expect(trade.price).toBeCloseTo(0.0025, 12);
  });

  it("keeps only the sender's own fills on Juno's markets", () => {
    expect(
      read([
        // Someone else's order filled in the same transaction.
        fill(1, { isBuy: true, priceWad: WAD, filled: PRECISION, taker: MAKER }),
        // A market that is not one of Juno's coins.
        fill(2, { isBuy: true, priceWad: WAD, filled: PRECISION, market: OTHER_MARKET }),
        // Kuru logs zero-size fills when an order only touches a level.
        fill(3, { isBuy: true, priceWad: WAD, filled: 0n }),
      ]),
    ).toEqual([]);
  });
});
