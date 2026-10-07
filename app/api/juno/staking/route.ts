import { junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { stakingSnapshot } from "@/lib/juno/staking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /staking?wallet=` — Monad's native staking, live from Monad's own
 * network (the precompile has no code on a fork): the epoch, the validator
 * proposing now, how many are in the consensus set, and which validators the
 * wallet has delegated to. Read-only.
 */
export async function GET(request: Request) {
  return junoRead(async () => junoJson(await stakingSnapshot(new URL(request.url).searchParams.get("wallet"))));
}
