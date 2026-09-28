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

describe("The Kuru venue", () => {
  // The graduator vitest.config.ts puts in ENVIO_JUNO_TESTNET_KURU_GRADUATOR.
  const KURU_GRADUATOR = "0x2222222222222222222222222222222222222222" as const;
  const MARKET = "0x672BceFaE26e8B6699615e507E22902e74c05c97" as const;
  const VAULT = "0xFeF703b08e9d42543A11E96a429e8Bf729d573ED" as const;
  const MARGIN_ACCOUNT = "0xd029C2D98ff85D8F64799017fE00a59B1159CE02" as const;

  // Numbers from a real graduation and two market orders on a Monad testnet fork.
  const kuruTrade = (isBuy: boolean, price: bigint, filledSize: bigint, block: number, logIndex: number) => ({
    contract: "KuruMarket" as const,
    event: "Trade" as const,
    srcAddress: MARKET,
    logIndex,
    block: { number: block, timestamp: 1_758_700_000 + block },
    transaction: { hash: tx(block) },
    params: {
      orderId: 0n,
      makerAddress: VAULT,
      isBuy,
      price,
      updatedSize: 0n,
      takerAddress: bob as `0x${string}`,
      txOrigin: bob as `0x${string}`,
      filledSize,
    },
  });

  it("follows a coin from its curve into its Kuru market", async (t) => {
    const indexer = createTestIndexer();
    t.expect(indexer.chains[TESTNET].KuruGraduator.addresses).toEqual([KURU_GRADUATOR]);

    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            { ...launched(tokenA, NATIVE, 300), params: { ...launched(tokenA, NATIVE, 300).params, venue: MARGIN_ACCOUNT } },
            {
              contract: "KuruGraduator",
              event: "KuruMarketOpened",
              srcAddress: KURU_GRADUATOR,
              logIndex: 10,
              block: { number: 310, timestamp: 1_758_700_310 },
              transaction: { hash: tx(310) },
              params: { token: tokenA, market: MARKET, vault: VAULT, pricePrecision: 1_000_000n },
            },
            {
              contract: "JunoLaunchpad",
              event: "Graduated",
              logIndex: 11,
              block: { number: 310, timestamp: 1_758_700_310 },
              transaction: { hash: tx(310) },
              params: {
                token: tokenA,
                venue: MARKET,
                baseAmount: 150_000_000n * E18,
                quoteAmount: 100n * E18,
                liquidity: 1_000n,
                burned: 0n,
              },
            },
            // The vault's deposit parks the curve's tokens in Kuru's MarginAccount.
            transfer(tokenA, LAUNCHPAD, MARGIN_ACCOUNT, 150_000_000n * E18, 310),
            // A 1 MON market buy, then half of it sold back.
            transfer(tokenA, MARGIN_ACCOUNT, bob, 1_000n * E18, 311),
            kuruTrade(true, 995_019_473_682_833n, 1_005_005_456n, 311, 2),
            kuruTrade(false, 985_167_795_725_577n, 500_995_219n, 312, 4),
          ],
        },
      },
    });

    const pool = await indexer.Pool.getOrThrow(tokenA);
    t.expect([pool.graduated, pool.venue, pool.kuruMarket_id, pool.lock]).toEqual([true, MARKET, MARKET, MARGIN_ACCOUNT]);
    // Bob holds; the MarginAccount holding the vault's tokens does not count.
    t.expect(pool.holderCount).toBe(1);

    const buy = await indexer.KuruTrade.getOrThrow(`${tx(311)}:2`);
    t.expect({
      token: buy.token,
      trader: buy.trader,
      maker: buy.maker,
      isBuy: buy.isBuy,
      price: buy.price.toString(),
      baseAmount: buy.baseAmount.toString(),
      quoteAmount: buy.quoteAmount.toString(),
    }).toEqual({
      token: tokenA,
      trader: bob,
      maker: VAULT,
      isBuy: true,
      price: "0.000995019473682833",
      baseAmount: "1005.005456",
      quoteAmount: "0.999999999877495578536848",
    });

    // Bob's position carries across the graduation: Kuru fills update the same
    // average-cost basis, with Kuru's 0.3% taker fee taken from what he received.
    const position = await indexer.Position.getOrThrow(`${bob}-${tokenA}`);
    t.expect({
      tradeCount: position.tradeCount,
      boughtBase: position.boughtBase.toString(),
      soldBase: position.soldBase.toString(),
      loss: position.realizedPnl.lt(0),
    }).toEqual({ tradeCount: 2, boughtBase: "1001.990439632", soldBase: "500.995219", loss: true });

    const market = await indexer.KuruMarket.getOrThrow(MARKET);
    t.expect({
      token: market.token,
      tradeCount: market.tradeCount,
      buyCount: market.buyCount,
      sellCount: market.sellCount,
      volume: market.volumeQuote.toString(),
      lastPrice: market.lastPrice?.toString(),
    }).toEqual({
      token: tokenA,
      tradeCount: 2,
      buyCount: 1,
      sellCount: 1,
      volume: "1.493564355448778291553211",
      lastPrice: "0.000985167795725577",
    });
  });
});

describe("Kuru limit orders", () => {
  const KURU_GRADUATOR = "0x2222222222222222222222222222222222222222" as const;
  const MARKET = "0x672BceFaE26e8B6699615e507E22902e74c05c97" as const;

  it("follows an order from resting to filled, and a cancel", async (t) => {
    const indexer = createTestIndexer();
    const at = (block: number) => ({ number: block, timestamp: 1_758_700_000 + block });
    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            launched(tokenA, NATIVE, 400),
            {
              contract: "KuruGraduator",
              event: "KuruMarketOpened",
              srcAddress: KURU_GRADUATOR,
              logIndex: 1,
              block: at(401),
              transaction: { hash: tx(401) },
              params: { token: tokenA, market: MARKET, vault: MARKET, pricePrecision: 1_000_000n },
            },
            // Bob bids for 1,000 tokens at 0.000990 MON, and again for 500.
            {
              contract: "KuruMarket",
              event: "OrderCreated",
              srcAddress: MARKET,
              logIndex: 0,
              block: at(402),
              transaction: { hash: tx(402) },
              params: { orderId: 7n, owner: bob as `0x${string}`, size: 1_000_000_000n, price: 990n, isBuy: true },
            },
            {
              contract: "KuruMarket",
              event: "OrderCreated",
              srcAddress: MARKET,
              logIndex: 0,
              block: at(403),
              transaction: { hash: tx(403) },
              params: { orderId: 8n, owner: bob as `0x${string}`, size: 500_000_000n, price: 980n, isBuy: true },
            },
            // Alice sells 400 into the first, then 600: it fills.
            ...[
              [404, 600_000_000n, 400_000_000n],
              [405, 0n, 600_000_000n],
            ].map(([block, updatedSize, filledSize]) => ({
              contract: "KuruMarket" as const,
              event: "Trade" as const,
              srcAddress: MARKET,
              logIndex: 0,
              block: at(block as number),
              transaction: { hash: tx(block as number) },
              params: {
                orderId: 7n,
                makerAddress: bob as `0x${string}`,
                isBuy: false,
                price: 990_000_000_000_000n,
                updatedSize: updatedSize as bigint,
                takerAddress: alice as `0x${string}`,
                txOrigin: alice as `0x${string}`,
                filledSize: filledSize as bigint,
              },
            })),
            {
              contract: "KuruMarket",
              event: "OrdersCanceled",
              srcAddress: MARKET,
              logIndex: 0,
              block: at(406),
              params: { orderId: [8n], owner: bob as `0x${string}` },
            },
          ],
        },
      },
    });

    const filled = await indexer.KuruOrder.getOrThrow(`${MARKET}-7`);
    t.expect([filled.status, filled.size.toString(), filled.remaining.toString(), filled.price.toString()]).toEqual([
      "filled",
      "1000",
      "0",
      "0.00099",
    ]);
    const cancelled = await indexer.KuruOrder.getOrThrow(`${MARKET}-8`);
    t.expect([cancelled.status, cancelled.remaining.toString()]).toEqual(["cancelled", "500"]);
  });
});

describe("A coin that graduated into its Uniswap v2 pair", () => {
  // The pair the launch locked. Juno's token sorts below WMON here, so the
  // coin is token0.
  const PAIR = "0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A" as const;
  const COIN = "0x0000000000000000000000000000000000000aa1" as `0x${string}`;
  const ROUTER = "0x7777777777777777777777777777777777777777";

  const sync = (reserve0: bigint, reserve1: bigint, block: number, logIndex: number) => ({
    contract: "UniswapV2Pair" as const,
    event: "Sync" as const,
    srcAddress: PAIR,
    logIndex,
    block: { number: block, timestamp: 1_758_700_000 + block },
    params: { reserve0, reserve1 },
  });
  const swap = (
    from: string,
    amounts: [bigint, bigint, bigint, bigint],
    to: string,
    block: number,
    logIndex: number,
  ) => ({
    contract: "UniswapV2Pair" as const,
    event: "Swap" as const,
    srcAddress: PAIR,
    logIndex,
    block: { number: block, timestamp: 1_758_700_000 + block },
    transaction: { hash: tx(block), from: from as `0x${string}` },
    params: {
      sender: ROUTER as `0x${string}`,
      amount0In: amounts[0],
      amount1In: amounts[1],
      amount0Out: amounts[2],
      amount1Out: amounts[3],
      to: to as `0x${string}`,
    },
  });

  it("registers the pair at launch and records trades against it, by sender, at the pair's price", async (t) => {
    const indexer = createTestIndexer();
    const launch = launched(COIN, NATIVE, 501);
    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            { ...launch, params: { ...launch.params, venue: PAIR } },
            // Graduation mints the pair: 150M tokens against 100 MON.
            sync(150_000_000n * E18, 100n * E18, 502, 1),
            // Alice buys 1 MON's worth through the router: coin out, MON in.
            sync(149_000_000n * E18, 101n * E18, 503, 4),
            swap(alice, [0n, E18, 1_000_000n * E18, 0n], alice, 503, 5),
            // Then sells 400k back: the pair pays MON to the router, which unwraps it for her.
            sync(149_400_000n * E18, (1007n * E18) / 10n, 504, 2),
            swap(alice, [400_000n * E18, 0n, 0n, (3n * E18) / 10n], ROUTER, 504, 3),
          ],
        },
      },
    });

    t.expect(indexer.chains[TESTNET].UniswapV2Pair.addresses).toEqual([PAIR]);
    const pair = await indexer.V2Pair.getOrThrow(PAIR);
    t.expect([pair.token, pair.coinIsToken0, pair.tradeCount, pair.coinReserveRaw]).toEqual([
      COIN,
      true,
      2,
      149_400_000n * E18,
    ]);

    const buy = await indexer.PairTrade.getOrThrow(`${tx(503)}:5`);
    t.expect({
      trader: buy.trader,
      isBuy: buy.isBuy,
      base: buy.baseAmount.toString(),
      quote: buy.quoteAmount.toString(),
      // The pair's price after the trade: 101 MON / 149M tokens.
      price: buy.price.toString(),
    }).toEqual({
      trader: alice,
      isBuy: true,
      base: "1000000",
      quote: "1",
      price: tradePrice(149_000_000n * E18, 101n * E18, 18).toString(),
    });

    const sell = await indexer.PairTrade.getOrThrow(`${tx(504)}:3`);
    // Attributed to the sender, not to the router the pair paid.
    t.expect([sell.trader, sell.isBuy, sell.baseAmount.toString(), sell.quoteAmount.toString()]).toEqual([
      alice,
      false,
      "400000",
      "0.3",
    ]);

    const position = await indexer.Position.getOrThrow(`${alice}-${COIN}`);
    t.expect({
      boughtBase: position.boughtBase.toString(),
      soldBase: position.soldBase.toString(),
      spentQuote: position.spentQuote.toString(),
      receivedQuote: position.receivedQuote.toString(),
      tradeCount: position.tradeCount,
    }).toEqual({ boughtBase: "1000000", soldBase: "400000", spentQuote: "1", receivedQuote: "0.3", tradeCount: 2 });
  });

  it("does not index Kuru's MarginAccount, which a Kuru-bound launch locks instead", async (t) => {
    const indexer = createTestIndexer();
    const launch = launched(COIN, NATIVE, 601);
    await indexer.process({
      chains: {
        [TESTNET]: {
          simulate: [
            { ...launch, params: { ...launch.params, venue: "0xd029C2D98ff85D8F64799017fE00a59B1159CE02" } },
          ],
        },
      },
    });
    t.expect(indexer.chains[TESTNET].UniswapV2Pair.addresses).toEqual([]);
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
