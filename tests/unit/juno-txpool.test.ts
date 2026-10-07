import { describe, expect, it } from "vitest";

import { readAddressStatus, readStatus } from "@/lib/juno/txpool";

/**
 * Reading Monad's txpool answers, including the ones testnet actually sent on
 * 7 Oct for a hash and an address with nothing in flight.
 */
describe("readStatus", () => {
  it("knows a hash Monad has never seen from a method a node lacks", () => {
    expect(readStatus({ error: { code: -32000, message: "Unknown tx hash" } })).toEqual({ supported: true, status: "unknown" });
    expect(readStatus({ error: { code: -32601, message: "Method not found" } })).toEqual({ supported: false });
    expect(readStatus({ error: { code: -32601, message: "the method txpool_statusByHash does not exist/is not available" } })).toEqual({ supported: false });
  });

  it("reads a status, with a reason when one is given", () => {
    expect(readStatus({ result: { status: "pending" } })).toEqual({ supported: true, status: "pending", reason: null });
    expect(readStatus({ result: { status: "dropped", reason: "nonce too low" } })).toEqual({ supported: true, status: "dropped", reason: "nonce too low" });
    expect(readStatus({ result: "included" })).toEqual({ supported: true, status: "included", reason: null });
  });
});

describe("readAddressStatus", () => {
  it("is empty when testnet says nothing is in flight", () => {
    expect(readAddressStatus({ error: { code: -32000, message: "No transactions" } })).toEqual({ supported: true, inFlight: [] });
  });

  it("lists in-flight transactions by nonce", () => {
    expect(readAddressStatus({ result: { "7": "pending", "5": { status: "queued" } } }).inFlight).toEqual([
      { nonce: 5, status: "queued" },
      { nonce: 7, status: "pending" },
    ]);
  });
});
