import "server-only";

import { decodeEventLog, getAddress, type Hex } from "viem";

import { junoLaunchpadAbi } from "./abi";
import { isMainnet, launchpadAddress } from "./network";

/**
 * Juno's events as the chain commits them — proposed, voted, finalized.
 *
 * Monad reaches consensus on a block in stages, and its WebSocket API says so:
 * `monadNewHeads` delivers each block once per stage with a `commitState`, and
 * `monadLogs` delivers each log tagged with the state of the block it is in.
 * Measured on testnet, a block goes Proposed → Voted in about 80 ms and
 * Voted → Finalized in about 200 more. That is the thing a post's buyers can
 * watch happen: a trade appears the moment its block is proposed and locks in
 * under a third of a second later, with the timings to prove it.
 *
 * One connection per server process, opened on first use and kept. Events are
 * held in a small ring — this is a live tape, not history; `lib/juno/swaps.ts`
 * owns history. Nothing here is persisted and nothing here is guessed: a stage
 * is recorded when the node reports it, with the time it arrived.
 */

export type CommitState = "Proposed" | "Voted" | "Finalized" | "Verified";

const STATES: CommitState[] = ["Proposed", "Voted", "Finalized", "Verified"];

export type LiveEvent = {
  /** `${txHash}:${logIndex}`. */
  id: string;
  kind: "trade" | "launch" | "graduation" | "complete";
  token: string;
  txHash: string;
  blockNumber: number;
  /** For trades. */
  side?: "buy" | "sell";
  trader?: string;
  baseAmount?: string;
  quoteAmount?: string;
  /** The block's furthest stage so far. */
  state: CommitState;
  /** Unix ms each stage arrived, relative stages derive from these. */
  stages: Partial<Record<CommitState, number>>;
};

const MAX_EVENTS = 60;

type LiveState = {
  socket: WebSocket | null;
  connecting: boolean;
  events: LiveEvent[];
  /** blockId → stage timestamps, so a log that arrives late inherits them. */
  blocks: Map<string, Partial<Record<CommitState, number>>>;
  lastMessageAt: number;
  error: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __junoLive: LiveState | undefined;
}

function state(): LiveState {
  globalThis.__junoLive ??= {
    socket: null,
    connecting: false,
    events: [],
    blocks: new Map(),
    lastMessageAt: 0,
    error: null,
  };
  return globalThis.__junoLive;
}

/** Monad's WebSocket endpoint. Override with MONAD_WS_URL for a dedicated one. */
export function wsEndpoint(): string {
  return (
    process.env.MONAD_WS_URL?.trim() ||
    (isMainnet() ? "wss://rpc.monad.xyz" : "wss://testnet-rpc.monad.xyz")
  );
}

function later(a: CommitState, b: CommitState): CommitState {
  return STATES.indexOf(a) >= STATES.indexOf(b) ? a : b;
}

/** Fold one `monadNewHeads` stage into the block table and every event in it. */
export function applyHead(live: LiveState, blockId: string, commit: CommitState, at: number): void {
  const stages = live.blocks.get(blockId) ?? {};
  stages[commit] ??= at;
  live.blocks.set(blockId, stages);
  if (live.blocks.size > 400) {
    const oldest = live.blocks.keys().next().value;
    if (oldest) live.blocks.delete(oldest);
  }
  for (const event of live.events) {
    if ((event as LiveEvent & { blockId?: string }).blockId !== blockId) continue;
    event.stages[commit] ??= at;
    event.state = later(event.state, commit);
  }
}

/** Fold one `monadLogs` notification in. Returns the event it touched, if any. */
export function applyLog(
  live: LiveState,
  log: {
    address: string;
    topics: Hex[];
    data: Hex;
    transactionHash: string;
    logIndex: string;
    blockNumber: string;
    blockId: string;
    commitState: CommitState;
  },
  at: number,
): LiveEvent | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: junoLaunchpadAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  } catch {
    return null;
  }
  const kind =
    decoded.eventName === "Trade"
      ? "trade"
      : decoded.eventName === "Launched"
        ? "launch"
        : decoded.eventName === "Graduated"
          ? "graduation"
          : decoded.eventName === "CurveCompleted"
            ? "complete"
            : null;
  if (!kind) return null;

  const id = `${log.transactionHash}:${Number(log.logIndex)}`;
  let event = live.events.find((existing) => existing.id === id) as (LiveEvent & { blockId?: string }) | undefined;
  if (!event) {
    const args = decoded.args as Record<string, unknown>;
    event = {
      id,
      kind,
      token: getAddress(String(args.token)),
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      state: log.commitState,
      // A log can first arrive at a later stage than Proposed; the block
      // table may already know when the earlier ones happened.
      stages: { ...(live.blocks.get(log.blockId) ?? {}) },
      blockId: log.blockId,
      ...(kind === "trade"
        ? {
            side: args.isBuy ? "buy" : "sell",
            trader: getAddress(String(args.trader)),
            baseAmount: String(args.baseAmount),
            quoteAmount: String(args.quoteAmount),
          }
        : {}),
    } as LiveEvent & { blockId: string };
    live.events.unshift(event);
    if (live.events.length > MAX_EVENTS) live.events.length = MAX_EVENTS;
  }
  event.stages[log.commitState] ??= at;
  event.state = later(event.state, log.commitState);
  return event;
}

/**
 * Open the subscription if it is not open. Safe to call on every request:
 * it returns at once, and a dropped socket is reopened on the next call.
 */
export function ensureLive(): void {
  const live = state();
  const launchpad = launchpadAddress();
  if (!launchpad || live.socket || live.connecting) return;
  if (typeof WebSocket === "undefined") {
    live.error = "This server runtime has no WebSocket client.";
    return;
  }
  live.connecting = true;
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsEndpoint());
  } catch (error) {
    live.connecting = false;
    live.error = error instanceof Error ? error.message : String(error);
    return;
  }
  socket.onopen = () => {
    live.connecting = false;
    live.socket = socket;
    live.error = null;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
    socket.send(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_subscribe", params: ["monadLogs", { address: launchpad }] }),
    );
  };
  socket.onmessage = (message) => {
    const at = Date.now();
    live.lastMessageAt = at;
    let body: { id?: number; error?: { message?: string }; params?: { result?: Record<string, unknown> } };
    try {
      body = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (body.error) {
      live.error = body.error.message ?? "The node refused the subscription.";
      return;
    }
    const result = body.params?.result;
    if (!result || typeof result.commitState !== "string") return;
    const commit = result.commitState as CommitState;
    if (typeof result.transactionHash === "string") {
      applyLog(live, result as Parameters<typeof applyLog>[1], at);
    } else if (typeof result.blockId === "string") {
      applyHead(live, result.blockId, commit, at);
    }
  };
  const drop = (reason: string) => {
    live.socket = null;
    live.connecting = false;
    live.error = reason;
  };
  socket.onerror = () => drop("The Monad WebSocket connection failed.");
  socket.onclose = () => drop("The Monad WebSocket connection closed; it reopens on the next request.");
}

export type LiveSnapshot = {
  connected: boolean;
  endpoint: string;
  /** Null until the first message; lets the app tell "quiet" from "not listening". */
  lastMessageAt: number | null;
  error: string | null;
  events: Array<Omit<LiveEvent, "stages"> & { stages: Partial<Record<CommitState, number>> }>;
};

export function liveSnapshot(filter?: { token?: string; txHash?: string }): LiveSnapshot {
  ensureLive();
  const live = state();
  const token = filter?.token ? getAddress(filter.token) : null;
  const events = live.events
    .filter((event) => (!token || event.token === token) && (!filter?.txHash || event.txHash === filter.txHash))
    .map(({ ...event }) => {
      delete (event as { blockId?: string }).blockId;
      return event;
    });
  return {
    connected: live.socket !== null,
    endpoint: wsEndpoint().replace(/\/\/([^/]*@)/, "//"),
    lastMessageAt: live.lastMessageAt || null,
    error: live.error,
    events,
  };
}

/** For tests: a fresh, unconnected state. */
export function emptyLiveState(): LiveState {
  return { socket: null, connecting: false, events: [], blocks: new Map(), lastMessageAt: 0, error: null };
}
