import { describe, expect, it } from "vitest";

import type { Coin } from "../../juno-expo/lib/api";
import { newestOf, searchMarkets, topCreatorOf, trendingOf } from "../../juno-expo/lib/discover";

/** The desktop rails' lists and the no-wallet profile's example creator. */

function coin(symbol: string, overrides: Partial<Coin> & { wallet?: string } = {}): Coin {
  const { wallet = "0xA", ...rest } = overrides;
  return {
    address: `0x${symbol}`,
    symbol,
    name: symbol,
    createdAt: "2026-10-01T00:00:00.000Z",
    volume24h: null,
    holders: null,
    creator: { handle: wallet, displayName: `creator ${wallet}`, avatarUrl: "", wallet },
    ...rest,
  } as Coin;
}

describe("trendingOf", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

  it("ranks by trades in the last day, then by their value, and leaves out the quiet", () => {
    const posts = [coin("A"), coin("B"), coin("C"), coin("D")];
    const list = trendingOf(
      posts,
      [
        { coin: "0xA", timestamp: at(1), valueUsd: 1 },
        { coin: "0xC", timestamp: at(2), valueUsd: 1 },
        { coin: "0xc", timestamp: at(3), valueUsd: 2 },
        { coin: "0xB", timestamp: at(2), valueUsd: 9 },
        // Older than a day: not trending.
        { coin: "0xD", timestamp: at(30), valueUsd: 100 },
      ],
      now,
    );
    expect(list.map((row) => [row.coin.symbol, row.trades])).toEqual([["C", 2], ["B", 1], ["A", 1]]);
  });

  it("stops at the limit", () => {
    const posts = [1, 2, 3].map((n) => coin(`T${n}`));
    const trades = posts.map((p) => ({ coin: p.address, timestamp: at(1), valueUsd: 1 }));
    expect(trendingOf(posts, trades, now, 2)).toHaveLength(2);
  });
});

describe("newestOf", () => {
  it("puts the latest launch first without reordering the caller's list", () => {
    const posts = [coin("OLD", { createdAt: "2026-10-01T00:00:00Z" }), coin("NEW", { createdAt: "2026-10-07T00:00:00Z" })];
    expect(newestOf(posts).map((c) => c.symbol)).toEqual(["NEW", "OLD"]);
    expect(posts[0].symbol).toBe("OLD");
  });
});

describe("topCreatorOf", () => {
  it("picks the creator with the most posts and adds up their holders", () => {
    const top = topCreatorOf([
      coin("A1", { wallet: "0xA", holders: 3 }),
      coin("B1", { wallet: "0xB", holders: 40 }),
      coin("A2", { wallet: "0xA", holders: null }),
      coin("A3", { wallet: "0xA", holders: 2 }),
    ]);
    expect(top).toMatchObject({ wallet: "0xA", name: "creator 0xA", posts: 3, holders: 5 });
  });

  it("has no example on an empty feed", () => {
    expect(topCreatorOf([])).toBeNull();
  });
});

describe("searchMarkets", () => {
  const coins = [
    coin("KURU", { name: "Graduated to Kuru", wallet: "0xAAA" }),
    coin("SKURUX", { name: "Something", wallet: "0xBBB" }),
    coin("TIDE", { name: "Low tide", wallet: "0xAAA" }),
  ];

  it("ranks an exact ticker over a prefix over a match anywhere, with or without $", () => {
    expect(searchMarkets("$kuru", coins).filter((h) => h.kind === "coin").map((h) => (h.kind === "coin" ? h.coin.symbol : ""))).toEqual(["KURU", "SKURUX"]);
  });

  it("finds a creator by handle and counts their posts", () => {
    const [hit] = searchMarkets("0xaaa", coins).filter((h) => h.kind === "creator");
    expect(hit).toMatchObject({ kind: "creator", wallet: "0xAAA", posts: 2 });
  });

  it("matches nothing on a single character", () => {
    expect(searchMarkets("k", coins)).toEqual([]);
  });
});
