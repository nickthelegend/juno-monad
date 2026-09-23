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
