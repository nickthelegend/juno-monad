import { describe, it, expect } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  type Hex,
  type Log,
} from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "@/lib/juno/abi";
import {
  changeWithin,
  decodeTradeLog,
  priceSeries,
  swapFromTrade,
  totalVolume,
  volumeWithin,
  DAY_MS,
  type PoolSwap,
} from "@/lib/juno/swaps";
import { compareSwaps, mergeSwaps } from "@/lib/juno/swap-store";

/**
 * Trade decoding, against logs built to order.
 *
 * Every buy and sell on the launchpad emits one `Trade` event carrying the
 * side, both amounts and the fee, so decoding is a matter of reading what the
 * contract said. What is worth pinning is everything around that: the scaling
 * into UI units for each quote token, the logs that are *not* trades, and the
 * ordering rules every chart and cost basis depends on — which on an EVM chain
 * is block number, then log index, never array position or wall-clock time.
 */

const LAUNCHPAD = getAddress("0x1111111111111111111111111111111111111111");
const TOKEN = getAddress("0x2222222222222222222222222222222222222222");
const TRADER = getAddress("0x3333333333333333333333333333333333333333");
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const BLOCK_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const WEI = 10n ** 18n;

type TradeFields = {
  token?: `0x${string}`;
  trader?: `0x${string}`;
  isBuy: boolean;
  baseAmount: bigint;
  quoteAmount: bigint;
  fee: bigint;
  /** The curve's square-root price after the trade. Defaults to 2^96 (a raw price of 1). */
  sqrtPriceX96?: bigint;
};

/** Q64.96 square root of a UI price, for building realistic logs. */
function sqrtX96For(uiPrice: number, quoteDecimals: number): bigint {
  const raw = uiPrice * 10 ** (quoteDecimals - 18);
  return BigInt(Math.round(Math.sqrt(raw) * 2 ** 96));
}

const TRADE_EVENT = getAbiItem({ abi: junoLaunchpadAbi, name: "Trade" });

/** A raw `Trade` log exactly as `eth_getLogs` would return it. */
function tradeLog(
  fields: TradeFields,
  where: { blockNumber?: bigint; logIndex?: number | null; txHash?: Hex | null } = {},
): Log {
  const topics = encodeEventTopics({
    abi: junoLaunchpadAbi,
    eventName: "Trade",
    args: { token: fields.token ?? TOKEN, trader: fields.trader ?? TRADER },
  });
  const data = encodeAbiParameters(
    TRADE_EVENT.inputs.filter((input) => !input.indexed),
    [fields.isBuy, fields.baseAmount, fields.quoteAmount, fields.fee, fields.sqrtPriceX96 ?? 2n ** 96n, 123n * WEI],
  );
  return {
    address: LAUNCHPAD,
    blockHash: BLOCK_HASH,
    blockNumber: where.blockNumber ?? 1_234_567n,
    data,
    logIndex: where.logIndex === undefined ? 7 : where.logIndex,
    transactionHash: where.txHash === undefined ? TX : where.txHash,
    transactionIndex: 0,
    removed: false,
    topics: topics as [Hex, ...Hex[]],
  } as Log;
}

const AT = 1_790_000_000; // unix seconds

describe("decodeTradeLog: side and size from the contract's own event", () => {
  it("reads a buy against MON", () => {
    // 4,968.593379 tokens for 0.01 MON, 0.0001 MON of it fee, leaving the
    // curve marked at 0.0000019 MON.
    const swap = decodeTradeLog(
      tradeLog({
        isBuy: true,
        baseAmount: 4_968_593_379n * 10n ** 12n,
        quoteAmount: WEI / 100n,
        fee: WEI / 10_000n,
        sqrtPriceX96: sqrtX96For(0.0000019, 18),
      }),
      18,
      AT,
    );
    expect(swap).not.toBeNull();
    expect(swap!.side).toBe("buy");
    expect(swap!.baseAmount).toBeCloseTo(4968.593379, 9);
    expect(swap!.quoteAmount).toBeCloseTo(0.01, 15);
    expect(swap!.fee).toBeCloseTo(0.0001, 15);
    // The chart's price is the curve's mark after the trade…
    expect(swap!.price / 0.0000019).toBeCloseTo(1, 9);
    // …while the execution price, fee included, is still in the amounts.
    expect(swap!.quoteAmount / swap!.baseAmount).toBeCloseTo(0.01 / 4968.593379, 18);
  });

  it("reads a sell — the case a hardcoded side gets wrong", () => {
    const swap = decodeTradeLog(
      tradeLog({ isBuy: false, baseAmount: 10_000n * WEI, quoteAmount: 19_885_356n * 10n ** 9n, fee: 0n }),
      18,
      AT,
    );
    expect(swap).not.toBeNull();
    expect(swap!.side).toBe("sell");
    expect(swap!.baseAmount).toBe(10_000);
    expect(swap!.quoteAmount).toBeCloseTo(0.019885356, 15);
  });

  it("scales the quote leg by the pool's quote decimals — 6 for USDC", () => {
    const swap = decodeTradeLog(
      tradeLog({
        isBuy: true,
        baseAmount: 500n * WEI,
        quoteAmount: 1_500_000n,
        fee: 15_000n,
        sqrtPriceX96: sqrtX96For(0.0029, 6),
      }),
      6,
      AT,
    );
    expect(swap!.quoteAmount).toBe(1.5);
    expect(swap!.fee).toBe(0.015);
    // Scaled by 6 decimals on the quote side, not 18.
    expect(swap!.price / 0.0029).toBeCloseTo(1, 9);
  });

  it("names the trader and token from the indexed topics, checksummed", () => {
    const swap = decodeTradeLog(
      tradeLog({
        token: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        trader: "0x0123456789abcdef0123456789abcdef01234567",
        isBuy: true,
        baseAmount: WEI,
        quoteAmount: WEI,
        fee: 0n,
      }),
      18,
      AT,
    )!;
    expect(swap.token).toBe(getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"));
    expect(swap.trader).toBe(getAddress("0x0123456789abcdef0123456789abcdef01234567"));
  });

  it("carries the transaction, log index, block and time through unchanged", () => {
    const swap = decodeTradeLog(
      tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }, { blockNumber: 9_876_543n, logIndex: 12 }),
      18,
      AT,
    )!;
    expect(swap.txHash).toBe(TX);
    expect(swap.logIndex).toBe(12);
    expect(swap.id).toBe(`${TX}:12`);
    expect(swap.blockNumber).toBe(9_876_543);
    expect(swap.timestamp).toBe(new Date(AT * 1000).toISOString());
  });

  it("takes the block's time from the log when the RPC includes it", () => {
    const log = { ...tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }), blockTimestamp: BigInt(AT) };
    expect(decodeTradeLog(log, 18)!.timestamp).toBe(new Date(AT * 1000).toISOString());
  });

  it("keeps full precision on a large raw amount", () => {
    // Supply is 1e27 raw. Losing precision here would misreport the size of
    // every trade against a big pool.
    const swap = decodeTradeLog(
      tradeLog({ isBuy: true, baseAmount: 123_456_789_123_456_789_123_456_789n, quoteAmount: 7n, fee: 0n }),
      18,
      AT,
    )!;
    expect(swap.baseAmount).toBeCloseTo(123_456_789.123456789, 6);
    // Seven wei is a real amount, and must not round to nothing.
    expect(swap.quoteAmount).toBe(7e-18);
  });
});

describe("decodeTradeLog: what is not a trade", () => {
  it("ignores the launchpad's other events", () => {
    const topics = encodeEventTopics({ abi: junoLaunchpadAbi, eventName: "CurveCompleted", args: { token: TOKEN } });
    const log = {
      ...tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }),
      topics: topics as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "uint256" }], [10n * WEI]),
    } as Log;
    expect(decodeTradeLog(log, 18, AT)).toBeNull();
  });

  it("ignores an event from a different contract's ABI", () => {
    // An ERC-20 Transfer is not in the launchpad's ABI at all.
    const topics = encodeEventTopics({
      abi: junoTokenAbi,
      eventName: "Transfer",
      args: { from: TRADER, to: LAUNCHPAD },
    });
    const log = {
      ...tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }),
      topics: topics as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "uint256" }], [WEI]),
    } as Log;
    expect(decodeTradeLog(log, 18, AT)).toBeNull();
  });

  it("ignores a log with no topics or garbage data", () => {
    const base = tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n });
    expect(decodeTradeLog({ ...base, topics: [] } as Log, 18, AT)).toBeNull();
    expect(decodeTradeLog({ ...base, data: "0x1234" } as Log, 18, AT)).toBeNull();
  });

  it("refuses a pending log — no index means no identity", () => {
    expect(
      decodeTradeLog(tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }, { logIndex: null }), 18, AT),
    ).toBeNull();
    expect(
      decodeTradeLog(tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }, { txHash: null }), 18, AT),
    ).toBeNull();
  });

  it("refuses a log it cannot place in time rather than dating it 1970", () => {
    expect(decodeTradeLog(tradeLog({ isBuy: true, baseAmount: WEI, quoteAmount: WEI, fee: 0n }), 18)).toBeNull();
  });

  it("rejects a zero leg rather than dividing by it", () => {
    expect(decodeTradeLog(tradeLog({ isBuy: true, baseAmount: 0n, quoteAmount: WEI, fee: 0n }), 18, AT)).toBeNull();
    expect(decodeTradeLog(tradeLog({ isBuy: false, baseAmount: WEI, quoteAmount: 0n, fee: 0n }), 18, AT)).toBeNull();
  });
});

describe("swapFromTrade", () => {
  it("is what the receipt path and the log path both produce", () => {
    // The log helper encodes a post-trade sqrt price of exactly 1.0 (2^96).
    const args = {
      token: TOKEN,
      trader: TRADER,
      isBuy: true,
      baseAmount: 2n * WEI,
      quoteAmount: WEI,
      fee: WEI / 100n,
      sqrtPriceX96: 2n ** 96n,
    };
    const direct = swapFromTrade({ args, txHash: TX, logIndex: 7, blockNumber: 1_234_567n, timestamp: AT, quoteDecimals: 18 });
    const decoded = decodeTradeLog(tradeLog(args), 18, AT);
    expect(direct).toEqual(decoded);
    // The chart's price is the curve's mark after the trade, not the fee-laden
    // execution price (0.5 here) — see PoolSwap.price.
    expect(direct!.price).toBe(1);
  });

  it("accepts number or bigint block numbers and timestamps", () => {
    const args = { token: TOKEN, trader: TRADER, isBuy: false, baseAmount: WEI, quoteAmount: WEI, fee: 0n, sqrtPriceX96: 2n ** 96n };
    const a = swapFromTrade({ args, txHash: TX, logIndex: 0, blockNumber: 5, timestamp: AT, quoteDecimals: 18 });
    const b = swapFromTrade({ args, txHash: TX, logIndex: 0, blockNumber: 5n, timestamp: BigInt(AT), quoteDecimals: 18 });
    expect(a).toEqual(b);
  });
});

/* ------------------------------------------------------------------ */
/* Derived series                                                      */
/* ------------------------------------------------------------------ */

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function swap(
  hoursAgo: number,
  side: "buy" | "sell",
  base: number,
  quote: number,
  blockNumber: number,
  logIndex = 0,
): PoolSwap {
  return {
    id: `0x${blockNumber.toString(16).padStart(64, "0")}:${logIndex}`,
    txHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    logIndex,
    token: TOKEN,
    side,
    baseAmount: base,
    quoteAmount: quote,
    fee: 0,
    price: quote / base,
    trader: TRADER,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    blockNumber,
  };
}

describe("volume", () => {
  const swaps = [
    swap(1, "buy", 100, 1, 300),
    swap(5, "sell", 200, 2, 200),
    swap(30, "buy", 400, 4, 100), // outside a 24h window
  ];

  it("sums only the quote legs inside the window", () => {
    expect(volumeWithin(swaps, DAY_MS, NOW)).toBeCloseTo(3, 12);
  });

  it("sums everything for all-time", () => {
    expect(totalVolume(swaps)).toBeCloseTo(7, 12);
  });

  it("reports null, not zero, when there is no history to measure", () => {
    // A pool nobody has traded and a read that came back empty are different
    // claims. Zero volume asserts the first.
    expect(volumeWithin([], DAY_MS, NOW)).toBeNull();
    expect(totalVolume([])).toBeNull();
  });

  it("reports zero for a real but quiet window", () => {
    expect(volumeWithin([swap(30, "buy", 400, 4, 100)], DAY_MS, NOW)).toBe(0);
  });
});

describe("priceSeries", () => {
  it("orders oldest first by block, whatever order the history arrives in", () => {
    const series = priceSeries([
      swap(1, "buy", 100, 3, 300),
      swap(30, "buy", 100, 1, 100),
      swap(5, "sell", 100, 2, 200),
    ]);
    expect(series.map((p) => p.price)).toEqual([0.01, 0.02, 0.03]);
    expect(series.map((p) => p.side)).toEqual(["buy", "sell", "buy"]);
    expect(series.map((p) => p.volume)).toEqual([1, 2, 3]);
  });

  it("orders trades inside one block by log index, not by timestamp", () => {
    // Monad blocks are ~400ms and a block's trades share one timestamp. The log
    // index is the only thing that says which came first — a sort on time
    // would leave them in whatever order the RPC happened to return.
    const series = priceSeries([
      swap(1, "buy", 100, 3, 500, 9),
      swap(1, "buy", 100, 1, 500, 2),
      swap(1, "buy", 100, 2, 500, 4),
    ]);
    expect(series.map((p) => p.price)).toEqual([0.01, 0.02, 0.03]);
  });

  it("does not mutate the caller's array", () => {
    const input = [swap(1, "buy", 100, 2, 2), swap(2, "buy", 100, 1, 1)];
    const before = input.map((s) => s.id);
    priceSeries(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });

  it("is empty for no swaps rather than inventing a flat line", () => {
    expect(priceSeries([])).toEqual([]);
  });
});

describe("changeWithin", () => {
  it("measures against the last trade before the window opened", () => {
    const swaps = [
      swap(30, "buy", 100, 1, 100), // reference: price 0.01
      swap(2, "buy", 100, 2, 200),
    ];
    expect(changeWithin(swaps, DAY_MS, 0.02, NOW)).toBeCloseTo(1, 12);
  });

  it("picks the later of two same-block references by log index", () => {
    // Both are outside the window and share a block and a timestamp. The one
    // that executed last — higher log index — is the price the window opened on.
    const swaps = [
      swap(30, "buy", 100, 4, 100, 5), // 0.04, executed second
      swap(30, "buy", 100, 1, 100, 1), // 0.01, executed first
    ];
    expect(changeWithin(swaps, DAY_MS, 0.02, NOW)).toBeCloseTo(-0.5, 12);
  });

  it("goes negative when the price fell", () => {
    expect(changeWithin([swap(30, "buy", 100, 2, 100)], DAY_MS, 0.01, NOW)).toBeCloseTo(-0.5, 12);
  });

  it("reports null when nothing predates the window", () => {
    const swaps = [swap(1, "buy", 100, 1, 100), swap(2, "buy", 100, 1, 90)];
    expect(changeWithin(swaps, DAY_MS, 0.01, NOW)).toBeNull();
  });

  it("reports null for no history and for a nonsense current price", () => {
    expect(changeWithin([], DAY_MS, 0.01, NOW)).toBeNull();
    expect(changeWithin([swap(30, "buy", 100, 1, 100)], DAY_MS, 0, NOW)).toBeNull();
  });

  it("reports zero when a real reference exists and the price is unchanged", () => {
    expect(changeWithin([swap(30, "buy", 100, 1, 100)], DAY_MS, 0.01, NOW)).toBe(0);
  });
});

describe("mergeSwaps", () => {
  it("dedupes the receipt path and the log tail by log id, newest first", () => {
    const a = swap(3, "buy", 100, 1, 100, 0);
    const b = swap(2, "buy", 100, 1, 200, 3);
    const c = swap(2, "sell", 100, 1, 200, 1);
    const merged = mergeSwaps([a, b], [b, c]);
    expect(merged.map((s) => s.id)).toEqual([b.id, c.id, a.id]);
  });

  it("lets the fresh read win on a clash", () => {
    const recalled = swap(2, "buy", 100, 1, 200);
    const fresh = { ...recalled, fee: 0.5 };
    expect(mergeSwaps([recalled], [fresh])[0].fee).toBe(0.5);
  });

  it("compareSwaps sorts newest first by block, then log index", () => {
    const list = [swap(1, "buy", 1, 1, 10, 0), swap(1, "buy", 1, 1, 11, 0), swap(1, "buy", 1, 1, 10, 4)];
    expect([...list].sort(compareSwaps).map((s) => [s.blockNumber, s.logIndex])).toEqual([
      [11, 0],
      [10, 4],
      [10, 0],
    ]);
  });
});
