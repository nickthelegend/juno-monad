import { describe, it } from "vitest";
import { TestHelpers, createTestIndexer } from "envio";

import { ratio, sellAgainstBasis, spotPrice, tradePrice } from "../src/math";

const { mockAddresses } = TestHelpers.Addresses;
const [alice, bob, creator, tokenA, tokenB] = mockAddresses as unknown as [string, string, string, `0x${string}`, `0x${string}`];

const TESTNET = 10143;
/**
 * The launchpad address vitest.config.ts puts in ENVIO_JUNO_TESTNET_LAUNCHPAD. Simulated launchpad events
 * default to it, and it keeps the launchpad distinguishable from the zero address.
 */
const LAUNCHPAD = "0x1111111111111111111111111111111111111111";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const Q96 = 1n << 96n;
const CURVE_BASE = 800_000_000n * E18;

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function launched(token: `0x${string}`, quote: `0x${string}`, block: number) {
  return {
    contract: "JunoLaunchpad" as const,
    event: "Launched" as const,
    block: { number: block, timestamp: 1_758_700_000 + block },
    transaction: { hash: tx(block) },
    params: {
      token,
      creator: creator as `0x${string}`,
      quote,
      preset: 1n,
      name: "A post",
      symbol: "POST",
      uri: "ipfs://post",
      // price 1e-9 quote wei per base wei
      sqrtStartPriceX96: Q96 / 31_623n,
      sqrtEndPriceX96: Q96,
      curveBase: CURVE_BASE,
      migrationBase: 150_000_000n * E18,
      migrationQuoteThreshold: 100n * E18,
      venue: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    },
  };
}

function transfer(token: `0x${string}`, from: string, to: string, value: bigint, block: number) {
  return {
    contract: "JunoToken" as const,
    event: "Transfer" as const,
    srcAddress: token,
    block: { number: block, timestamp: 1_758_700_000 + block },
    params: { from: from as `0x${string}`, to: to as `0x${string}`, value },
  };
}

function trade(
  token: `0x${string}`,
  trader: string,
  isBuy: boolean,
  baseAmount: bigint,
  quoteAmount: bigint,
  fee: bigint,
  quoteReserve: bigint,
  block: number,
  logIndex: number,
) {
  return {
    contract: "JunoLaunchpad" as const,
    event: "Trade" as const,
    logIndex,
    block: { number: block, timestamp: 1_758_700_000 + block },
    transaction: { hash: tx(block) },
    params: { token, trader: trader as `0x${string}`, isBuy, baseAmount, quoteAmount, fee, sqrtPriceX96: Q96 / 30_000n, quoteReserve },
  };
}

describe("config", () => {
  it("indexes Monad testnet, and skips mainnet until it is enabled", (t) => {
    const indexer = createTestIndexer();
    t.expect(indexer.chainIds).toEqual([TESTNET]);
  });

  it("reads the launchpad address from the environment", (t) => {
    const indexer = createTestIndexer();
    t.expect(indexer.chains[TESTNET].JunoLaunchpad.addresses).toEqual([LAUNCHPAD]);
  });
});

describe("Trade on a native-MON pool", () => {
  it("scales amounts, prices the fill, and keeps the position and pool in step", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            { contract: "JunoLaunchpad", event: "ProtocolShareSet", block: { number: 100 }, params: { bps: 2_000n } },
            { contract: "JunoLaunchpad", event: "QuoteAllowed", block: { number: 100 }, params: { quote: NATIVE, allowed: true } },
            // The constructor mints the whole supply to the launchpad before `Launched`.
            transfer(tokenA, NATIVE, LAUNCHPAD, 1_000_000_000n * E18, 101),
            launched(tokenA, NATIVE, 101),
            // Buy: 0.5 MON (fee 0.005 included) for 1,000 tokens.
            transfer(tokenA, LAUNCHPAD, alice, 1_000n * E18, 102),
            trade(tokenA, alice, true, 1_000n * E18, E18 / 2n, (5n * E18) / 1_000n, (495n * E18) / 1_000n, 102, 7),
            // Sell 400 tokens for 0.25 MON net of a 0.0025 fee.
            transfer(tokenA, alice, LAUNCHPAD, 400n * E18, 103),
            trade(tokenA, alice, false, 400n * E18, E18 / 4n, (25n * E18) / 10_000n, (2425n * E18) / 10_000n, 103, 3),
            // Alice gives Bob 100 tokens: balances move, trade history doesn't.
            transfer(tokenA, alice, bob, 100n * E18, 104),
          ],
        },
      },
    });

    const buy = await indexer.Trade.getOrThrow(`${tx(102)}:7`);
    t.expect({
      id: buy.id,
      txHash: buy.txHash,
      logIndex: buy.logIndex,
      token: buy.token,
      trader: buy.trader,
      isBuy: buy.isBuy,
      baseAmount: buy.baseAmount.toString(),
      quoteAmount: buy.quoteAmount.toString(),
      fee: buy.fee.toString(),
      price: buy.price.toString(),
      executionPrice: buy.executionPrice.toString(),
      quoteReserve: buy.quoteReserve.toString(),
      blockNumber: buy.blockNumber,
      timestamp: buy.timestamp,
    }).toEqual({
      id: `${tx(102)}:7`,
      txHash: tx(102),
      logIndex: 7,
      token: tokenA,
      trader: alice,
      isBuy: true,
      baseAmount: "1000",
      quoteAmount: "0.5",
      fee: "0.005",
      // The mark after the trade, from the event's sqrt price (Q96 / 30,000 → 1/9e8)…
      price: spotPrice(Q96 / 30_000n, 18).toString(),
      // …and what the trader actually paid per token, fee included.
      executionPrice: "0.0005",
      quoteReserve: "0.495",
      blockNumber: 102n,
      timestamp: 1_758_700_102n,
    });

    const sell = await indexer.Trade.getOrThrow(`${tx(103)}:3`);
    t.expect([sell.isBuy, sell.baseAmount.toString(), sell.quoteAmount.toString(), sell.executionPrice.toString()]).toEqual([
      false,
      "400",
      "0.25",
      "0.000625",
    ]);

    const position = await indexer.Position.getOrThrow(`${alice}-${tokenA}`);
    t.expect({
      balance: position.balance.toString(),
      netBase: position.netBase.toString(),
      boughtBase: position.boughtBase.toString(),
      soldBase: position.soldBase.toString(),
      spentQuote: position.spentQuote.toString(),
      receivedQuote: position.receivedQuote.toString(),
      feesPaid: position.feesPaid.toString(),
      basisBase: position.basisBase.toString(),
      costBasis: position.costBasis.toString(),
      realizedPnl: position.realizedPnl.toString(),
      tradeCount: position.tradeCount,
    }).toEqual({
      balance: "500", // 1000 bought − 400 sold − 100 sent to Bob
      netBase: "600", // trades only
      boughtBase: "1000",
      soldBase: "400",
      spentQuote: "0.5",
      receivedQuote: "0.25",
      feesPaid: "0.0075",
      basisBase: "600",
      costBasis: "0.3", // average cost 0.0005 × 600
      realizedPnl: "0.05", // 0.25 received − 0.2 cost of the 400 sold
      tradeCount: 2,
    });

    // The curve's inventory is not a position: no row for the launchpad (or the zero address).
    t.expect(await indexer.Position.get(`${LAUNCHPAD}-${tokenA}`)).toBeUndefined();
    t.expect(await indexer.Position.get(`${NATIVE}-${tokenA}`)).toBeUndefined();

    const bobPosition = await indexer.Position.getOrThrow(`${bob}-${tokenA}`);
    t.expect([bobPosition.balance.toString(), bobPosition.tradeCount, bobPosition.costBasis.toString()]).toEqual(["100", 0, "0"]);

    const pool = await indexer.Pool.getOrThrow(tokenA);
    t.expect({
      quoteDecimals: pool.quoteDecimals,
      tradeCount: pool.tradeCount,
      buyCount: pool.buyCount,
      sellCount: pool.sellCount,
      volumeQuote: pool.volumeQuote.toString(),
      feesQuote: pool.feesQuote.toString(),
      creatorFeesEarned: pool.creatorFeesEarned.toString(),
      baseReserve: pool.baseReserve.toString(),
      quoteReserve: pool.quoteReserve.toString(),
      lastPrice: pool.lastPrice?.toString(),
      holderCount: pool.holderCount,
      protocolShareBps: pool.protocolShareBps,
    }).toEqual({
      quoteDecimals: 18,
      tradeCount: 2,
      buyCount: 1,
      sellCount: 1,
      volumeQuote: "0.75",
      feesQuote: "0.0075",
      creatorFeesEarned: "0.006", // 80% of 0.0075; the protocol keeps 20%
      baseReserve: "799999400",
      quoteReserve: "0.2425",
      lastPrice: "0.000625",
      holderCount: 2, // Alice and Bob; the launchpad's inventory is not a holder
      protocolShareBps: 2_000,
    });

    const account = await indexer.Account.getOrThrow(alice);
    t.expect([account.tradeCount, account.buyCount, account.sellCount, account.poolsTraded]).toEqual([2, 1, 1, 1]);

    const quote = await indexer.QuoteToken.getOrThrow(NATIVE);
    t.expect([quote.volume.toString(), quote.protocolFeesAccrued.toString(), quote.allowed]).toEqual(["0.75", "0.0015", true]);
  });
});

describe("Trade on a USDC pool", () => {
  it("scales quote amounts by 6 decimals", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            launched(tokenB, USDC_TESTNET, 200),
            transfer(tokenB, LAUNCHPAD, alice, 3_000n * E18, 201),
            // 1.5 USDC for 3,000 tokens.
            trade(tokenB, alice, true, 3_000n * E18, (3n * E6) / 2n, 15_000n, 1_485_000n, 201, 0),
          ],
        },
      },
    });

    const pool = await indexer.Pool.getOrThrow(tokenB);
    t.expect(pool.quoteDecimals).toBe(6);
    t.expect(pool.migrationQuoteThreshold.toString()).toBe("100000000000000"); // 100e18 raw read as 6-decimals quote

    const fill = await indexer.Trade.getOrThrow(`${tx(201)}:0`);
    t.expect([fill.quoteAmount.toString(), fill.fee.toString(), fill.executionPrice.toString(), fill.quoteReserve.toString()]).toEqual([
      "1.5",
      "0.015",
      "0.0005",
      "1.485",
    ]);
  });
});

describe("math", () => {
  it("prices a trade and a curve in display units", (t) => {
    // 1 USDC for 3 tokens, kept to 30 significant digits.
    t.expect(tradePrice(3n * E18, 1_000_000n, 6).toString()).toBe(`0.${"3".repeat(30)}`);
    // sqrtPriceX96 = 2^96 means 1 quote wei per base wei: 1 MON per token, or 1e12 USDC per token.
    t.expect(spotPrice(Q96, 18).toString()).toBe("1");
    t.expect(spotPrice(Q96, 6).toString()).toBe("1000000000000");
    // A young curve's price, exact: (2^96 / 2^15)^2 / 2^192 = 2^-30 MON per token.
    t.expect(spotPrice(Q96 >> 15n, 18).toString()).toBe("9.31322574615478515625e-10");
    t.expect(ratio(1n, 3n).toFixed(10)).toBe("0.3333333333");
  });

  it("releases cost pro rata and ignores tokens sold beyond the tracked basis", (t) => {
    const basis = { base: 1_000n, cost: 500n };
    t.expect(sellAgainstBasis(basis, 400n, 250n)).toEqual({ basis: { base: 600n, cost: 300n }, realizedRaw: 50n });
    // Selling 1,500 against 1,000 tracked: only 1,000 has a cost; a third of the proceeds is left out.
    t.expect(sellAgainstBasis(basis, 1_500n, 900n)).toEqual({ basis: { base: 0n, cost: 0n }, realizedRaw: 100n });
    t.expect(sellAgainstBasis({ base: 0n, cost: 0n }, 10n, 10n).realizedRaw).toBe(0n);
  });
});
