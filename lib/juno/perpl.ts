import { BaseError, encodeFunctionData, getAddress, maxUint256, type Address } from "viem";

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
  const base = { owner, walletAusd: Number(walletRaw) / CNS, minimumOpen: Number(minimumRaw) / CNS };

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

export function perpExchange(): Address {
  return getAddress(perpl().exchange);
}
