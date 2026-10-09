import "server-only";

import { networkKey } from "./network";
import { db } from "./social";

/**
 * How long each transaction Juno submitted took, broadcast to receipt, kept
 * past the process.
 *
 * The receipt shows the figure the moment a trade lands; a receipt card made
 * later, or after a restart, needs the same measured number, not a new
 * guess. Only the server's own measurement is kept, so the card states
 * nothing a client sent it.
 */

type TimingDoc = { network: string; hash: string; confirmedInMs: number; blockNumber: number; at: Date };

async function timings() {
  const collection = (await db()).collection<TimingDoc>("tx_timings");
  await collection.createIndex({ network: 1, hash: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

export async function rememberTiming(hash: string, confirmedInMs: number, blockNumber: number): Promise<void> {
  if (!Number.isFinite(confirmedInMs) || confirmedInMs < 0) return;
  const doc: TimingDoc = { network: networkKey(), hash: hash.toLowerCase(), confirmedInMs, blockNumber, at: new Date() };
  await (await timings()).updateOne({ network: doc.network, hash: doc.hash }, { $setOnInsert: doc }, { upsert: true });
}

/** The measured broadcast-to-receipt time for a transaction Juno submitted, or null. */
export async function timingOf(hash: string): Promise<number | null> {
  const row = await (await timings()).findOne({ network: networkKey(), hash: hash.toLowerCase() });
  return row?.confirmedInMs ?? null;
}
