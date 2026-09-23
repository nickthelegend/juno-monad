import { getAddress } from "viem";

import type { PoolSwap } from "./swaps";

/**
 * Reads from Juno's Envio HyperIndex deployment (see `indexer/`).
 *
 * Optional. When `ENVIO_GRAPHQL_URL` is set, trade history comes from the
 * indexer — complete from the launchpad's first block — instead of from the
 * receipt record and the bounded log tail. The indexer stores amounts already
 * scaled to display units, so its rows map straight onto `PoolSwap`.
 */

export function envioConfigured(): boolean {
  return Boolean(process.env.ENVIO_GRAPHQL_URL?.trim());
}

type TradeRow = {
  id: string;
  txHash: string;
  logIndex: number;
  token: string;
  trader: string;
  isBuy: boolean;
  baseAmount: string;
  quoteAmount: string;
  fee: string;
  price: string;
  blockNumber: string;
  timestamp: string;
};

async function query<T>(text: string, variables: Record<string, unknown>): Promise<T> {
  const url = process.env.ENVIO_GRAPHQL_URL!.trim();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Envio answered ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error("Envio returned no data");
  return body.data;
}

function toSwap(row: TradeRow): PoolSwap {
  return {
    id: row.id,
    txHash: row.txHash,
    logIndex: Number(row.logIndex),
    token: getAddress(row.token),
    side: row.isBuy ? "buy" : "sell",
    baseAmount: Number(row.baseAmount),
    quoteAmount: Number(row.quoteAmount),
    fee: Number(row.fee),
    price: Number(row.price),
    trader: getAddress(row.trader),
    timestamp: new Date(Number(row.timestamp) * 1000).toISOString(),
    blockNumber: Number(row.blockNumber),
  };
}

const FIELDS = "id txHash logIndex token trader isBuy baseAmount quoteAmount fee price blockNumber timestamp";

/** Trades for one token or one trader, newest first. */
export async function envioTrades(params: { token?: string; trader?: string; limit?: number }): Promise<PoolSwap[]> {
  const where: Record<string, unknown> = {};
  if (params.token) where.token = { _eq: getAddress(params.token) };
  if (params.trader) where.trader = { _eq: getAddress(params.trader) };
  const data = await query<{ Trade: TradeRow[] }>(
    `query Trades($where: Trade_bool_exp!, $limit: Int!) {
      Trade(where: $where, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) { ${FIELDS} }
    }`,
    { where, limit: params.limit ?? 200 },
  );
  return data.Trade.map(toSwap);
}

/* ------------------------------------------------------------------ */
/* Positions, holders and pool stats                                   */
/* ------------------------------------------------------------------ */

/**
 * The indexer's view of holdings: every JunoToken `Transfer` is indexed, so a
 * position's `balance` is the wallet's real balance — including tokens that
 * arrived by transfer, which trades alone can never see.
 */
type PositionRow = {
  trader: string;
  token: string;
  balance: string;
  netBase: string;
  costBasis: string;
  basisBase: string;
  realizedPnl: string;
  tradeCount: number;
  pool?: { symbol: string; name: string; spotPrice: string; quoteDecimals: number; graduated: boolean };
};

export type IndexedHolder = { wallet: string; balance: number };

/** Every wallet holding `token`, largest first. */
export async function envioHolders(token: string, limit = 100): Promise<IndexedHolder[]> {
  const data = await query<{ Position: PositionRow[] }>(
    `query Holders($token: String!, $limit: Int!) {
      Position(where: { token: { _eq: $token }, balance: { _gt: "0" } }, order_by: { balance: desc }, limit: $limit) {
        trader balance
      }
    }`,
    { token: getAddress(token), limit },
  );
  return data.Position.map((row) => ({ wallet: getAddress(row.trader), balance: Number(row.balance) }));
}

export type IndexedPosition = {
  token: string;
  balance: number;
  /** Quote paid for the tokens still held, average cost. */
  costBasis: number;
  /** Tokens that basis covers — less than `balance` when some arrived by transfer. */
  basisBase: number;
  realizedPnl: number;
  tradeCount: number;
};

/** Every position a wallet has taken, open or closed. */
export async function envioPositions(trader: string): Promise<IndexedPosition[]> {
  const data = await query<{ Position: PositionRow[] }>(
    `query Positions($trader: String!) {
      Position(where: { trader: { _eq: $trader } }, order_by: { balance: desc }, limit: 200) {
        trader token balance netBase costBasis basisBase realizedPnl tradeCount
      }
    }`,
    { trader: getAddress(trader) },
  );
  return data.Position.map((row) => ({
    token: getAddress(row.token),
    balance: Number(row.balance),
    costBasis: Number(row.costBasis),
    basisBase: Number(row.basisBase),
    realizedPnl: Number(row.realizedPnl),
    tradeCount: row.tradeCount,
  }));
}

export type IndexedPoolStats = {
  token: string;
  holderCount: number;
  tradeCount: number;
  /** Quote-token units, all time. */
  volumeQuote: number;
};

/** Holder counts and all-time volume for a set of pools, in one query. */
export async function envioPoolStats(tokens: string[]): Promise<Map<string, IndexedPoolStats>> {
  const out = new Map<string, IndexedPoolStats>();
  if (tokens.length === 0) return out;
  const data = await query<{ Pool: Array<{ id: string; holderCount: number; tradeCount: number; volumeQuote: string }> }>(
    `query Pools($ids: [String!]!) {
      Pool(where: { id: { _in: $ids } }) { id holderCount tradeCount volumeQuote }
    }`,
    { ids: tokens.map((token) => getAddress(token)) },
  );
  for (const row of data.Pool) {
    out.set(getAddress(row.id), {
      token: getAddress(row.id),
      holderCount: row.holderCount,
      tradeCount: row.tradeCount,
      volumeQuote: Number(row.volumeQuote),
    });
  }
  return out;
}

export type IndexerStatus = {
  chainId: number;
  /** The last block the indexer has fully processed. */
  progressBlock: number;
  /** The newest block its source has seen. */
  sourceBlock: number;
  ready: boolean;
};

/** How far behind the chain head the indexer is — so "complete" is a measured claim. */
export async function envioStatus(): Promise<IndexerStatus | null> {
  const data = await query<{ _meta: Array<{ chainId: number; progressBlock: number; sourceBlock: number; isReady: boolean }> }>(
    `{ _meta { chainId progressBlock sourceBlock isReady } }`,
    {},
  );
  const row = data._meta[0];
  if (!row) return null;
  return {
    chainId: row.chainId,
    progressBlock: Number(row.progressBlock),
    sourceBlock: Number(row.sourceBlock),
    ready: row.isReady,
  };
}
