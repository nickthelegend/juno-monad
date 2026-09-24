import { indexer, type Entity, type EvmOnEventContext } from "envio";

import {
  BASE_DECIMALS,
  ZERO,
  ZERO_ADDRESS,
  kuruFill,
  kuruTakerLeg,
  sellAgainstBasis,
  splitFee,
  spotPrice,
  toRaw,
  toUnits,
  tradePrice,
} from "./math";
import { quoteDecimals } from "./quotes";

/**
 * Juno launchpad handlers.
 *
 * `JunoLaunchpad` emits the market: launches, trades, completion, graduation,
 * fee claims and admin changes. Every token it launches is registered as a
 * `JunoToken` so its transfers are indexed too, which is what gives positions a
 * real balance rather than one inferred from trades.
 *
 * Handlers run twice per event (Envio's preload phase, then in order), so they
 * load everything they need up front and only write in the ordered run.
 */

type Context = EvmOnEventContext;
type Launchpad = Entity<"Launchpad">;
type QuoteToken = Entity<"QuoteToken">;
type Account = Entity<"Account">;
type Position = Entity<"Position">;

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const positionId = (trader: string, token: string) => `${trader}-${token}`;

/* ------------------------------------------------------------------ */
/* Defaults for rows seen for the first time                          */
/* ------------------------------------------------------------------ */

function newLaunchpad(id: string): Launchpad {
  return {
    id,
    graduator: undefined,
    protocolShareBps: 0,
    poolCount: 0,
    tradeCount: 0,
    completedCount: 0,
    graduatedCount: 0,
  };
}

function newQuoteToken(id: string, decimals: number): QuoteToken {
  return {
    id,
    decimals,
    allowed: false,
    poolCount: 0,
    tradeCount: 0,
    volume: ZERO,
    fees: ZERO,
    protocolFeesAccrued: ZERO,
    protocolFeesClaimed: ZERO,
  };
}

function newAccount(id: string, at: bigint, block: bigint): Account {
  return {
    id,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    poolsTraded: 0,
    launchCount: 0,
    firstSeenAt: at,
    firstSeenBlock: block,
    lastTradeAt: undefined,
  };
}

function newPosition(trader: string, token: string, at: bigint): Position {
  return {
    id: positionId(trader, token),
    trader,
    token,
    account_id: trader,
    pool_id: token,
    balance: ZERO,
    netBase: ZERO,
    boughtBase: ZERO,
    soldBase: ZERO,
    spentQuote: ZERO,
    receivedQuote: ZERO,
    feesPaid: ZERO,
    basisBase: ZERO,
    costBasis: ZERO,
    realizedPnl: ZERO,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    firstTradeAt: undefined,
    lastTradeAt: undefined,
    updatedAt: at,
  };
}

async function quoteTokenFor(context: Context, chainId: number, quote: string): Promise<QuoteToken> {
  const existing = await context.QuoteToken.get(quote);
  return existing ?? newQuoteToken(quote, await quoteDecimals(context, chainId, quote));
}

/* ------------------------------------------------------------------ */
/* Positions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Apply one fill to a trader's position and account: counts, fees, and the
 * average-cost basis. Shared by curve trades and Kuru fills, so a position
 * keeps one cost basis across a graduation.
 *
 * `baseRaw` is what the trader's balance gained (buy) or gave up (sell);
 * `quoteRaw` is what they paid (buy, fee included) or received (sell, fee
 * deducted) — the launchpad's `Trade` convention.
 */
function applyFill(
  context: Context,
  fill: {
    position: Position | undefined;
    account: Account | undefined;
    trader: string;
    token: string;
    isBuy: boolean;
    baseRaw: bigint;
    quoteRaw: bigint;
    feeRaw: bigint;
    quoteDecimals: number;
    at: bigint;
    block: bigint;
  },
) {
  const { trader, token, isBuy, at, quoteDecimals: decimals } = fill;
  const base = toUnits(fill.baseRaw, BASE_DECIMALS);
  const quote = toUnits(fill.quoteRaw, decimals);
  const position = fill.position ?? newPosition(trader, token, at);
  const firstTradeInPool = position.tradeCount === 0;
  const acct = fill.account ?? newAccount(trader, at, fill.block);
  context.Account.set({
    ...acct,
    tradeCount: acct.tradeCount + 1,
    buyCount: acct.buyCount + (isBuy ? 1 : 0),
    sellCount: acct.sellCount + (isBuy ? 0 : 1),
    poolsTraded: acct.poolsTraded + (firstTradeInPool ? 1 : 0),
    lastTradeAt: at,
  });

  const traded = {
    ...position,
    tradeCount: position.tradeCount + 1,
    buyCount: position.buyCount + (isBuy ? 1 : 0),
    sellCount: position.sellCount + (isBuy ? 0 : 1),
    feesPaid: position.feesPaid.plus(toUnits(fill.feeRaw, decimals)),
    firstTradeAt: position.firstTradeAt ?? at,
    lastTradeAt: at,
    updatedAt: at,
  };

  if (isBuy) {
    context.Position.set({
      ...traded,
      netBase: position.netBase.plus(base),
      boughtBase: position.boughtBase.plus(base),
      spentQuote: position.spentQuote.plus(quote),
      basisBase: position.basisBase.plus(base),
      costBasis: position.costBasis.plus(quote),
    });
    return;
  }

  const { basis, realizedRaw } = sellAgainstBasis(
    { base: toRaw(position.basisBase, BASE_DECIMALS), cost: toRaw(position.costBasis, decimals) },
    fill.baseRaw,
    fill.quoteRaw,
  );
  context.Position.set({
    ...traded,
    netBase: position.netBase.minus(base),
    soldBase: position.soldBase.plus(base),
    receivedQuote: position.receivedQuote.plus(quote),
    basisBase: toUnits(basis.base, BASE_DECIMALS),
    costBasis: toUnits(basis.cost, decimals),
    realizedPnl: position.realizedPnl.plus(toUnits(realizedRaw, decimals)),
  });
}

/* ------------------------------------------------------------------ */
/* Launch                                                             */
/* ------------------------------------------------------------------ */

// Index every token the launchpad deploys. HyperIndex backfills the creation
// block, so the constructor's mint (emitted before `Launched`) is seen too.
indexer.contractRegister({ contract: "JunoLaunchpad", event: "Launched" }, async ({ event, context }) => {
  context.chain.JunoToken.add(event.params.token);
});

indexer.onEvent({ contract: "JunoLaunchpad", event: "Launched" }, async ({ event, context }) => {
  const { token, creator, quote } = event.params;
  const at = BigInt(event.block.timestamp);
  const block = BigInt(event.block.number);

  const [launchpad, quoteToken, account] = await Promise.all([
    context.Launchpad.get(event.srcAddress),
    quoteTokenFor(context, event.chainId, quote),
    context.Account.get(creator),
  ]);
  const lp = launchpad ?? newLaunchpad(event.srcAddress);
  const decimals = quoteToken.decimals;

  context.Pool.set({
    id: token,
    launchpad: event.srcAddress,
    creator,
    quote,
    quoteToken_id: quote,
    quoteDecimals: decimals,
    preset: Number(event.params.preset),
    name: event.params.name,
    symbol: event.params.symbol,
    uri: event.params.uri,
    venue: event.params.venue,
    kuruMarket_id: undefined,
    lock: event.params.venue,
    protocolShareBps: lp.protocolShareBps,
    sqrtStartPriceX96: event.params.sqrtStartPriceX96,
    sqrtEndPriceX96: event.params.sqrtEndPriceX96,
    curveBase: toUnits(event.params.curveBase, BASE_DECIMALS),
    migrationBase: toUnits(event.params.migrationBase, BASE_DECIMALS),
    migrationQuoteThreshold: toUnits(event.params.migrationQuoteThreshold, decimals),
    launchedAt: at,
    launchBlock: block,
    launchTx: event.transaction.hash,
    sqrtPriceX96: event.params.sqrtStartPriceX96,
    spotPrice: spotPrice(event.params.sqrtStartPriceX96, decimals),
    lastPrice: undefined,
    baseReserve: toUnits(event.params.curveBase, BASE_DECIMALS),
    quoteReserve: ZERO,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    volumeQuote: ZERO,
    feesQuote: ZERO,
    creatorFeesEarned: ZERO,
    creatorFeesClaimed: ZERO,
    holderCount: 0,
    lastTradeAt: undefined,
    complete: false,
    completedAt: undefined,
    graduated: false,
    graduatedAt: undefined,
    graduationTx: undefined,
    liquidity: undefined,
    burned: undefined,
  });

  context.Launchpad.set({ ...lp, poolCount: lp.poolCount + 1 });
  context.QuoteToken.set({ ...quoteToken, poolCount: quoteToken.poolCount + 1 });
  const creatorAccount = account ?? newAccount(creator, at, block);
  context.Account.set({ ...creatorAccount, launchCount: creatorAccount.launchCount + 1 });
});

/* ------------------------------------------------------------------ */
/* Trade                                                              */
/* ------------------------------------------------------------------ */

indexer.onEvent({ contract: "JunoLaunchpad", event: "Trade" }, async ({ event, context }) => {
  const { token, trader, isBuy, baseAmount, quoteAmount, fee, sqrtPriceX96, quoteReserve } = event.params;
  const at = BigInt(event.block.timestamp);
  const block = BigInt(event.block.number);

  const [pool, launchpad, account, existingPosition] = await Promise.all([
    context.Pool.get(token),
    context.Launchpad.get(event.srcAddress),
    context.Account.get(trader),
    context.Position.get(positionId(trader, token)),
  ]);
  if (!pool) {
    // Only possible when start_block is later than the launch. Without the pool
    // the quote's decimals are unknown, and a mis-scaled trade is worse than none.
    context.log.error(`Trade on unindexed pool ${token}: start_block must not be later than the launchpad's deployment`);
    return;
  }
  const quoteToken = await quoteTokenFor(context, event.chainId, pool.quote);

  const decimals = pool.quoteDecimals;
  const base = toUnits(baseAmount, BASE_DECIMALS);
  const quote = toUnits(quoteAmount, decimals);
  const feeUnits = toUnits(fee, decimals);
  // A chart plots the curve's mark after the trade, not the execution price:
  // the execution price includes the fee, so on a fresh launch every first buy
  // would chart as a drop. `executionPrice` keeps the other number.
  const price = spotPrice(sqrtPriceX96, decimals);
  const executionPrice = tradePrice(baseAmount, quoteAmount, decimals);
  const split = splitFee(fee, pool.protocolShareBps);

  context.Trade.set({
    id: `${event.transaction.hash}:${event.logIndex}`,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    blockNumber: block,
    timestamp: at,
    token,
    trader,
    pool_id: token,
    account_id: trader,
    quote: pool.quote,
    isBuy,
    baseAmount: base,
    quoteAmount: quote,
    fee: feeUnits,
    price,
    executionPrice,
    baseAmountRaw: baseAmount,
    quoteAmountRaw: quoteAmount,
    feeRaw: fee,
    sqrtPriceX96,
    quoteReserve: toUnits(quoteReserve, decimals),
  });

  context.Pool.set({
    ...pool,
    sqrtPriceX96,
    spotPrice: spotPrice(sqrtPriceX96, decimals),
    lastPrice: executionPrice,
    baseReserve: isBuy ? pool.baseReserve.minus(base) : pool.baseReserve.plus(base),
    quoteReserve: toUnits(quoteReserve, decimals),
    tradeCount: pool.tradeCount + 1,
    buyCount: pool.buyCount + (isBuy ? 1 : 0),
    sellCount: pool.sellCount + (isBuy ? 0 : 1),
    volumeQuote: pool.volumeQuote.plus(quote),
    feesQuote: pool.feesQuote.plus(feeUnits),
    creatorFeesEarned: pool.creatorFeesEarned.plus(toUnits(split.creator, decimals)),
    lastTradeAt: at,
  });

  context.QuoteToken.set({
    ...quoteToken,
    tradeCount: quoteToken.tradeCount + 1,
    volume: quoteToken.volume.plus(quote),
    fees: quoteToken.fees.plus(feeUnits),
    protocolFeesAccrued: quoteToken.protocolFeesAccrued.plus(toUnits(split.protocol, decimals)),
  });

  const lp = launchpad ?? newLaunchpad(event.srcAddress);
  context.Launchpad.set({ ...lp, tradeCount: lp.tradeCount + 1 });

  applyFill(context, {
    position: existingPosition,
    account,
    trader,
    token,
    isBuy,
    baseRaw: baseAmount,
    quoteRaw: quoteAmount,
    feeRaw: fee,
    quoteDecimals: decimals,
    at,
    block,
  });
});

/* ------------------------------------------------------------------ */
/* Completion and graduation                                          */
/* ------------------------------------------------------------------ */

indexer.onEvent({ contract: "JunoLaunchpad", event: "CurveCompleted" }, async ({ event, context }) => {
  const [pool, launchpad] = await Promise.all([
    context.Pool.get(event.params.token),
    context.Launchpad.get(event.srcAddress),
  ]);
  if (!pool) return;
  context.Pool.set({
    ...pool,
    complete: true,
    completedAt: BigInt(event.block.timestamp),
    quoteReserve: toUnits(event.params.quoteReserve, pool.quoteDecimals),
  });
  const lp = launchpad ?? newLaunchpad(event.srcAddress);
  context.Launchpad.set({ ...lp, completedCount: lp.completedCount + 1 });
});

indexer.onEvent({ contract: "JunoLaunchpad", event: "Graduated" }, async ({ event, context }) => {
  const { token, venue, baseAmount, quoteAmount, liquidity, burned } = event.params;
  const [pool, launchpad] = await Promise.all([context.Pool.get(token), context.Launchpad.get(event.srcAddress)]);
  if (!pool) return;
  const at = BigInt(event.block.timestamp);

  context.Graduation.set({
    id: token,
    pool_id: token,
    token,
    venue,
    baseAmount: toUnits(baseAmount, BASE_DECIMALS),
    quoteAmount: toUnits(quoteAmount, pool.quoteDecimals),
    liquidity,
    burned: toUnits(burned, BASE_DECIMALS),
    txHash: event.transaction.hash,
    blockNumber: BigInt(event.block.number),
    timestamp: at,
  });

  // The curve's reserves have left for the pair; the curve holds nothing now.
  context.Pool.set({
    ...pool,
    venue,
    graduated: true,
    graduatedAt: at,
    graduationTx: event.transaction.hash,
    liquidity,
    burned: toUnits(burned, BASE_DECIMALS),
    baseReserve: ZERO,
    quoteReserve: ZERO,
  });
  const lp = launchpad ?? newLaunchpad(event.srcAddress);
  context.Launchpad.set({ ...lp, graduatedCount: lp.graduatedCount + 1 });
});

/* ------------------------------------------------------------------ */
/* The Kuru venue                                                     */
/* ------------------------------------------------------------------ */

// Index each Kuru market a Juno coin graduates into. Emitted by the graduator
// inside `graduate`, just before the launchpad's own `Graduated`.
indexer.contractRegister({ contract: "KuruGraduator", event: "KuruMarketOpened" }, async ({ event, context }) => {
  context.chain.KuruMarket.add(event.params.market);
});

indexer.onEvent({ contract: "KuruGraduator", event: "KuruMarketOpened" }, async ({ event, context }) => {
  const { token, market, vault, pricePrecision } = event.params;
  const pool = await context.Pool.get(token);
  if (!pool) return;
  context.KuruMarket.set({
    id: market,
    token,
    pool_id: token,
    vault,
    pricePrecision: BigInt(pricePrecision),
    openedAt: BigInt(event.block.timestamp),
    openedBlock: BigInt(event.block.number),
    openedTx: event.transaction.hash,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    volumeQuote: ZERO,
    lastPrice: undefined,
    lastTradeAt: undefined,
  });
  context.Pool.set({ ...pool, kuruMarket_id: market });
});

// One fill. The taker is whoever sent the order — the trader's wallet for an
// order placed on the market directly, which is how Juno places them.
indexer.onEvent({ contract: "KuruMarket", event: "Trade" }, async ({ event, context }) => {
  const { orderId, makerAddress, isBuy, price, takerAddress, filledSize } = event.params;
  if (filledSize === 0n) return;
  const market = await context.KuruMarket.get(event.srcAddress);
  if (!market) return;
  const [position, account] = await Promise.all([
    context.Position.get(positionId(takerAddress, market.token)),
    context.Account.get(takerAddress),
  ]);
  const at = BigInt(event.block.timestamp);
  const fill = kuruFill(filledSize, price, market.pricePrecision);

  context.KuruTrade.set({
    id: `${event.transaction.hash}:${event.logIndex}`,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    blockNumber: BigInt(event.block.number),
    timestamp: at,
    market_id: market.id,
    token: market.token,
    pool_id: market.token,
    trader: takerAddress,
    maker: makerAddress,
    orderId: BigInt(orderId),
    isBuy,
    price: fill.price,
    baseAmount: fill.base,
    quoteAmount: fill.quote,
    filledSizeRaw: filledSize,
    priceRaw: price,
  });
  context.KuruMarket.set({
    ...market,
    tradeCount: market.tradeCount + 1,
    buyCount: market.buyCount + (isBuy ? 1 : 0),
    sellCount: market.sellCount + (isBuy ? 0 : 1),
    volumeQuote: market.volumeQuote.plus(fill.quote),
    lastPrice: fill.price,
    lastTradeAt: at,
  });

  // The same position the curve built, carried across the graduation. Kuru
  // takes its taker fee from what the order receives: tokens on a buy, MON on
  // a sell.
  const leg = kuruTakerLeg(filledSize, price, market.pricePrecision, isBuy);
  applyFill(context, {
    position,
    account,
    trader: takerAddress,
    token: market.token,
    isBuy,
    baseRaw: leg.baseRaw,
    quoteRaw: leg.quoteRaw,
    feeRaw: leg.feeRaw,
    quoteDecimals: 18,
    at,
    block: BigInt(event.block.number),
  });
});

/* ------------------------------------------------------------------ */
/* Fees                                                               */
/* ------------------------------------------------------------------ */

indexer.onEvent(
  { contract: "JunoLaunchpad", event: "CreatorFeesClaimed" },
  async ({ event, context }) => {
    const { token, creator, to, amount } = event.params;
    const pool = await context.Pool.get(token);
    if (!pool) return;
    const units = toUnits(amount, pool.quoteDecimals);

    context.CreatorClaim.set({
      id: `${event.transaction.hash}:${event.logIndex}`,
      pool_id: token,
      token,
      creator,
      to,
      amount: units,
      amountRaw: amount,
      txHash: event.transaction.hash,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });
    context.Pool.set({ ...pool, creatorFeesClaimed: pool.creatorFeesClaimed.plus(units) });
  },
);

indexer.onEvent({ contract: "JunoLaunchpad", event: "ProtocolFeesClaimed" }, async ({ event, context }) => {
  const quoteToken = await quoteTokenFor(context, event.chainId, event.params.quote);
  context.QuoteToken.set({
    ...quoteToken,
    protocolFeesClaimed: quoteToken.protocolFeesClaimed.plus(toUnits(event.params.amount, quoteToken.decimals)),
  });
});

/* ------------------------------------------------------------------ */
/* Admin                                                              */
/* ------------------------------------------------------------------ */

indexer.onEvent({ contract: "JunoLaunchpad", event: "QuoteAllowed" }, async ({ event, context }) => {
  const quoteToken = await quoteTokenFor(context, event.chainId, event.params.quote);
  context.QuoteToken.set({ ...quoteToken, allowed: event.params.allowed });
});

indexer.onEvent({ contract: "JunoLaunchpad", event: "GraduatorSet" }, async ({ event, context }) => {
  const lp = (await context.Launchpad.get(event.srcAddress)) ?? newLaunchpad(event.srcAddress);
  const graduator = sameAddress(event.params.graduator, ZERO_ADDRESS) ? undefined : event.params.graduator;
  context.Launchpad.set({ ...lp, graduator });
});

indexer.onEvent({ contract: "JunoLaunchpad", event: "ProtocolShareSet" }, async ({ event, context }) => {
  const lp = (await context.Launchpad.get(event.srcAddress)) ?? newLaunchpad(event.srcAddress);
  context.Launchpad.set({ ...lp, protocolShareBps: Number(event.params.bps) });
});

/* ------------------------------------------------------------------ */
/* Token transfers: real balances and holder counts                   */
/* ------------------------------------------------------------------ */

indexer.onEvent(
  { contract: "JunoToken", event: "Transfer" },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    if (value === 0n || sameAddress(from, to)) return;
    const token = event.srcAddress;
    const at = BigInt(event.block.timestamp);
    const block = BigInt(event.block.number);

    const [pool, fromPosition, toPosition, fromAccount, toAccount] = await Promise.all([
      context.Pool.get(token),
      context.Position.get(positionId(from, token)),
      context.Position.get(positionId(to, token)),
      context.Account.get(from),
      context.Account.get(to),
    ]);
    // The constructor's mint to the launchpad precedes `Launched`: the curve's
    // own supply is not anybody's position.
    if (!pool) return;

    // The launchpad's inventory, the zero address (mints, burns) and the venue's
    // liquidity (the pair, or Kuru's MarginAccount) are not holders.
    const isHolder = (address: string) =>
      !sameAddress(address, ZERO_ADDRESS) && !sameAddress(address, pool.launchpad) && !sameAddress(address, pool.lock);
    const amount = toUnits(value, BASE_DECIMALS);
    let holderDelta = 0;

    if (isHolder(from)) {
      const position = fromPosition ?? newPosition(from, token, at);
      const balance = position.balance.minus(amount);
      if (position.balance.gt(0) && !balance.gt(0)) holderDelta -= 1;
      context.Position.set({ ...position, balance, updatedAt: at });
      if (!fromAccount) context.Account.set(newAccount(from, at, block));
    }

    if (isHolder(to)) {
      const position = toPosition ?? newPosition(to, token, at);
      const balance = position.balance.plus(amount);
      if (!position.balance.gt(0) && balance.gt(0)) holderDelta += 1;
      context.Position.set({ ...position, balance, updatedAt: at });
      if (!toAccount) context.Account.set(newAccount(to, at, block));
    }

    if (holderDelta !== 0) context.Pool.set({ ...pool, holderCount: pool.holderCount + holderDelta });
  },
);
