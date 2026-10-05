import { BaseError, encodeFunctionData, getAddress, maxUint256, parseAbi, type Address } from "viem";

import { junoTokenAbi } from "./abi";
import { publicClient } from "./client";
import type { ContractCall } from "./launchpad";
import { isMainnet } from "./network";
import { perplExchangeAbi } from "./perpl-abi";
import { withRetry } from "./rpc";

/**
 * Perps, through Perpl.
 *
 * Kuru is spot only — its "margin" account is a deposit, not leverage — so
 * perpetuals on Monad mean Perpl: an on-chain order book for BTC, ETH, SOL,
 * MON and a few others, isolated margin, AUSD collateral. Juno offers them
 * beside its coins: the same wallet, the same server-built transactions, the
 * same receipt path.
 *
 * Everything here follows `docs/research/research-perpl.md`, which was checked
 * against the live testnet contract. The shape of it:
 *
 * - **Market data** comes from Perpl's public API (`/v1/pub/context`), which
 *   carries each market's mark, oracle, last, 24h change and volume, open
 *   interest and funding. Order sizes and prices are converted with the
 *   contract's own decimals, read from `getPerpetualInfoV2`.
 * - **An account** is opened with `createAccount` (at least 100 AUSD) after an
 *   AUSD approval; later collateral goes in with `depositCollateral`.
 * - **Orders** are immediate-or-cancel `execOrder`s with a worst acceptable
 *   price — a market order with slippage protection. A close is the matching
 *   reduce-only order for the whole position.
 * - **Positions** are read on-chain: the account's position bitmap names the
 *   perps, and `getPositionV2` gives size, entry, collateral and P&L.
 *
 * Perpl refuses to open or grow a position against a mark more than a minute
 * old. Its own keepers keep it fresh on testnet; the app says so when they
 * have not, rather than letting the transaction revert.
 */

type Deployment = { exchange: Address; ausd: Address; api: string };

const DEPLOYMENTS: Record<"testnet" | "mainnet", Deployment> = {
  testnet: {
    exchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    api: "https://testnet.perpl.xyz/api",
  },
  mainnet: {
    exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    api: "https://app.perpl.xyz/api",
  },
};

export function perpl(): Deployment {
  return DEPLOYMENTS[isMainnet() ? "mainnet" : "testnet"];
}

/** AUSD has six decimals: 1 AUSD = 1,000,000 CNS. */
const CNS = 1_000_000;

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

export type PerpMarket = {
  id: number;
  symbol: string;
  /** Whether the market takes new positions. */
  open: boolean;
  /** USD. */
  mark: number;
  oracle: number;
  last: number;
  /** Signed ratio against 24h ago; null without a reference. */
  change24h: number | null;
  volume24hUsd: number;
  openInterestUsd: number;
  /** Funding per interval, as a ratio (0.0004 = 0.04%). Positive: longs pay shorts. */
  fundingRate: number;
  fundingIntervalSec: number;
  /** The most leverage the market allows. */
  maxLeverage: number;
  /** Taker fee, as a ratio. */
  takerFee: number;
  priceDecimals: number;
  lotDecimals: number;
  /** When Perpl's API took the snapshot, ms. */
  at: number;
};

type ContextMarket = {
  id: number;
  symbol: string;
  funding_interval_sec: number;
  config: {
    is_open: boolean;
    price_decimals: number;
    size_decimals: number;
    initial_margin: number;
    maintenance_margin: number;
    taker_fee: number;
  };
  state: {
    at: { b: number; t: number };
    orl: number;
    mrk: number;
    lst: number;
    prv: number;
    dva: string;
    oi: number;
  };
  funding?: { rate: number };
};

let contextCache: { at: number; value: PerpMarket[] } | null = null;

/** Maintenance margin fractions from the API, in hundredths (2500 → 4% of notional). */
const maintenance = new Map<number, number>();

/** Every Perpl market, live. Cached for five seconds: marks move on every block. */
export async function perpMarkets(): Promise<PerpMarket[]> {
  if (contextCache && Date.now() - contextCache.at < 5_000) return contextCache.value;
  const response = await fetch(`${perpl().api}/v1/pub/context`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Perpl answered ${response.status}`);
  const body = (await response.json()) as { markets: ContextMarket[] };
  const value = body.markets.map((market): PerpMarket => {
    maintenance.set(market.id, market.config.maintenance_margin);
    const scale = 10 ** market.config.price_decimals;
    const mark = market.state.mrk / scale;
    const previous = market.state.prv / scale;
    return {
      id: market.id,
      symbol: market.symbol,
      open: market.config.is_open,
      mark,
      oracle: market.state.orl / scale,
      last: market.state.lst / scale,
      change24h: previous > 0 ? (mark - previous) / previous : null,
      volume24hUsd: Number(market.state.dva) / CNS,
      openInterestUsd: (market.state.oi / 10 ** market.config.size_decimals) * mark,
      // The API reports funding in micros per interval.
      fundingRate: (market.funding?.rate ?? 0) / 1_000_000,
      fundingIntervalSec: market.funding_interval_sec,
      maxLeverage: market.config.initial_margin / 100,
      takerFee: market.config.taker_fee / 1_000_000,
      priceDecimals: market.config.price_decimals,
      lotDecimals: market.config.size_decimals,
      at: market.state.at.t,
    };
  });
  contextCache = { at: Date.now(), value };
  return value;
}

/** A perp as the contract has it: decimals, base price and the mark's freshness. */
export type PerpInfo = {
  id: number;
  symbol: string;
  priceDecimals: number;
  lotDecimals: number;
  basePricePNS: bigint;
  markPNS: bigint;
  /** Unix seconds. */
  markTimestamp: number;
  maxAgeSec: number;
};

export async function perpInfo(perpId: number): Promise<PerpInfo> {
  const info = await withRetry(() =>
    publicClient().readContract({
      address: perpl().exchange,
      abi: perplExchangeAbi,
      functionName: "getPerpetualInfoV2",
      args: [BigInt(perpId)],
    }),
  );
  return {
    id: perpId,
    symbol: info.symbol,
    priceDecimals: Number(info.priceDecimals),
    lotDecimals: Number(info.lotDecimals),
    basePricePNS: info.basePricePNS,
    markPNS: info.markPNS,
    markTimestamp: Number(info.markTimestamp),
    maxAgeSec: Number(info.refPriceMaxAgeSec),
  };
}

/* ------------------------------------------------------------------ */
/* Accounts and positions                                              */
/* ------------------------------------------------------------------ */

export type PerpPosition = {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  /** In the market's own units (BTC, MON…). */
  size: number;
  entryPrice: number;
  markPrice: number;
  /** AUSD held against this position. */
  collateral: number;
  /** AUSD, mark-to-market plus funding. */
  pnl: number;
  funding: number;
  /** Where the position is liquidated, USD. */
  liquidationPrice: number | null;
  /** False when Perpl's mark is stale — closes still work, opens do not. */
  markValid: boolean;
};

export type PerpAccount = {
  owner: Address;
  /** Null when this wallet has never opened a Perpl account. */
  accountId: string | null;
  /** Free collateral, AUSD. */
  balance: number;
  /** Held by resting orders, AUSD. */
  locked: number;
  /** AUSD in the wallet itself. */
  walletAusd: number;
  positions: PerpPosition[];
  /** The least AUSD a new account opens with. */
  minimumOpen: number;
  /** True where Agora's AUSD faucet exists (testnet), so the app can offer it. */
  ausdFaucet: boolean;
};

/** The perp ids an account holds a position in, from its four 256-bit banks. */
export function perpIdsFromBanks(banks: readonly [bigint, bigint, bigint, bigint]): number[] {
  const ids: number[] = [];
  const offsets = [0, 253, 509, 765];
  banks.forEach((bank, index) => {
    for (let bit = 0; bit < 256; bit++) {
      // Bits 253-255 of the first bank are account flags, not perps.
      if (index === 0 && bit >= 253) break;
      if ((bank >> BigInt(bit)) & 1n) ids.push(offsets[index] + bit);
    }
  });
  return ids;
}

/** `getAccountByAddr` reverts `AccountDoesNotExist` for a wallet that never deposited. */
function isMissingAccount(error: unknown): boolean {
  if (error instanceof BaseError) {
    const named = error.walk((cause) => (cause as { data?: { errorName?: string } }).data?.errorName === "AccountDoesNotExist");
    if (named) return true;
  }
  return /AccountDoesNotExist|0x03a0e277/.test(String((error as Error)?.message ?? error));
}

export async function perpAccount(owner: Address): Promise<PerpAccount> {
  const client = publicClient();
  const { exchange, ausd } = perpl();
  const [walletRaw, minimumRaw] = await Promise.all([
    withRetry(() => client.readContract({ address: ausd, abi: junoTokenAbi, functionName: "balanceOf", args: [owner] })),
    withRetry(() => client.readContract({ address: exchange, abi: perplExchangeAbi, functionName: "getMinAccountOpenCNS" })),
  ]);
  const base = { owner, walletAusd: Number(walletRaw) / CNS, minimumOpen: Number(minimumRaw) / CNS, ausdFaucet: ausdFaucetAddress() !== null };

  let info;
  try {
    info = await client.readContract({ address: exchange, abi: perplExchangeAbi, functionName: "getAccountByAddr", args: [owner] });
  } catch (error) {
    if (isMissingAccount(error)) return { ...base, accountId: null, balance: 0, locked: 0, positions: [] };
    throw error;
  }

  const ids = perpIdsFromBanks([info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4]);
  const positions = (
    await Promise.all(ids.map((perpId) => readPosition(perpId, info.accountId)))
  ).filter((position): position is PerpPosition => position !== null);

  return {
    ...base,
    accountId: info.accountId.toString(),
    balance: Number(info.balanceCNS) / CNS,
    locked: Number(info.lockedBalanceCNS) / CNS,
    positions,
  };
}


async function readPosition(perpId: number, accountId: bigint): Promise<PerpPosition | null> {
  const client = publicClient();
  const [[position, markPricePNS, markValid], info] = await Promise.all([
    withRetry(() =>
      client.readContract({
        address: perpl().exchange,
        abi: perplExchangeAbi,
        functionName: "getPositionV2",
        args: [BigInt(perpId), accountId],
      }),
    ),
    perpInfo(perpId),
  ]);
  // An empty slot reads back as zeros, which is also "long".
  if (position.lotLNS === 0n) return null;

  const price = (pns: bigint) => Number(pns) / 10 ** info.priceDecimals;
  const size = Number(position.lotLNS) / 10 ** info.lotDecimals;
  const long = Number(position.positionType) === 0;
  // Longs store the entry rounded up, with the remainder in a Q16 residue.
  const residue = Number(position.priceResiduePNSQ16) / 65_536;
  const entryPNS = Number(position.pricePNS) - (long && residue > 0 ? 1 : 0) + residue;
  const entryPrice = entryPNS / 10 ** info.priceDecimals;
  const collateral = Number(position.depositCNS) / CNS;
  const funding = Number(position.premiumPnlCNS) / CNS;

  let liquidationPrice: number | null = null;
  if (!maintenance.has(perpId)) await perpMarkets().catch(() => null);
  const fraction = maintenance.get(perpId) ?? null;
  if (fraction !== null && size > 0) {
    // MMR = notional at entry / (fraction / 100); liq = entry + s × (MMR − deposit − funding) / size.
    const mmr = (entryPrice * size) / (fraction / 100);
    const s = long ? 1 : -1;
    liquidationPrice = entryPrice + (s * (mmr - collateral - funding)) / size;
    if (!(liquidationPrice > 0)) liquidationPrice = null;
  }

  return {
    perpId,
    symbol: info.symbol,
    side: long ? "long" : "short",
    size,
    entryPrice,
    markPrice: price(markPricePNS),
    collateral,
    pnl: Number(position.pnlCNS) / CNS,
    funding,
    liquidationPrice,
    markValid,
  };
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

/** `OrderDescEnum` on-chain, 0-based (the REST API counts from 1). */
const ORDER = { openLong: 0, openShort: 1, closeLong: 2, closeShort: 3 } as const;

export class PerpRejected extends Error {}

/**
 * Collateral into Perpl: a new account (at least the minimum) or a top-up of
 * an existing one, with an AUSD approval first when the allowance is short.
 */
export async function perpDepositCalls(owner: Address, amount: number, hasAccount: boolean): Promise<ContractCall[]> {
  const { exchange, ausd } = perpl();
  const raw = BigInt(Math.floor(amount * CNS));
  if (raw <= 0n) throw new PerpRejected("Deposit more than zero");
  const calls: ContractCall[] = [];
  const allowance = await withRetry(() =>
    publicClient().readContract({ address: ausd, abi: junoTokenAbi, functionName: "allowance", args: [owner, exchange] }),
  );
  if (allowance < raw) {
    calls.push({
      to: ausd,
      data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [exchange, maxUint256] }),
      value: 0n,
      label: "Allowing Perpl to take AUSD",
    });
  }
  calls.push({
    to: exchange,
    data: encodeFunctionData({
      abi: perplExchangeAbi,
      functionName: hasAccount ? "depositCollateral" : "createAccount",
      args: [raw],
    }),
    value: 0n,
    label: hasAccount ? "Adding collateral on Perpl" : "Opening your Perpl account",
  });
  return calls;
}

export function perpWithdrawCall(amount: number): ContractCall {
  return {
    to: perpl().exchange,
    data: encodeFunctionData({
      abi: perplExchangeAbi,
      functionName: "withdrawCollateral",
      args: [BigInt(Math.floor(amount * CNS))],
    }),
    value: 0n,
    label: "Withdrawing from Perpl",
  };
}

type OrderInput = {
  info: PerpInfo;
  type: (typeof ORDER)[keyof typeof ORDER];
  lotLNS: bigint;
  /** The worst price to accept, USD. */
  limitPrice: number;
  leverage: number;
};

function orderCall({ info, type, lotLNS, limitPrice, leverage }: OrderInput, label: string): ContractCall {
  const scale = 10 ** info.priceDecimals;
  // Buys round the limit up and sells down, then clamp into the contract's
  // band [base + 1, base + 2^24 − 1]: 0 is not a "no limit" price here.
  const buying = type === ORDER.openLong || type === ORDER.closeShort;
  let pricePNS = BigInt(buying ? Math.ceil(limitPrice * scale) : Math.floor(limitPrice * scale));
  const low = info.basePricePNS + 1n;
  const high = info.basePricePNS + (1n << 24n) - 1n;
  if (pricePNS < low) pricePNS = low;
  if (pricePNS > high) pricePNS = high;

  return {
    to: perpl().exchange,
    data: encodeFunctionData({
      abi: perplExchangeAbi,
      functionName: "execOrder",
      args: [
        {
          orderDescId: BigInt(Date.now()),
          perpId: BigInt(info.id),
          orderType: type,
          orderId: 0n,
          pricePNS,
          lotLNS,
          expiryBlock: 0n,
          postOnly: false,
          fillOrKill: false,
          // A market order with a worst price: fill what the book has inside
          // it, never rest.
          immediateOrCancel: true,
          maxMatches: 100n,
          leverageHdths: BigInt(Math.round(leverage * 100)),
          lastExecutionBlock: 0n,
          amountCNS: 0n,
          maxNegPnlCollatBPS: 1_000n,
        },
      ],
    }),
    value: 0n,
    label,
  };
}

/**
 * Open (or add to) a position: `collateral` AUSD at `leverage`, so a notional
 * of collateral × leverage at the mark, filled immediately up to `slippage`
 * away from it. Refuses a stale mark, which the contract would revert on.
 */
export async function perpOpenCall(input: {
  perpId: number;
  side: "long" | "short";
  collateral: number;
  leverage: number;
  slippageBps: number;
  /** The market's taker fee as a ratio; a conservative 0.05% when unknown. */
  takerFee?: number;
  nowSec?: number;
}): Promise<{ call: ContractCall; size: number; mark: number; limitPrice: number }> {
  const info = await perpInfo(input.perpId);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (now - info.markTimestamp >= info.maxAgeSec) {
    throw new PerpRejected(
      `Perpl's ${info.symbol} price is ${now - info.markTimestamp}s old, past its ${info.maxAgeSec}s limit, so new positions are paused. Closing still works.`,
    );
  }
  const mark = Number(info.markPNS) / 10 ** info.priceDecimals;
  const slip = input.slippageBps / 10_000;
  /*
   * Size the order so everything it takes fits in `collateral`: the margin
   * is the fill's notional over the leverage, the fill can be up to the
   * slippage away from the mark, and the taker fee comes out of the same
   * balance. Sizing on collateral × leverage exactly left no room for the
   * fee, and Perpl refused to settle it.
   */
  const fee = input.takerFee ?? 0.0005;
  const notional = (input.collateral * input.leverage) / (1 + slip + input.leverage * fee);
  const lotLNS = BigInt(Math.floor((notional / mark) * 10 ** info.lotDecimals));
  if (lotLNS <= 0n) throw new PerpRejected(`That is less than one ${info.symbol} lot. Add collateral or leverage.`);
  const limitPrice = input.side === "long" ? mark * (1 + slip) : mark * (1 - slip);
  return {
    call: orderCall(
      {
        info,
        type: input.side === "long" ? ORDER.openLong : ORDER.openShort,
        lotLNS,
        limitPrice,
        leverage: input.leverage,
      },
      `Opening a ${input.leverage}x ${input.side} on ${info.symbol}`,
    ),
    size: Number(lotLNS) / 10 ** info.lotDecimals,
    mark,
    limitPrice,
  };
}

/** Close a whole position with a reduce-only order, filled immediately up to `slippage` from the mark. */
export async function perpCloseCall(input: {
  perpId: number;
  position: Pick<PerpPosition, "side" | "size">;
  slippageBps: number;
}): Promise<ContractCall> {
  const info = await perpInfo(input.perpId);
  const mark = Number(info.markPNS) / 10 ** info.priceDecimals;
  const slip = input.slippageBps / 10_000;
  const long = input.position.side === "long";
  return orderCall(
    {
      info,
      type: long ? ORDER.closeLong : ORDER.closeShort,
      lotLNS: BigInt(Math.round(input.position.size * 10 ** info.lotDecimals)),
      limitPrice: long ? mark * (1 - slip) : mark * (1 + slip),
      leverage: 1,
    },
    `Closing your ${info.symbol} ${input.position.side}`,
  );
}

/* ------------------------------------------------------------------ */
/* Risk: what each market and each open position is exposed to         */
/* ------------------------------------------------------------------ */

export type MarketRisk = {
  id: number;
  symbol: string;
  mark: number;
  /** Mark against Perpl's oracle, as a ratio: positive means the book trades rich. */
  premium: number | null;
  /** Funding per interval now, as a ratio; positive means longs pay shorts. */
  fundingRate: number;
  /** The same rate held for a year, as a ratio. */
  fundingAnnualized: number;
  /** Each funding payment in the last 24 hours, oldest first (unix ms, ratio). */
  funding24h: Array<{ t: number; rate: number }>;
  /** What the last 24 hours of funding cost a $1,000 long (negative: it was paid). */
  fundingCost24hPer1kLong: number;
  /** Realised volatility of hourly closes over 24 hours, annualised; null with too few candles. */
  volatility: number | null;
  high24h: number | null;
  low24h: number | null;
  openInterestUsd: number;
  volume24hUsd: number;
  maxLeverage: number;
};

export type PositionRisk = {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  notional: number;
  /** Collateral plus unrealised P&L and funding. */
  equity: number;
  /** Notional over equity: the leverage the position runs at now, not at entry. */
  effectiveLeverage: number | null;
  liquidationPrice: number | null;
  /** Signed move from the mark to the liquidation price, as a ratio (−0.25 = a 25% fall). */
  liquidationDistance: number | null;
  /** Equity over the maintenance requirement: liquidated at 1. */
  health: number | null;
  /** What funding at today's rate costs per day (negative: it pays). */
  fundingPerDay: number;
  /** P&L if the mark moves 10% against the position. */
  pnlAt10PctAdverse: number;
};

type FundingPoint = { at: { t: number }; rate: number };
type Candle = { t: number; c: number; h: number; l: number };

let riskCache: { at: number; value: MarketRisk[] } | null = null;

async function perplJson<T>(path: string): Promise<T> {
  const response = await fetch(`${perpl().api}${path}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Perpl answered ${response.status} for ${path.split("/").slice(0, 4).join("/")}`);
  return (await response.json()) as T;
}

/**
 * Every market's risk from Perpl's public data: the live context, each
 * market's funding payments and hourly candles over the last day. Held for a
 * minute — funding is paid every ~43 minutes and the candles are hourly.
 */
export async function perpMarketRisk(nowMs = Date.now()): Promise<MarketRisk[]> {
  if (riskCache && nowMs - riskCache.at < 60_000) return riskCache.value;
  const markets = await perpMarkets();
  const from = nowMs - 24 * 3_600_000;
  const value = await Promise.all(
    markets.map(async (market): Promise<MarketRisk> => {
      const scale = 10 ** market.priceDecimals;
      const [funding, candles] = await Promise.all([
        perplJson<{ d: FundingPoint[] }>(`/v1/market-data/${market.id}/funding/${from}-${nowMs}`).then((r) => r.d),
        perplJson<{ d: Candle[] }>(`/v1/market-data/${market.id}/candles/3600/${from}-${nowMs}`).then((r) => r.d),
      ]);
      // Funding is reported in micros per interval, as in the context.
      const funding24h = funding
        .map((point) => ({ t: point.at.t, rate: point.rate / 1_000_000 }))
        .filter((point) => point.t >= from)
        .sort((a, b) => a.t - b.t);
      const closes = candles.sort((a, b) => a.t - b.t).map((candle) => candle.c / scale);
      const returns = closes.slice(1).map((close, i) => Math.log(close / closes[i])).filter(Number.isFinite);
      const mean = returns.reduce((sum, r) => sum + r, 0) / (returns.length || 1);
      const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
      const intervalsPerYear = (365 * 24 * 3600) / Math.max(1, market.fundingIntervalSec);
      return {
        id: market.id,
        symbol: market.symbol,
        mark: market.mark,
        premium: market.oracle > 0 ? (market.mark - market.oracle) / market.oracle : null,
        fundingRate: market.fundingRate,
        fundingAnnualized: market.fundingRate * intervalsPerYear,
        funding24h,
        fundingCost24hPer1kLong: funding24h.reduce((sum, point) => sum + point.rate, 0) * 1_000,
        volatility: returns.length >= 6 ? Math.sqrt(variance) * Math.sqrt(24 * 365) : null,
        high24h: candles.length ? Math.max(...candles.map((candle) => candle.h)) / scale : null,
        low24h: candles.length ? Math.min(...candles.map((candle) => candle.l)) / scale : null,
        openInterestUsd: market.openInterestUsd,
        volume24hUsd: market.volume24hUsd,
        maxLeverage: market.maxLeverage,
      };
    }),
  );
  riskCache = { at: nowMs, value };
  return value;
}

/** An account's open positions, each measured against its market. */
export function positionRisk(positions: PerpPosition[], markets: MarketRisk[], intervals: Map<number, number>): PositionRisk[] {
  return positions.map((position) => {
    const market = markets.find((m) => m.id === position.perpId);
    const mark = position.markPrice;
    const notional = position.size * mark;
    const equity = position.collateral + position.pnl;
    const long = position.side === "long";
    const fraction = maintenance.get(position.perpId);
    // As in readPosition: the maintenance requirement is the notional at entry over (fraction / 100).
    const requirement = fraction ? (position.entryPrice * position.size) / (fraction / 100) : null;
    const rate = market?.fundingRate ?? 0;
    const perDay = (24 * 3600) / Math.max(1, intervals.get(position.perpId) ?? 3600);
    return {
      perpId: position.perpId,
      symbol: position.symbol,
      side: position.side,
      notional,
      equity,
      effectiveLeverage: equity > 0 ? notional / equity : null,
      liquidationPrice: position.liquidationPrice,
      liquidationDistance: position.liquidationPrice !== null && mark > 0 ? (position.liquidationPrice - mark) / mark : null,
      health: requirement && requirement > 0 ? equity / requirement : null,
      // Positive funding: longs pay, shorts receive.
      fundingPerDay: (long ? -1 : 1) * rate * perDay * notional,
      pnlAt10PctAdverse: position.pnl - 0.1 * notional,
    };
  });
}

/** The risk view: every market, and the owner's positions when an owner is given. */
export async function perpRisk(owner?: Address): Promise<{ markets: MarketRisk[]; positions: PositionRisk[] | null; at: number }> {
  const [markets, account, context] = await Promise.all([
    perpMarketRisk(),
    owner ? perpAccount(owner) : Promise.resolve(null),
    perpMarkets(),
  ]);
  const intervals = new Map(context.map((market) => [market.id, market.fundingIntervalSec]));
  return { markets, positions: account ? positionRisk(account.positions, markets, intervals) : null, at: Date.now() };
}

/* ------------------------------------------------------------------ */
/* Collateral on testnet: Agora's AUSD faucet                          */
/* ------------------------------------------------------------------ */

/**
 * Agora's AUSD faucet on Monad testnet — the same AUSD Perpl takes as
 * collateral. It has no page of its own; anyone may call
 * `requestFunds(recipient)`. Its rules are public views: one drip of
 * `faucetDripAmount` at most every `maxDripFrequency` seconds *across
 * everyone*, and only while the recipient holds under `maxAmountToOwn`.
 * Mainnet AUSD has no faucet.
 */
const AGORA_AUSD_FAUCET: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";

const agoraFaucetAbi = parseAbi([
  "function requestFunds(address recipient)",
  "function faucetDripAmount() view returns (uint256)",
  "function maxDripFrequency() view returns (uint256)",
  "function lastDripTimestamp() view returns (uint256)",
  "function maxAmountToOwn() view returns (uint256)",
]);

export function ausdFaucetAddress(): Address | null {
  return isMainnet() ? null : AGORA_AUSD_FAUCET;
}

/**
 * The faucet call for `owner`, after checking each of the faucet's rules, so
 * a refusal is a sentence before signing rather than a revert after it.
 */
export async function ausdFaucetCall(owner: Address, nowSec = Math.floor(Date.now() / 1000)): Promise<{ call: ContractCall; amount: number }> {
  const faucet = ausdFaucetAddress();
  if (!faucet) throw new PerpRejected("AUSD has no faucet on mainnet.");
  const { ausd } = perpl();
  const client = publicClient();
  const read = <T>(functionName: "faucetDripAmount" | "maxDripFrequency" | "lastDripTimestamp" | "maxAmountToOwn") =>
    withRetry(() => client.readContract({ address: faucet, abi: agoraFaucetAbi, functionName })) as Promise<T>;
  const [drip, every, last, cap, held, stock] = await Promise.all([
    read<bigint>("faucetDripAmount"),
    read<bigint>("maxDripFrequency"),
    read<bigint>("lastDripTimestamp"),
    read<bigint>("maxAmountToOwn"),
    withRetry(() => client.readContract({ address: ausd, abi: junoTokenAbi, functionName: "balanceOf", args: [owner] })),
    withRetry(() => client.readContract({ address: ausd, abi: junoTokenAbi, functionName: "balanceOf", args: [faucet] })),
  ]);
  const amount = Number(drip) / CNS;
  if (stock < drip) throw new PerpRejected("Agora's AUSD faucet is empty right now.");
  if (held + drip > cap) {
    throw new PerpRejected(
      `This wallet holds ${(Number(held) / CNS).toLocaleString("en-US")} AUSD; Agora's faucet only tops wallets up to ${(Number(cap) / CNS).toLocaleString("en-US")}.`,
    );
  }
  const wait = Number(last + every) - nowSec;
  if (wait > 0) {
    throw new PerpRejected(
      `Agora's faucet sends once every ${every} seconds across everyone. Try again in ${wait} second${wait === 1 ? "" : "s"}.`,
    );
  }
  return {
    amount,
    call: {
      to: faucet,
      data: encodeFunctionData({ abi: agoraFaucetAbi, functionName: "requestFunds", args: [owner] }),
      value: 0n,
      label: `Getting ${amount.toLocaleString("en-US")} AUSD from Agora's faucet`,
    },
  };
}

export function perpExchange(): Address {
  return getAddress(perpl().exchange);
}
