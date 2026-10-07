import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";

import { USDC } from "@/lib/juno/launchpad";
import { isMainnet } from "@/lib/juno/network";
import {
  PYTH_ABI,
  PYTH_FEEDS,
  fetchPythPrice,
  fetchPythPrices,
  feedNameFor,
  isEquityFeed,
  isFresh,
  marketState,
  pythContracts,
  pythUpdateCall,
  quoteTokenUsdPrice,
  type PythFeedName,
} from "@/lib/juno/pyth";
import { publicClient } from "@/lib/juno/client";
import { unlessThrottled } from "../helpers/throttle";

/**
 * Live reads of Pyth's contracts on Monad. Read-only, no key.
 *
 * Two different promises are checked here, because Pyth keeps two different
 * promises on Monad. MON/USD is pushed on a schedule, so it must resolve and it
 * must be current — every dollar figure on a MON-quoted pool depends on it.
 * Equities are *not* pushed to Monad: their on-chain marks can be weeks old,
 * or absent. For those the requirement is honesty, not freshness — a read
 * either resolves with its real age, labelled stale when it is, or comes back
 * null. It never throws, and it never presents an old mark as live.
 */

const MON_USD = PYTH_FEEDS["Crypto.MON/USD"];

/** Plausibility bounds, wide enough to never need touching for market moves. */
const SANE: Record<PythFeedName, [number, number]> = {
  "Crypto.MON/USD": [0.0001, 1_000],
  "Crypto.USDC/USD": [0.5, 1.5],
  "Crypto.ETH/USD": [100, 100_000],
  "Equity.US.AAPL/USD": [10, 10_000],
  "Equity.US.NVDA/USD": [1, 10_000],
  "Equity.US.TSLA/USD": [10, 10_000],
  "Equity.US.MSFT/USD": [10, 10_000],
  "Equity.US.GOOGL/USD": [10, 10_000],
  "Equity.US.AMZN/USD": [10, 10_000],
  "Equity.US.META/USD": [10, 10_000],
  "Equity.US.SPCX/USD": [1, 100_000],
};

describe("pyth: MON/USD on Monad", () => {
  it("resolves through a Pyth contract with a sane price and a current mark", async () => {
    await unlessThrottled("MON/USD", async () => {
      const price = await fetchPythPrice(MON_USD);
      expect(price, "MON/USD did not resolve on any Pyth contract").not.toBeNull();

      expect(price!.feed).toBe(MON_USD);
      expect(feedNameFor(price!.feed)).toBe("Crypto.MON/USD");
      const [low, high] = SANE["Crypto.MON/USD"];
      expect(price!.priceUsd).toBeGreaterThan(low);
      expect(price!.priceUsd).toBeLessThan(high);
      // Confidence is an interval around the price, not a price itself.
      expect(price!.confidence).toBeGreaterThanOrEqual(0);
      expect(price!.confidence).toBeLessThan(price!.priceUsd);
      expect(Number.isFinite(Date.parse(price!.publishedAt))).toBe(true);

      // Pyth's sponsored pushes keep MON/USD current on Monad. A crypto feed
      // minutes old is a publisher problem worth failing on.
      expect(isEquityFeed(price!.feed)).toBe(false);
      expect(isFresh(price!), `MON/USD is ${price!.ageSeconds}s old`).toBe(true);
      expect(marketState(price!)).toBe("live");
      console.info(`MON/USD $${price!.priceUsd} — ${price!.ageSeconds}s old, from ${price!.source}`);
    });
  }, 60_000);

  it("is read from a contract on this chain, not only from Hermes", async () => {
    await unlessThrottled("MON/USD per contract", async () => {
      const readings = await Promise.all(
        pythContracts().map((address) =>
          publicClient()
            .readContract({ address, abi: PYTH_ABI, functionName: "getPriceUnsafe", args: [`0x${MON_USD}`] })
            .catch(() => null),
        ),
      );
      const found = readings.filter((reading) => reading && reading.price > 0n);
      expect(found.length, "no Pyth contract on this chain holds MON/USD").toBeGreaterThan(0);
    });
  }, 60_000);

  it("prices MON in dollars and treats USDC as one", async () => {
    await unlessThrottled("quote token prices", async () => {
      const mon = await quoteTokenUsdPrice(zeroAddress);
      expect(mon).not.toBeNull();
      expect(mon!).toBeGreaterThan(0);
      // USDC is not read off its own feed — a market cap that wobbles because
      // the peg drifted a basis point is noise, not information.
      await expect(quoteTokenUsdPrice(USDC.address)).resolves.toBe(1);
      // An arbitrary ERC-20 has no price Juno can vouch for.
      await expect(quoteTokenUsdPrice("0x1111111111111111111111111111111111111111")).resolves.toBeNull();
    });
  }, 60_000);
});

describe("pyth: equity feeds resolve honestly or not at all", () => {
  const equities = (Object.keys(PYTH_FEEDS) as PythFeedName[]).filter((name) => name.startsWith("Equity."));

  it.each(equities)("%s", async (name) => {
    await unlessThrottled(name, async () => {
      // Never throws: an unreadable feed is null, which the UI renders as "no reference".
      const price = await fetchPythPrice(PYTH_FEEDS[name]);
      if (price === null) {
        console.info(`${name}: no mark on ${isMainnet() ? "mainnet" : "testnet"} — reported as unavailable`);
        return;
      }

      expect(isEquityFeed(price.feed)).toBe(true);
      const [low, high] = SANE[name];
      expect(price.priceUsd).toBeGreaterThan(low);
      expect(price.priceUsd).toBeLessThan(high);
      expect(price.ageSeconds).toBeGreaterThanOrEqual(0);

      // The label must match the age: an old mark is never called live.
      const state = marketState(price);
      if (!isFresh(price)) expect(state).toBe("stale");
      if (state === "live") expect(price.ageSeconds).toBeLessThanOrEqual(120);
      console.info(`${name}: $${price.priceUsd.toFixed(2)} — ${state}, ${Math.round(price.ageSeconds / 3600)}h old`);
    });
  }, 60_000);
});

describe("pyth: ids that are not feeds", () => {
  it("returns null for a well-formed id that was never published, and for garbage", async () => {
    await unlessThrottled("unknown feed", async () => {
      await expect(fetchPythPrice("0".repeat(64))).resolves.toBeNull();
      await expect(fetchPythPrice("not a feed id")).resolves.toBeNull();
      await expect(fetchPythPrice(null)).resolves.toBeNull();
    });
  }, 60_000);

  it("reads several feeds in one call, keyed by id, leaving out what did not resolve", async () => {
    await unlessThrottled("batch", async () => {
      const prices = await fetchPythPrices([MON_USD, `0x${MON_USD}`, "0".repeat(64), null]);
      expect(Object.keys(prices)).toEqual([MON_USD]);
    });
  }, 60_000);
});

describe("pyth: the keeper's update call", () => {
  it("is null without a Hermes key, since there is nothing signed to post", async () => {
    if (process.env.PYTH_API_KEY?.trim()) {
      await unlessThrottled("pythUpdateCall", async () => {
        const call = await pythUpdateCall([PYTH_FEEDS["Equity.US.AAPL/USD"]]);
        expect(call, "Hermes answered nothing with a key set").not.toBeNull();
        expect(call!.data.length).toBeGreaterThan(0);
        expect(call!.fee).toBeGreaterThanOrEqual(0n);
      });
      return;
    }
    await expect(pythUpdateCall([PYTH_FEEDS["Equity.US.AAPL/USD"]])).resolves.toBeNull();
  }, 60_000);
});
