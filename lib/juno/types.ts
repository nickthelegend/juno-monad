/**
 * Juno domain types.
 *
 * Deliberately independent of the contract's raw shapes: the UI speaks in
 * already-decoded numbers (UI units, not wei) so components never carry a
 * bigint or a decimals conversion. `lib/juno/launchpad.ts` owns the
 * translation from `JunoLaunchpad.Pool` into these.
 */

export type QuoteToken = {
  /** ERC-20 address on Monad; the zero address is native MON. */
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** True for native MON, which is paid as `msg.value` and needs no approval. */
  native: boolean;
  /** Shown in the trade panel's token selector. */
  icon?: string;
};

export type Creator = {
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio?: string;
  /** The creator coin's ticker, rendered as `$handle`. */
  ticker: string;
  wallet: string;
  /** Verified links row (X, etc). */
  socials?: { x?: string };
  /**
   * Null, always, until someone stores them.
   *
   * These were `number` and set to 0 everywhere, which rendered as a confident
   * "0 Followers" on a profile whose entire job is to establish credibility.
   * Typed nullable so a future render has to decide what to do about not
   * knowing rather than silently printing a zero.
   */
  followers: number | null;
  following: number | null;
  /** Real: how many coins this wallet has launched. */
  posts: number;
  /** Creator-coin market cap in USD. */
  marketCap: number;
  /**
   * What `marketCap` is denominated in. Falls back to the quote token's own
   * symbol when no USD price feed is available, so the figure is never
   * mislabelled as dollars.
   */
  marketCapCurrency: string;
  /**
   * Null when there is no trade old enough to measure against. A creator with
   * no trading history has no 24h change, and 0 would claim one.
   */
  marketCapChangePct: number | null;
};

export type MediaKind = "image" | "video" | "audio";

/**
 * How a coin was published.
 *
 * `post` is a landscape/square piece shown in the grid. `reel` is a vertical
 * video shown in the full-bleed swipe feed. The difference is not cosmetic:
 * reels get a different curve default and a different trade surface, because
 * someone buying mid-scroll is making a much faster decision than someone
 * reading a coin page.
 */
export type CoinFormat = "post" | "reel";

export type Media = {
  kind: MediaKind;
  url: string;
  /** Poster frame for video; falls back to `url` for images. */
  posterUrl?: string;
  width: number;
  height: number;
};

/**
 * A content coin: one post, one bonding curve. The post *is* the token.
 */
export type Coin = {
  /** The token's address — the canonical id, used in `/coin/[address]`. */
  address: string;
  format: CoinFormat;
  name: string;
  symbol: string;
  description?: string;
  media: Media;
  creator: Creator;
  createdAt: string;

  /**
   * Where this coin's curve lives. On Monad a pool is keyed by its token inside
   * the launchpad, so this is the token address; kept as its own field so a
   * future venue with separate pool addresses changes one line.
   */
  pool: string;
  /** The launchpad contract holding the curve. */
  launchpad: string;
  quote: QuoteToken;
  /**
   * USD price of one quote token, or null when no feed answered.
   *
   * Quote-denominated figures — a recurring-buy amount, a contribution total —
   * are stored and signed for in quote units. Converting them for display needs
   * this rate, and null has to stay null: a missing MON price means the dollar
   * figure is unknown, not that it equals the MON figure.
   */
  quoteUsdRate: number | null;

  marketCap: number;
  /**
   * What `marketCap` is denominated in. Falls back to the quote token's own
   * symbol when no USD price feed is available, so the figure is never
   * mislabelled as dollars.
   */
  marketCapCurrency: string;
  /**
   * 24h change as a signed ratio, or null when it cannot be derived.
   *
   * Null covers two real cases: a pool whose entire trade history is inside the
   * window, so there is no earlier price to compare against, and a history the
   * RPC would not serve. Neither is a 0% change, which is a claim about a
   * period we would not have measured.
   */
  marketCapChangePct: number | null;
  /**
   * Traded quote volume in the last 24h and across all visible history, in the
   * same unit as `marketCapCurrency`.
   *
   * Both are derived from decoded swaps (`lib/juno/swaps.ts`). Null means no
   * history was readable at all — distinct from 0, which means the market is
   * genuinely quiet.
   */
  volume24h: number | null;
  totalVolume: number | null;
  creatorRewards: number;
  /**
   * Null when the read failed — a rate-limited RPC must not render as a
   * confident zero, which is what "no holders" would claim.
   */
  holders: number | null;

  /** Price of one coin, in the quote token's USD terms. */
  priceUsd: number;
  /**
   * Realised prices over time, oldest first — the coin page's chart.
   *
   * Executed trades, not marks, so a gap means nobody traded rather than a
   * price that held. Only loaded on the coin page. Undefined when not loaded;
   * empty when loaded and the pool has never traded.
   */
  priceHistory?: PricePoint[];
  /**
   * True when the history read was cut short, so `priceHistory` is a prefix
   * of the real history rather than all of it.
   *
   * An empty *partial* history is the dangerous case: it looks identical to a
   * pool that has never traded, and the chart said "No trades yet" on a coin
   * whose own activity list showed four fills on the same screen. The chart
   * reads this flag to tell "nobody traded" apart from "we could not read".
   */
  priceHistoryPartial?: boolean;
  /** Where the underlying is marked, for an equity-preset launch. Coin page only. */
  nav?: NavReference | null;
  /**
   * What this market is marked against, read from the registry row — no RPC.
   *
   * `nav` above is the live mark and costs a read, so list views skip it. That
   * left a list unable to say which coins are stock trackers and which are
   * someone's post, which is the first thing the app sorts on: pre-IPO names
   * and listed stocks belong on the Trade tab, posts and reels in the feed.
   * Null is a post or a reel — a photo has no underlying.
   */
  reference?: { source: "pyth" | "tessera"; id: string } | null;

  curve: CurveState;
  /** Which `lib/juno/curves.ts` preset this pool was launched with. */
  curvePreset: CurvePresetId;
  /** Social counters, shown on the reel rail. */
  likes?: number;
  commentCount?: number;
  /** Whether the asking wallet liked it. Null when nobody said who is asking. */
  viewerLiked?: boolean | null;
  /**
   * The AMM pair the curve graduates into. Created at launch and locked until
   * graduation, so it is known — and linkable — before the curve fills. For
   * the Kuru venue, the coin's Kuru market: live once it has graduated, and on
   * the coin page before that, the CREATE2 address it will open at.
   */
  pair?: string | null;
  /** Where the curve graduates, chosen by the creator at launch. */
  venue?: Venue;
  /**
   * The coin's Kuru market, once it has graduated there: the top of its book,
   * in the quote token (MON). Null before graduation and for Uniswap v2 coins.
   */
  kuru?: KuruMarketView | null;
  /**
   * The pool's actual sixteen-segment curve, for plotting. Only loaded on the
   * coin page — a grid of tiles has no room to show it.
   */
  shape?: CurveShape;
  /** Fee decay and supply split, read from the config. Coin page only. */
  fee?: FeeSchedule | null;
  supply?: Tokenomics | null;
};

export type KuruMarketView = {
  market: string;
  /** MON per token. Zero when that side of the book is empty. */
  bestBid: number;
  bestAsk: number;
  /** (ask - bid) / mid; null without both sides. */
  spread: number | null;
  takerFeeBps: number;
};

/**
 * Where a curve graduates, chosen by its creator at launch: a Uniswap v2 pair,
 * or a Kuru order-book market (testnet deployments with a Kuru graduator).
 */
export type Venue = "uniswap-v2" | "kuru";

/**
 * Bonding-curve progress toward graduation.
 *
 * `progress` is quote raised over the curve's migration threshold, not a price
 * ratio — the curve completes when its price reaches the top of the last
 * range, which is exactly when it holds the threshold.
 */
export type CurveState = {
  /** 0..1. */
  progress: number;
  /** Quote raised so far, in USD. */
  raisedUsd: number;
  /** `migrationQuoteThreshold`, in USD. */
  thresholdUsd: number;
  /** The curve has filled; trading is closed until someone graduates it. */
  complete: boolean;
  /** Its reserves now live in the AMM pair. */
  graduated: boolean;
};

import type { CurveShape } from "./curve-shape";
import type { FeeSchedule, Tokenomics } from "./economics";

/**
 * One realised trade price. Lives here rather than in `lib/juno/swaps.ts`
 * because client components render it and that module is `server-only` — a
 * type-only import would be erased, but a domain type belongs with the domain.
 */
export type PricePoint = {
  t: string;
  price: number;
  /** Quote-denominated size of the trade that set this price. */
  volume: number;
  side: TradeSide;
};

export type CurvePresetId =
  | "content"
  | "thin-name"
  | "ipo-book"
  | "tight-nav";

export type TradeSide = "buy" | "sell";

export type Activity = {
  id: string;
  side: TradeSide;
  actor: Pick<Creator, "handle" | "avatarUrl">;
  /**
   * Who signed it.
   *
   * The handle beside a trade is a shortened address and the avatar is derived
   * from it, so the wallet was always *in* the row — but only as four
   * characters at each end, which is enough to look at and not enough to link
   * to or filter on. A social feed that cannot say whose trade this is cannot
   * have a following filter, and tapping a row had nowhere to go.
   */
  wallet: string;
  /** Coin amount, in UI units. */
  amount: number;
  /** Quote value of the trade, in USD. */
  valueUsd: number;
  timestamp: string;
  /** The transaction that made the trade — the link a judge clicks. */
  txHash?: string;
};

export type Holder = {
  rank: number;
  actor: Pick<Creator, "handle" | "avatarUrl">;
  /** The holder's wallet. */
  wallet: string;
  balance: number;
  /** Share of what the list accounts for, 0..1. */
  share: number;
};

export type Comment = {
  id: string;
  actor: Pick<Creator, "handle" | "avatarUrl">;
  body: string;
  timestamp: string;
  /** Trades can carry a comment, which is what Zora surfaces here. */
  side?: TradeSide;
  /** The trade the comment was posted with, when there was one. */
  txHash?: string;
};

/** Reference price for a tokenized equity, for the NAV band. */
/** A tracker's NAV as Chainlink CRE attested it on Monad (`JunoNavOracle`). */
export type NavAttestation = {
  oracle: string;
  navUsd: number;
  impliedUsd: number;
  /** Signed ratio, like `deviation`. */
  premium: number;
  withinBand: boolean;
  bandBps: number;
  /** When the DON observed it. */
  observedAt: string;
};

export type NavReference = {
  /** Feed id, or a name like "Equity.US.AAPL/USD", or a Tessera token id. */
  feed: string;
  priceUsd: number;
  /** How far the curve sits from NAV, as a signed ratio. Null when unmeasurable. */
  deviation: number | null;
  updatedAt: string;
  /** The preset's own tolerance, in basis points. */
  bandBps: number;
  /**
   * Whether the curve is inside that tolerance.
   *
   * Null when there is nothing to compare — see `unitsPerToken`. A tracker
   * with no ratio recorded is not "out of band", it is unmeasured.
   */
  withinBand: boolean | null;
  /**
   * What this curve implies the underlying is worth, in USD.
   *
   * The token price restated in the reference's units, which is the only form
   * in which the two are comparable. Null without a ratio.
   */
  impliedUsd: number | null;
  /**
   * How many units of the reference one token stands for, fixed at launch.
   * Null on a pool that predates the ratio, which is why the figures above
   * can be null on a coin that names a feed.
   */
  unitsPerToken: number | null;
  /**
   * Whether this mark is live, a last close, too old to trust, or a published
   * mark with no timestamp at all.
   *
   * An equity feed stops publishing when the exchange shuts, so "closed" is the
   * normal weekend state and means Friday's close — not a failed read. The UI
   * has to say which, because a stale number presented as live is the kind of
   * thing someone trades on.
   *
   * `"mark"` is the Tessera case. Their API publishes a price and no time, so
   * freshness is genuinely unknown — which is a third answer, not a reason to
   * guess one of the other two.
   */
  state: "live" | "closed" | "stale" | "mark";
  /**
   * Seconds since the publisher last moved this feed.
   *
   * Null when the source publishes no timestamp. Zero would mean "published
   * this instant", which is a much stronger claim than "we do not know".
   */
  ageSeconds: number | null;
  /** Where the reference came from. */
  source: "pyth" | "tessera";
  /** The same comparison attested on chain by Chainlink CRE, when Juno's NAV oracle is set and has run. */
  attested: NavAttestation | null;
  /**
   * The extra Tessera carries and Pyth does not: a company, not a ticker.
   * Null on a Pyth reference.
   */
  tessera: {
    /** `T-OpenAI`. */
    id: string;
    /**
     * Where Tessera's own token for this company lives, as their API reports
     * it. Informational: Juno marks against Tessera's published price, and
     * never reads or holds the token itself.
     */
    mint: string;
    sector: string;
    /** People holding the underlying T-token — a crowd, not a quote. */
    holders: number;
    /** Tessera's implied valuation of the company, in USD. */
    markValuation: number;
    /** Circulating T-token supply, or null when that endpoint was quiet. */
    supply: number | null;
  } | null;
};
