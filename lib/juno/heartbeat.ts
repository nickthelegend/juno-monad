/**
 * Monad's heartbeat: real blocks moving through consensus, live.
 *
 * Monad's WebSocket extension `monadNewHeads` reports every block once per
 * commit stage, with a `blockId` for the proposal and a `commitState`:
 * Proposed (speculatively executed), Voted (one slot later, about 300 ms),
 * Finalized (two slots, about 600 ms) and Verified (the state root agreed,
 * three blocks after that). This follows Monad's own network, read-only,
 * whether or not Juno's trades are on a local fork, so the app can show the
 * chain's real cadence and say where it comes from.
 *
 * The socket opens when someone asks and closes after a minute with nobody
 * asking: no stream is held open for an empty room.
 */

export type CommitStage = "Proposed" | "Voted" | "Finalized" | "Verified";
const STAGES: CommitStage[] = ["Proposed", "Voted", "Finalized", "Verified"];

export type HeartbeatBlock = {
  blockId: string;
  number: number;
  state: CommitStage;
  /** Unix ms each stage arrived. */
  at: Partial<Record<CommitStage, number>>;
};

export type HeartbeatTable = Map<string, HeartbeatBlock>;

const KEEP = 48;

/**
 * Fold one `monadNewHeads` message into the table.
 *
 * A block can skip Voted. No abandonment is ever sent: when a height
 * finalizes, every other proposal seen at that height is dead and is dropped
 * here. Returns false for a message that is not a staged head.
 */
export function foldHead(table: HeartbeatTable, result: Record<string, unknown>, at: number): boolean {
  const stage = result.commitState;
  const blockId = result.blockId;
  const number = typeof result.number === "string" ? Number.parseInt(result.number, 16) : Number.NaN;
  if (typeof stage !== "string" || !STAGES.includes(stage as CommitStage) || typeof blockId !== "string" || !Number.isFinite(number)) {
    return false;
  }
  const block = table.get(blockId) ?? { blockId, number, state: "Proposed" as CommitStage, at: {} };
  block.at[stage as CommitStage] ??= at;
  if (STAGES.indexOf(stage as CommitStage) > STAGES.indexOf(block.state)) block.state = stage as CommitStage;
  table.set(blockId, block);
  if (stage === "Finalized") {
    for (const [id, other] of table) if (other.number === number && id !== blockId) table.delete(id);
  }
  while (table.size > KEEP) {
    const oldest = table.keys().next().value;
    if (oldest === undefined) break;
    table.delete(oldest);
  }
  return true;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

export type HeartbeatSummary = {
  blocks: Array<{ number: number; state: CommitStage; votedMs: number | null; finalizedMs: number | null; verifiedMs: number | null }>;
  /** Medians over the blocks seen, each measured from that block's Proposed. */
  votedMs: number | null;
  finalizedMs: number | null;
  verifiedMs: number | null;
  /** Median gap between consecutive heights being proposed: the block time as observed. */
  blockMs: number | null;
};

/** The newest blocks first, and the medians a viewer reads at a glance. */
export function summarize(table: HeartbeatTable, limit = 16): HeartbeatSummary {
  const since = (block: HeartbeatBlock, stage: CommitStage) =>
    block.at.Proposed !== undefined && block.at[stage] !== undefined ? block.at[stage]! - block.at.Proposed : null;
  const all = [...table.values()].sort((a, b) => b.number - a.number);
  const proposedAt = new Map<number, number>();
  for (const block of all) if (block.at.Proposed !== undefined && !proposedAt.has(block.number)) proposedAt.set(block.number, block.at.Proposed);
  const gaps: number[] = [];
  for (const [number, at] of proposedAt) {
    const previous = proposedAt.get(number - 1);
    if (previous !== undefined && at > previous) gaps.push(at - previous);
  }
  const pick = (stage: CommitStage) => all.map((block) => since(block, stage)).filter((ms): ms is number => ms !== null && ms >= 0);
  return {
    blocks: all.slice(0, limit).map((block) => ({
      number: block.number,
      state: block.state,
      votedMs: since(block, "Voted"),
      finalizedMs: since(block, "Finalized"),
      verifiedMs: since(block, "Verified"),
    })),
    votedMs: median(pick("Voted")),
    finalizedMs: median(pick("Finalized")),
    verifiedMs: median(pick("Verified")),
    blockMs: median(gaps),
  };
}

/* ------------------------------------------------------------------ */
/* The socket                                                          */
/* ------------------------------------------------------------------ */

const IDLE_MS = 60_000;

type Beat = {
  socket: WebSocket | null;
  connecting: boolean;
  table: HeartbeatTable;
  askedAt: number;
  idle: ReturnType<typeof setInterval> | null;
  error: string | null;
};

const shared = globalThis as typeof globalThis & { __junoHeartbeat?: Beat };

function beat(): Beat {
  shared.__junoHeartbeat ??= { socket: null, connecting: false, table: new Map(), askedAt: 0, idle: null, error: null };
  return shared.__junoHeartbeat;
}

/** Monad's own network stream: testnet unless this deployment is on mainnet. */
export function heartbeatEndpoint(mainnet: boolean): string {
  const configured = process.env.MONAD_NETWORK_WS_URL?.trim();
  if (configured) return configured;
  return mainnet ? "wss://rpc.monad.xyz" : "wss://testnet-rpc.monad.xyz";
}

/** Open the stream if it is shut, and note that someone is watching. */
export function ensureHeartbeat(mainnet: boolean, now = Date.now()): void {
  const b = beat();
  b.askedAt = now;
  if (b.socket || b.connecting || typeof WebSocket === "undefined") return;
  b.connecting = true;
  let socket: WebSocket;
  try {
    socket = new WebSocket(heartbeatEndpoint(mainnet));
  } catch (error) {
    b.connecting = false;
    b.error = error instanceof Error ? error.message : String(error);
    return;
  }
  socket.onopen = () => {
    b.connecting = false;
    b.socket = socket;
    b.error = null;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
  };
  socket.onmessage = (message) => {
    let body: { error?: { message?: string }; params?: { result?: Record<string, unknown> } };
    try {
      body = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (body.error) {
      b.error = body.error.message ?? "Monad refused the subscription.";
      return;
    }
    if (body.params?.result) foldHead(b.table, body.params.result, Date.now());
  };
  const drop = (reason: string) => {
    b.socket = null;
    b.connecting = false;
    b.error = reason;
  };
  socket.onerror = () => drop("The Monad WebSocket connection failed.");
  socket.onclose = () => drop("The Monad WebSocket closed; it reopens on the next look.");
  // Close it once nobody has looked for a minute.
  b.idle ??= setInterval(() => {
    if (Date.now() - b.askedAt < IDLE_MS) return;
    b.socket?.close();
    b.socket = null;
    b.table.clear();
    if (b.idle) clearInterval(b.idle);
    b.idle = null;
  }, 10_000);
  (b.idle as { unref?: () => void }).unref?.();
}

export type HeartbeatSnapshot = HeartbeatSummary & {
  network: "monad-testnet" | "monad";
  source: string;
  connected: boolean;
  error: string | null;
};

export function heartbeatSnapshot(mainnet: boolean): HeartbeatSnapshot {
  const b = beat();
  return {
    ...summarize(b.table),
    network: mainnet ? "monad" : "monad-testnet",
    source: heartbeatEndpoint(mainnet),
    connected: b.socket !== null,
    error: b.socket ? null : b.error,
  };
}
