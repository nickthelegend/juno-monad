import "server-only";

import { ttlCache } from "./rpc";

/**
 * Tessera pre-IPO tokens, as a price reference.
 *
 * Juno already marks equity-shaped curves against Pyth. Pyth has no feed for a
 * company that has not listed — and pre-IPO names are exactly what an
 * `ipo-book` curve is for — so for SpaceX, OpenAI and Kalshi the reference comes
 * from Tessera's own mark instead, through the same band the Pyth path uses.
 *
 * ## Why this is a reference and not a market
 *
 * Tessera's T-tokens live on Solana. Juno on Monad does not hold them, bridge
 * them or quote against them: it reads Tessera's published mark over HTTP and
 * uses it as the reference a `tight-nav` or `ipo-book` curve is measured
 * against, exactly as a Pyth equity feed is used for a listed name. The Juno
 * token is its own asset on its own curve; the band says how far its implied
 * price sits from the mark.
 *
 * ## Two endpoints, no key, no history
 *
 * The public API is `token-details` (the mark, holders, valuation) and
 * `tokens` (supply, metadata uri). There is no per-token filter — passing one
 * is ignored and returns the whole list — no OHLC, and no historical series of
 * any kind. Everything here is therefore a *current* reading, and anything
 * time-shaped that Juno shows about a T-token has to come from Juno's own
 * observations rather than from Tessera.
 */

const REST = "https://rest-api.tessera.pe/v1/public";

/** `navFeedId` values that mean "mark this against Tessera" rather than Pyth. */
export const TESSERA_PREFIX = "tessera:";

export type TesseraToken = {
  /** `T-OpenAI`, `T-Kalshi`, `T-SpaceX`. The id used in a `navFeedId`. */
  id: string;
  name: string;
  /** The `tOpenAI` form, which is what the token metadata actually carries. */
  code: string;
  sector: string;
  /**
   * The Solana mainnet mint of Tessera's own token, as their API reports it.
   * Informational — Juno never reads or holds it.
   */
  mint: string;
  /** Tessera's own off-chain mark, in USD. There is no on-chain oracle for it. */
  markPrice: number;
  holders: number;
  /** Implied valuation of the underlying company, in USD. */
  markValuation: number;
  /**
   * Circulating supply in UI units, from `/tokens`. Null when that second
   * endpoint did not answer — the mark is still usable without it.
   */
  supply: number | null;
  /** Token metadata JSON on Tessera's CDN, when `/tokens` answered. */
  uri: string | null;
};

type DetailRow = {
  id: string;
  name: string;
  symbol: string;
  code: string;
  sector: string;
  mint: string;
  markPrice: number;
  holders: number;
  markValuation: number;
};

type TokenRow = {
  token: string;
  latest_supply: string;
  name: string;
  symbol: string;
  uri: string;
};

/*
 * Ninety seconds.
 *
 * Tessera's mark is an off-chain figure they publish; it does not tick like a
 * Pyth feed, and re-fetching it per request would put a third-party API in the
 * path of every coin page. Long enough to be cheap, short enough that a demo
 * never shows a number from a previous session.
 */
const marks = ttlCache<TesseraToken[]>(90_000);

async function getJson<T>(path: string, timeoutMs = 8_000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${REST}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Null, never a fallback list. A hardcoded mark would be the one number in
    // this app that came from nowhere.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every T-token Tessera publishes, merged from both endpoints.
 *
 * `token-details` is required — it carries the mark, and without a mark there
 * is no reference. `tokens` is optional: it only adds supply and the metadata
 * uri, so a failure there costs two fields rather than the whole read.
 */
export async function tesseraTokens(): Promise<TesseraToken[]> {
  return marks.get(
    "all",
    async () => {
      const details = await getJson<DetailRow[]>("/token-details");
      if (!Array.isArray(details) || details.length === 0) return [];

      const supplies = await getJson<TokenRow[]>("/tokens");
      const byMint = new Map(
        (Array.isArray(supplies) ? supplies : []).map((row) => [row.token, row]),
      );

      return details
        .filter((row) => typeof row.mint === "string" && Number.isFinite(row.markPrice))
        .map((row): TesseraToken => {
          const extra = byMint.get(row.mint);
          // `latest_supply` is a decimal *string* in UI units. Parsed rather
          // than trusted: a bad parse becomes null, not NaN leaking into a
          // valuation.
          const supply = extra ? Number(extra.latest_supply) : Number.NaN;
          return {
            id: row.id,
            name: row.name,
            code: row.code,
            sector: row.sector,
            mint: row.mint,
            markPrice: row.markPrice,
            holders: row.holders,
            markValuation: row.markValuation,
            supply: Number.isFinite(supply) ? supply : null,
            uri: extra?.uri ?? null,
          };
        });
    },
    // A read that came back empty is not worth holding for ninety seconds.
    (value) => (value.length === 0 ? 10_000 : 90_000),
  );
}

/** One token by its id, or null. Ids are `T-OpenAI` style and case-insensitive. */
export async function tesseraToken(id: string): Promise<TesseraToken | null> {
  const wanted = id.replace(TESSERA_PREFIX, "").trim().toLowerCase();
  const all = await tesseraTokens();
  return all.find((token) => token.id.toLowerCase() === wanted) ?? null;
}

/** True when a `navFeedId` names a Tessera token rather than a Pyth feed. */
export function isTesseraRef(feedId: string | null | undefined): boolean {
  return typeof feedId === "string" && feedId.startsWith(TESSERA_PREFIX);
}

/** The reference string stored in `juno_pools.nav_feed_id`. */
export function tesseraRef(id: string): string {
  return `${TESSERA_PREFIX}${id}`;
}
