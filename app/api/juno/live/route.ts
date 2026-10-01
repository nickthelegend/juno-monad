import { isAddress } from "viem";

import { junoError, junoJson, junoOptions } from "@/lib/juno/api";
import { liveSnapshot } from "@/lib/juno/live";
import { launchpadAddress } from "@/lib/juno/network";
import { getPool } from "@/lib/juno/registry";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Juno's events as Monad commits them.
 *
 * `GET ?token=&tx=` → `{ connected, endpoint, lastMessageAt, error, events }`,
 * each event carrying the unix-ms time its block reached each stage —
 * `Proposed`, `Voted`, `Finalized`, `Verified` — as the node reported them
 * over `monadNewHeads` / `monadLogs`.
 *
 * Polled by the app about once a second: a poll works the same on iOS, Android
 * and the web, and the server holds the one WebSocket to the chain rather than
 * every phone opening its own. The first request opens it, so the very first
 * answer may be empty and say `connected: false` — which is the truth.
 */
export async function GET(request: Request) {
  if (!launchpadAddress()) {
    return junoError("The Juno launchpad is not configured on this server.", 503);
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? undefined;
  const tx = url.searchParams.get("tx") ?? undefined;
  if (token && !isAddress(token)) return junoError("token is not a Monad address");
  if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) return junoError("tx is not a transaction hash");
  const snapshot = liveSnapshot({ token, txHash: tx?.toLowerCase() });
  const symbols = new Map(
    await Promise.all([...new Set(snapshot.events.map((event) => event.token))].map(async (address) => [address, await symbolOf(address)] as const)),
  );
  return junoJson({ ...snapshot, events: snapshot.events.map((event) => ({ ...event, symbol: symbols.get(event.token) ?? null })) });
}

/*
 * Each event names its coin, so the tape reads "$GENESIS" for any coin this
 * app lists — not only the ones already in the viewer's feed. A recorded
 * symbol never changes and is kept; a coin not (yet) recorded is asked again
 * after a while, not on every poll. Null means unlisted, and the tape shows
 * the address.
 */
const known = new Map<string, string>();
const unknownUntil = new Map<string, number>();

async function symbolOf(address: string): Promise<string | null> {
  const hit = known.get(address);
  if (hit) return hit;
  if ((unknownUntil.get(address) ?? 0) > Date.now()) return null;
  const row = await getPool(address).catch(() => null);
  if (row?.symbol) {
    known.set(address, row.symbol);
    return row.symbol;
  }
  unknownUntil.set(address, Date.now() + 30_000);
  return null;
}
