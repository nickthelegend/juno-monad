import { useEffect, useRef, useState } from "react";

import { api } from "./api";

/**
 * Juno's events as Monad commits them, from `GET /api/juno/live`.
 *
 * Monad finalises a block in stages and says so: proposed, then voted, then
 * finalized, a few hundred milliseconds apart. The server holds one
 * WebSocket to the chain (`monadNewHeads` / `monadLogs`) and records when each
 * stage arrived; this polls it. A poll works the same on iOS, Android and the
 * web, and a second is quicker than any of the stages people are watching.
 */

export type CommitState = "Proposed" | "Voted" | "Finalized" | "Verified";
export const COMMIT_STAGES: CommitState[] = ["Proposed", "Voted", "Finalized"];

export type LiveEvent = {
  id: string;
  kind: "trade" | "launch" | "graduation" | "complete";
  token: string;
  txHash: string;
  blockNumber: number;
  side?: "buy" | "sell";
  trader?: string;
  /** Raw token units, 18 decimals. */
  baseAmount?: string;
  /** Raw quote units, in the pool's quote decimals. */
  quoteAmount?: string;
  state: CommitState;
  /** Unix ms each stage arrived at the server. */
  stages: Partial<Record<CommitState, number>>;
  /** The coin's symbol when this app lists it; null for an unlisted coin. */
  symbol?: string | null;
};

export type LiveSnapshot = {
  connected: boolean;
  endpoint: string;
  lastMessageAt: number | null;
  error: string | null;
  /**
   * False on a single-node chain (a local fork): each event is final when its
   * block is mined, with no stages between. Absent from older servers: staged.
   */
  staged?: boolean;
  events: LiveEvent[];
};

export function fetchLive(filter: { token?: string; tx?: string } = {}): Promise<LiveSnapshot> {
  const query = new URLSearchParams();
  if (filter.token) query.set("token", filter.token);
  if (filter.tx) query.set("tx", filter.tx);
  const suffix = query.toString();
  return api.get<LiveSnapshot>(`/api/juno/live${suffix ? `?${suffix}` : ""}`, 8_000);
}

/**
 * Poll the live tape while mounted. `until` stops the polling once it returns
 * true — a finality timeline stops as soon as its trade is final.
 */
export function useLive(
  filter: { token?: string; tx?: string } = {},
  options: {
    intervalMs?: number;
    until?: (snapshot: LiveSnapshot) => boolean;
    enabled?: boolean;
    /** Stop polling after this long, whether or not `until` was met. */
    forMs?: number;
  } = {},
): LiveSnapshot | null {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const until = useRef(options.until);
  until.current = options.until;
  const enabled = options.enabled ?? true;
  const interval = options.intervalMs ?? 1_000;
  const forMs = options.forMs ?? Infinity;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stopAt = Date.now() + forMs;
    const tick = async () => {
      const next = await fetchLive(filter).catch(() => null);
      if (!alive) return;
      if (next) setSnapshot(next);
      if (next && until.current?.(next)) return;
      if (Date.now() >= stopAt) return;
      timer = setTimeout(tick, interval);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // The filter is two strings; re-subscribe only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.token, filter.tx, interval, enabled, forMs]);

  return snapshot;
}

/** Milliseconds from the first stage seen to each later one. */
export function stageOffsets(event: LiveEvent): Array<{ stage: CommitState; at: number | null }> {
  const origin = event.stages.Proposed ?? Math.min(...Object.values(event.stages).filter((v): v is number => v !== undefined));
  return COMMIT_STAGES.map((stage) => {
    const at = event.stages[stage];
    return { stage, at: at === undefined || !Number.isFinite(origin) ? null : at - origin };
  });
}
