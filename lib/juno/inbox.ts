/**
 * A wallet's notifications, assembled from what already happened.
 *
 * Nothing here is a separate event stream that could drift from the record.
 * Each item is a row that exists anyway:
 * - a fill on a coin the wallet launched (`juno_swaps`);
 * - a follow (`juno_follows`);
 * - a comment or a like on its coins (Mongo);
 * - a price alert on a watched coin that has crossed, timed from when Juno
 *   first saw it cross;
 * - a recurring buy that has fallen due.
 *
 * The wallet's own actions are never notifications. "Unread" is everything
 * newer than the last time the wallet opened its inbox.
 */

export type InboxItem =
  | {
      id: string;
      kind: "trade";
      at: string;
      actor: string;
      token: string;
      symbol: string;
      side: "buy" | "sell";
      base: number;
      quote: number;
      quoteSymbol: string;
      txHash: string;
    }
  | { id: string; kind: "follow"; at: string; actor: string }
  | { id: string; kind: "comment"; at: string; actor: string; token: string; symbol: string; body: string }
  | { id: string; kind: "like"; at: string; actor: string; token: string; symbol: string }
  | {
      id: string;
      kind: "alert";
      at: string;
      token: string;
      symbol: string;
      direction: "up" | "down";
      alertPrice: number;
      priceNow: number;
    }
  | { id: string; kind: "plan"; at: string; token: string; symbol: string; amount: number; cadence: string };

export type Inbox = { items: InboxItem[]; unread: number; seenAt: string | null };

export const INBOX_LIMIT = 60;

/**
 * Merge the sources newest first, drop the wallet's own actions, cap the
 * list, and count what is newer than `seenAt` (all of it when never seen).
 */
export function buildInbox(input: {
  wallet: string;
  sources: InboxItem[][];
  seenAt: string | null;
  limit?: number;
}): Inbox {
  const self = input.wallet.toLowerCase();
  const seen = input.seenAt ? Date.parse(input.seenAt) : Number.NEGATIVE_INFINITY;
  const unique = new Map<string, InboxItem>();
  for (const item of input.sources.flat()) {
    if ("actor" in item && item.actor.toLowerCase() === self) continue;
    if (!Number.isFinite(Date.parse(item.at))) continue;
    unique.set(item.id, item);
  }
  const items = [...unique.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, input.limit ?? INBOX_LIMIT);
  return {
    items,
    unread: items.filter((item) => Date.parse(item.at) > seen).length,
    seenAt: input.seenAt,
  };
}
