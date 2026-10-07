import { describe, expect, it } from "vitest";

import { buildInbox, type InboxItem } from "@/lib/juno/inbox";

/**
 * Building a wallet's inbox from what already happened: newest first, never
 * the wallet's own actions, and "unread" meaning newer than its last visit.
 */
const ME = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const ANA = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";

const trade = (id: string, at: string, actor = ANA): InboxItem => ({
  id,
  kind: "trade",
  at,
  actor,
  token: "0x1",
  symbol: "FALLS",
  side: "buy",
  base: 1000,
  quote: 0.1,
  quoteSymbol: "MON",
  txHash: "0xabc",
});

describe("buildInbox", () => {
  it("merges the sources newest first", () => {
    const inbox = buildInbox({
      wallet: ME,
      seenAt: null,
      sources: [
        [trade("t1", "2026-10-07T10:00:00Z")],
        [{ id: "f1", kind: "follow", at: "2026-10-07T12:00:00Z", actor: ANA }],
        [{ id: "c1", kind: "comment", at: "2026-10-07T11:00:00Z", actor: ANA, token: "0x1", symbol: "FALLS", body: "nice" }],
      ],
    });
    expect(inbox.items.map((item) => item.id)).toEqual(["f1", "c1", "t1"]);
    expect(inbox.unread).toBe(3);
  });

  it("never notifies a wallet of its own actions, whatever the address case", () => {
    const inbox = buildInbox({ wallet: ME, seenAt: null, sources: [[trade("t1", "2026-10-07T10:00:00Z", ME.toLowerCase())]] });
    expect(inbox.items).toEqual([]);
  });

  it("counts as unread only what is newer than the last visit", () => {
    const inbox = buildInbox({
      wallet: ME,
      seenAt: "2026-10-07T11:00:00Z",
      sources: [[trade("old", "2026-10-07T10:00:00Z"), trade("new", "2026-10-07T12:00:00Z")]],
    });
    expect(inbox.unread).toBe(1);
    expect(inbox.items).toHaveLength(2);
  });

  it("keeps one copy of an item two sources both produced, drops undated ones, and caps the list", () => {
    const many = Array.from({ length: 80 }, (_, i) => trade(`t${i}`, new Date(Date.UTC(2026, 9, 7, 0, i)).toISOString()));
    const inbox = buildInbox({ wallet: ME, seenAt: null, sources: [many, [many[0]], [trade("bad", "not a date")]], limit: 60 });
    expect(inbox.items).toHaveLength(60);
    expect(inbox.items[0].id).toBe("t79");
    expect(inbox.items.some((item) => item.id === "bad")).toBe(false);
  });
});
