import { junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { ensureHeartbeat, heartbeatSnapshot } from "@/lib/juno/heartbeat";
import { isMainnet, localFork } from "@/lib/juno/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /heartbeat` — Monad's own blocks moving through consensus, live from
 * its WebSocket (`monadNewHeads`), with the medians of each stage. Read-only,
 * and always Monad's network: `appOnFork` says when this app's own trades
 * run on a local fork instead, so the page can say both.
 */
export async function GET() {
  return junoRead(async () => {
    ensureHeartbeat(isMainnet());
    return junoJson({ ...heartbeatSnapshot(isMainnet()), appOnFork: localFork() });
  });
}
