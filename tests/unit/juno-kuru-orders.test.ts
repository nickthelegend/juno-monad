import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type TransactionReceipt } from "viem";

import { kuruOrderBookAbi } from "@/lib/juno/abi";

/**
 * Kuru orders remembered from receipts: what lets a wallet see and cancel
 * its resting orders when no indexer is running.
 */

const MARKET = getAddress("0x00000000000000000000000000000000000000c1");
const TOKEN = getAddress("0x00000000000000000000000000000000000000c2");
const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");

const { store } = vi.hoisted(() => ({ store: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/juno/social", () => ({
  db: async () => ({
    collection: () => ({
      createIndex: async () => undefined,
      bulkWrite: async (ops: Array<{ updateOne: { filter: Record<string, unknown>; update: { $setOnInsert: Record<string, unknown> } } }>) => {
        for (const op of ops) {
          const exists = store.some((doc) => Object.entries(op.updateOne.filter).every(([k, v]) => doc[k] === v));
          if (!exists) store.push(op.updateOne.update.$setOnInsert);
        }
      },
      find: (query: Record<string, unknown>) => {
        const rows = store.filter((doc) => Object.entries(query).every(([k, v]) => doc[k] === v));
        const cursor = {
          sort: () => cursor,
          limit: () => cursor,
          toArray: async () => [...rows].sort((a, b) => Number(b.orderId) - Number(a.orderId)),
        };
        return cursor;
      },
    }),
  }),
}));
vi.mock("@/lib/juno/kuru", () => ({ kuruTokenOf: (market: string) => (getAddress(market) === MARKET ? TOKEN : null) }));

function orderCreated(address: string, orderId: number, owner: string) {
  const event = kuruOrderBookAbi.find((item) => item.type === "event" && item.name === "OrderCreated")!;
  return {
    address,
    topics: encodeEventTopics({ abi: kuruOrderBookAbi, eventName: "OrderCreated" }),
    data: encodeAbiParameters((event as { inputs: never }).inputs, [orderId, owner, 1000n, 7930, true] as never),
  };
}

describe("Kuru orders from receipts", () => {
  it("keeps the sender's orders on Juno's markets, once each, newest first", async () => {
    const { recordedKuruOrderIds, rememberKuruOrders } = await import("@/lib/juno/kuru-orders");
    const receipt = {
      transactionHash: "0xabc",
      logs: [
        orderCreated(MARKET, 41, OWNER),
        orderCreated(MARKET, 42, OWNER),
        // Someone else's order in the same transaction, and a market Juno did not open: not kept.
        orderCreated(MARKET, 43, OTHER),
        orderCreated("0x00000000000000000000000000000000000000ff", 44, OWNER),
      ],
    } as unknown as TransactionReceipt;

    expect(await rememberKuruOrders(receipt, OWNER)).toBe(2);
    // The same receipt again (a retried submit) adds nothing.
    await rememberKuruOrders(receipt, OWNER);
    expect(await recordedKuruOrderIds(OWNER, TOKEN)).toEqual([42n, 41n]);
    expect(await recordedKuruOrderIds(OTHER, TOKEN)).toEqual([]);
  });
});
