import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { applyHead, applyLog, emptyLiveState } from "@/lib/juno/live";

const TOKEN = "0x7370e4f92166B9fF60B9332B0a268297B2120e7d";
const TRADER = "0x140FED4cE79cd4A6BE114e2650bd73aF895f0DC7";
const TX = `0x${"ab".repeat(32)}` as const;
const BLOCK_ID = `0x${"cd".repeat(32)}`;

function tradeLog(commitState: "Proposed" | "Voted" | "Finalized" | "Verified") {
  const event = getAbiItem({ abi: junoLaunchpadAbi, name: "Trade" });
  return {
    address: "0x49149a233de6E4cD6835971506F47EE5862289c1",
    topics: encodeEventTopics({ abi: junoLaunchpadAbi, eventName: "Trade", args: { token: TOKEN, trader: TRADER } }) as Hex[],
    data: encodeAbiParameters(
      event.inputs.filter((input) => !input.indexed),
      [true, 10n ** 18n, 10n ** 17n, 10n ** 15n, 2n ** 96n, 5n * 10n ** 17n],
    ),
    transactionHash: TX,
    logIndex: "0x1",
    blockNumber: "0x3e18737",
    blockId: BLOCK_ID,
    commitState,
  };
}

describe("live commit states", () => {
  it("records a trade the moment its block is proposed, then each later stage", () => {
    const live = emptyLiveState();
    const event = applyLog(live, tradeLog("Proposed"), 1_000);
    expect(event?.kind).toBe("trade");
    expect(event?.side).toBe("buy");
    expect(event?.state).toBe("Proposed");

    applyHead(live, BLOCK_ID, "Voted", 1_079);
    applyHead(live, BLOCK_ID, "Finalized", 1_293);
    expect(live.events).toHaveLength(1);
    expect(live.events[0].state).toBe("Finalized");
    expect(live.events[0].stages).toEqual({ Proposed: 1_000, Voted: 1_079, Finalized: 1_293 });
  });

  it("never moves a trade backwards when stages arrive out of order", () => {
    const live = emptyLiveState();
    applyLog(live, tradeLog("Finalized"), 2_000);
    applyLog(live, tradeLog("Voted"), 2_010);
    expect(live.events[0].state).toBe("Finalized");
  });

  it("inherits stages the block reached before its log arrived", () => {
    const live = emptyLiveState();
    applyHead(live, BLOCK_ID, "Proposed", 500);
    applyHead(live, BLOCK_ID, "Voted", 580);
    applyLog(live, tradeLog("Voted"), 600);
    expect(live.events[0].stages.Proposed).toBe(500);
    expect(live.events[0].stages.Voted).toBe(580);
  });

  it("ignores logs that are not the launchpad's", () => {
    const live = emptyLiveState();
    const log = { ...tradeLog("Proposed"), topics: [`0x${"00".repeat(32)}`] as Hex[] };
    expect(applyLog(live, log, 1)).toBeNull();
    expect(live.events).toHaveLength(0);
  });
});
