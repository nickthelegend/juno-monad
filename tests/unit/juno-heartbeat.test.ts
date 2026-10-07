import { describe, expect, it } from "vitest";

import { foldHead, summarize, type HeartbeatTable } from "@/lib/juno/heartbeat";

/**
 * Folding Monad's `monadNewHeads` stream into blocks and their stage times,
 * as the testnet stream sends it: a message per block per stage.
 */
const head = (blockId: string, number: number, commitState: string) => ({ blockId, number: `0x${number.toString(16)}`, commitState });

describe("foldHead", () => {
  it("records each stage's arrival once, and the furthest stage reached", () => {
    const table: HeartbeatTable = new Map();
    foldHead(table, head("a", 100, "Proposed"), 1_000);
    foldHead(table, head("a", 100, "Voted"), 1_300);
    foldHead(table, head("a", 100, "Voted"), 1_350);
    foldHead(table, head("a", 100, "Finalized"), 1_600);
    expect(table.get("a")).toMatchObject({ number: 100, state: "Finalized", at: { Proposed: 1_000, Voted: 1_300, Finalized: 1_600 } });
  });

  it("drops the other proposals at a height once one finalizes (Monad sends no abandonment)", () => {
    const table: HeartbeatTable = new Map();
    foldHead(table, head("a", 100, "Proposed"), 1_000);
    foldHead(table, head("b", 100, "Proposed"), 1_010);
    foldHead(table, head("b", 100, "Finalized"), 1_600);
    expect([...table.keys()]).toEqual(["b"]);
  });

  it("ignores anything that is not a staged head", () => {
    const table: HeartbeatTable = new Map();
    expect(foldHead(table, { number: "0x1", hash: "0x0" }, 1)).toBe(false);
    expect(foldHead(table, head("a", 1, "Pending"), 1)).toBe(false);
    expect(table.size).toBe(0);
  });

  it("keeps a bounded window", () => {
    const table: HeartbeatTable = new Map();
    for (let n = 0; n < 100; n++) foldHead(table, head(`id${n}`, n, "Proposed"), n * 300);
    expect(table.size).toBe(48);
  });
});

describe("summarize", () => {
  it("measures each stage from the block's Proposed, and the block time from consecutive heights", () => {
    const table: HeartbeatTable = new Map();
    for (let n = 0; n < 5; n++) {
      const t = 10_000 + n * 300;
      foldHead(table, head(`b${n}`, 200 + n, "Proposed"), t);
      foldHead(table, head(`b${n}`, 200 + n, "Voted"), t + 290 + n * 10);
      foldHead(table, head(`b${n}`, 200 + n, "Finalized"), t + 560);
    }
    const summary = summarize(table, 3);
    expect(summary.blocks.map((block) => block.number)).toEqual([204, 203, 202]);
    expect(summary.votedMs).toBe(310);
    expect(summary.finalizedMs).toBe(560);
    expect(summary.verifiedMs).toBeNull();
    expect(summary.blockMs).toBe(300);
  });
});
