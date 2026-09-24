import "server-only";

import { getAddress, zeroAddress } from "viem";

import { envioConfigured, envioPoolStats } from "./envio";

import { fetchPoolSnapshot, weiToUi } from "./launchpad";
import { kuruMarketOf, readKuruBook } from "./kuru";
import {
  fetchPythPrice,
  marketState as marketStateOf,
  navBand,
  quoteTokenUsdPrice,
} from "./pyth";
import { curveShape } from "./curve-shape";
import { sqrtX96ToPrice } from "./curve-math";
import { CURVE_PRESETS } from "./curves";
import { feeSchedule, tokenomics } from "./economics";
import { identicon } from "./identicon";
import { activityFromSwap, holdersFromSwaps } from "./activity";
import { mediaKind, mediaSrc } from "./media";
import { isTesseraRef, tesseraToken, TESSERA_PREFIX } from "./tessera";
import { ttlCache } from "./rpc";
import {
  changeWithin,
  listSwapHistory,
  priceSeries,
  totalVolume as sumVolume,
  volumeWithin,
  DAY_MS,
  type PoolSwap,
} from "./swaps";
import type { JunoPoolRow } from "./registry";
import type {
  Activity,
  Coin,
  CoinFormat,
  CurvePresetId,
  Creator,
  NavReference,
  KuruMarketView,
} from "./types";
import { shortAddress } from "./format";

/**
 * Turns a registry row plus live chain state into the `Coin` the UI renders.
 *
 * Split of responsibility: the row supplies identity (who launched it, what
 * they called it, which preset), the chain supplies every number. Nothing
 * numeric is stored or cached.
 */

/** Total supply the launchpad mints for every token. Mirrors `TOTAL_SUPPLY` there. */
const TOTAL_SUPPLY = 1_000_000_000;
const TOTAL_SUPPLY_WEI = 10n ** 27n;

function creatorFromWallet(wallet: string): Creator {
  return {
    handle: shortAddress(wallet, 4, 4),
    displayName: shortAddress(wallet, 4, 4),
    avatarUrl: identicon(wallet),
    ticker: shortAddress(wallet, 4, 4),
    wallet,
    followers: null,
    following: null,
    posts: 0,
    marketCap: 0,
    marketCapCurrency: "USD",
    // A wallet is not a profile. There is no creator-coin market here to have a
    // change, so null rather than a 0% that would render as a real reading.
    marketCapChangePct: null,
  };
}

/**
 * Where the underlying is marked, for a pool that names a reference.
 *
 * Only equity-shaped presets carry a `navBandBps`, and only pools launched in
 * issuance mode carry a reference, so most coins have no NAV and that is
 * correct rather than missing — a photo has no net asset value.
 *
 * Two sources, chosen by the reference itself. Pyth for anything listed;
 * Tessera for the pre-IPO names Pyth has no feed for, which is the entire
 * reason the second path exists — there is no oracle for a company that has
 * not floated, and a `tight-nav` curve about SpaceX needs something to be
 * tight *against*.
 */
async function navFor(
  row: JunoPoolRow,
  priceUsd: number,
  preset: CurvePresetId,
): Promise<NavReference | null> {
  if (!row.navFeedId) return null;
  const bandBps = CURVE_PRESETS[preset]?.navBandBps;
  if (!bandBps) return null;

  /*
   * The curve's price, restated in the reference's own units.
   *
   * `navUnitsPerToken` is how much of the underlying one token stands for. A
   * curve token costs a hundredth of a cent and a share of NVDA costs $224, so
   * without this conversion the band was subtracting two numbers that are not
   * the same kind of thing and reporting every tracker as "-100%, outside the
   * band" — arithmetically true and completely meaningless.
   *
   * Null when the pool never recorded a ratio, and null is the answer: the
   * deviation is genuinely unknown rather than zero.
   */
  const ratio = row.navUnitsPerToken;
  const band = (navPriceUsd: number) => {
    if (ratio === null || !(ratio > 0)) {
      return { deviation: null, withinBand: null, impliedUsd: null };
    }
    const impliedUsd = priceUsd / ratio;
    const { deviation } = navBand({ curvePriceUsd: impliedUsd, navPriceUsd, bandBps });
    return {
      deviation,
      withinBand: Math.abs(deviation) * 10_000 <= bandBps,
      impliedUsd,
    };
  };

  if (isTesseraRef(row.navFeedId)) {
    const token = await tesseraToken(row.navFeedId).catch(() => null);
    if (!token) return null;

    const { deviation, withinBand, impliedUsd } = band(token.markPrice);

    return {
      feed: token.id,
      priceUsd: token.markPrice,
      deviation,
      bandBps,
      withinBand,
      impliedUsd,
      unitsPerToken: ratio,
      /*
       * When *we* read it, and labelled as such by `state: "mark"`.
       *
       * Tessera publishes a price and no timestamp. Putting their mark in the
       * `updatedAt` slot with a made-up time would be the one number on this
       * screen that came from nowhere; `ageSeconds: null` is the honest shape.
       */
      updatedAt: new Date().toISOString(),
      ageSeconds: null,
      state: "mark",
      source: "tessera",
      tessera: {
        id: token.id,
        mint: token.mint,
        sector: token.sector,
        holders: token.holders,
        markValuation: token.markValuation,
        supply: token.supply,
      },
    };
  }

  const price = await fetchPythPrice(row.navFeedId);
  if (!price) return null;

  const { deviation, withinBand, impliedUsd } = band(price.priceUsd);

  return {
    feed: row.navFeedId,
    priceUsd: price.priceUsd,
    deviation,
    updatedAt: price.publishedAt,
    bandBps,
    withinBand,
    impliedUsd,
    unitsPerToken: ratio,
    state: marketStateOf(price),
    ageSeconds: price.ageSeconds,
    source: "pyth",
    tessera: null,
  };
}

/**
 * Hydrate one pool. Returns null when the pool is not on-chain — which happens
 * if a row was recorded against a different network or launchpad.
 */
export async function hydratePool(
  row: JunoPoolRow,
  /**
   * Holder count and fee metrics cost two extra RPC calls per pool. A grid of
   * tiles shows neither, so list views skip them rather than burning the rate
   * limit on numbers nobody sees.
   */
  options: {
    detailed?: boolean;
    /**
     * Read trade history. Defaults to `detailed`.
     *
     * It is separable because it is the one read that can involve walking the
     * launchpad's log tail, while the price, curve and NAV are a single
     * multicall. A list view that shows none of history's products skips it.
     */
    history?: boolean;
    /**
     * Read the NAV reference without the rest of the detailed set.
     *
     * A list of stock trackers is pointless without the stock's price, and
     * the reference is one Pyth contract read — nothing like the history read
     * `detailed` also pays for. It only costs anything on rows that name a
     * reference; a post has none and skips it.
     */
    nav?: boolean;
  } = {},
): Promise<Coin | null> {
  // Null means no USD feed. The pool is then reported in its own quote token
  // rather than converted at a rate nobody published.
  const quoteUsd = await quoteTokenUsdPrice(row.quoteToken).catch(() => null);
  const rate = quoteUsd ?? 1;

  const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad);
  if (!snapshot) return null;

  /*
   * After a graduation into Kuru the curve is frozen at its top and the coin
   * trades on its Kuru market, so the price is the book's: the midpoint of
   * the best bid and ask, which include the market's own AMM vault.
   */
  let kuru: KuruMarketView | null = null;
  let price = snapshot.price;
  if (snapshot.venue === "kuru" && snapshot.curve.graduated) {
    const market = await kuruMarketOf(snapshot.token).catch(() => null);
    const book = market ? await readKuruBook(market).catch(() => null) : null;
    if (market && book) {
      kuru = {
        market,
        bestBid: book.bestBid,
        bestAsk: book.bestAsk,
        spread: book.spread,
        takerFeeBps: book.params.takerFeeBps,
      };
      if (book.mid) price = book.mid;
    }
  }

  const priceUsd = price * rate;
  const preset = row.curvePreset as CurvePresetId;
  const wantHistory = options.history ?? options.detailed ?? false;

  /*
   * History and the NAV mark run together rather than in sequence. Each is
   * independent and each can sit in a retry backoff against a throttled
   * endpoint, so chaining them would stack those waits end to end.
   *
   * Both are optional, and the pair is wrapped as well as each member: the
   * snapshot above is the only read this function cannot do without, and a
   * refused history must not discard a price, a curve and a NAV band that
   * were read successfully a moment earlier.
   */
  const [history, nav] = options.detailed
    ? await Promise.all([
        wantHistory ? listSwapHistory(row.token).catch(() => null) : null,
        navFor(row, priceUsd, preset).catch(() => null),
      ]).catch(() => [null, null] as const)
    : [null, options.nav ? await navFor(row, priceUsd, preset).catch(() => null) : null];

  // Creator fees are a field of the pool itself: the claimable balance, read in
  // the same call as the price.
  const creatorRewards = weiToUi(snapshot.pool.creatorFees, snapshot.quoteDecimals) * rate;

  // Media kind comes from the stored mime type, never from the URL's tail: an
  // IPFS address is a hash with no extension, so sniffing it classified every
  // video as an image and the reel feed rendered stills.
  const fallbackArt = identicon(row.token);
  const media = {
    kind: mediaKind(row.mediaMime),
    url: mediaSrc(row.mediaUrl) ?? fallbackArt,
    posterUrl: mediaSrc(row.posterUrl) ?? mediaSrc(row.mediaUrl) ?? fallbackArt,
    width: row.mediaWidth ?? (row.format === "reel" ? 720 : 1000),
    height: row.mediaHeight ?? (row.format === "reel" ? 1280 : 1000),
  };

  // Trade history drives volume, the 24h change and the chart. One read feeds
  // all three, and it is skipped for list views that show none of them.
  const swaps = history?.swaps ?? [];
  // A partial read is short of the truth, so a total from it would understate
  // volume while looking authoritative. Null says "unknown" instead.
  const complete = history !== null && !history.partial;
  // A complete history with no trades in it is a measured zero, not an
  // unknown: "—" there said the app could not read a market that was simply
  // quiet. `volumeWithin` answers null for an empty list, so say 0 here.
  const volume24h = complete ? (volumeWithin(swaps, DAY_MS) ?? 0) : null;
  const allVolume = complete ? (sumVolume(swaps) ?? 0) : null;
  const priceChange = complete ? changeWithin(swaps, DAY_MS, price) : null;

  /*
   * Holders, from the fills. Wallets whose decoded trades still net positive —
   * which misses anyone who received tokens by transfer, so it is a count of
   * holders *among traders*, labelled as such on the coin page. Null, not 0,
   * when the history was short: "0 holders" is a claim a partial read has not
   * earned.
   */
  let holders = complete ? holdersFromSwaps(swaps).length : null;
  // With the indexer, the count is of every wallet whose balance is above
  // zero — transfers included — not just of the wallets that traded.
  if (options.detailed && envioConfigured()) {
    const stats = await envioPoolStats([row.token]).catch(() => null);
    const indexed = stats?.get(getAddress(row.token));
    if (indexed) holders = indexed.holderCount;
  }

  // For Kuru the locked address is Kuru's MarginAccount, not a pair anyone
  // should be sent to; the coin's own market is linked once it exists.
  const venue =
    snapshot.venue === "kuru"
      ? (kuru?.market ?? null)
      : (row.pair ?? (snapshot.pool.venue !== zeroAddress ? snapshot.pool.venue : null));

  return {
    address: row.token,
    format: row.format as CoinFormat,
    name: row.name,
    symbol: row.symbol,
    description: row.description ?? undefined,
    media,
    creator: creatorFromWallet(row.creatorWallet),
    createdAt: row.createdAt.toISOString(),
    pool: row.token,
    launchpad: snapshot.launchpad,
    quote: snapshot.quote,
    quoteUsdRate: quoteUsd,
    marketCap: priceUsd * TOTAL_SUPPLY,
    marketCapCurrency: quoteUsd === null ? snapshot.quote.symbol : "USD",
    // Market cap is price times a fixed supply, so its change is the price's.
    marketCapChangePct: priceChange,
    // Quote-denominated volume converted into whatever `marketCapCurrency`
    // says this coin is measured in, so the two figures agree.
    volume24h: volume24h === null ? null : volume24h * rate,
    totalVolume: allVolume === null ? null : allVolume * rate,
    priceHistory: history
      ? [
          /*
           * The opening price, at the moment of launch — the curve's start,
           * read from the pool. Without it a chart has nothing to draw from
           * until the second trade, and a one-trade market has no line at all.
           */
          ...(complete
            ? [
                {
                  t: row.createdAt.toISOString(),
                  price: sqrtX96ToPrice(snapshot.pool.sqrtStartPriceX96, snapshot.baseDecimals, snapshot.quoteDecimals) * rate,
                  volume: 0,
                  side: "buy" as const,
                },
              ]
            : []),
          ...priceSeries(swaps).map((point) => ({
            ...point,
            price: point.price * rate,
            volume: point.volume * rate,
          })),
        ]
      : undefined,
    priceHistoryPartial: history ? history.partial : undefined,
    nav,
    reference: row.navFeedId
      ? isTesseraRef(row.navFeedId)
        ? { source: "tessera", id: row.navFeedId.slice(TESSERA_PREFIX.length) }
        : { source: "pyth", id: row.navFeedId }
      : null,
    creatorRewards,
    holders,
    priceUsd,
    curve: snapshot.curve,
    curvePreset: preset,
    pair: venue,
    venue: snapshot.venue,
    kuru,
    fee: options.detailed
      ? feeSchedule({
          startFeeBps: snapshot.pool.startFeeBps,
          endFeeBps: snapshot.pool.endFeeBps,
          feeDecaySeconds: snapshot.pool.feeDecaySeconds,
          feeDecayWad: snapshot.pool.feeDecayWad,
          launchedAt: snapshot.pool.launchedAt,
        })
      : undefined,
    supply: options.detailed
      ? tokenomics({
          sqrtStartPriceX96: snapshot.pool.sqrtStartPriceX96,
          curve: snapshot.segments,
          totalSupply: TOTAL_SUPPLY_WEI,
          baseDecimals: snapshot.baseDecimals,
        })
      : undefined,
    shape: options.detailed
      ? curveShape({
          sqrtStartPriceX96: snapshot.pool.sqrtStartPriceX96,
          curve: snapshot.segments,
          baseDecimals: snapshot.baseDecimals,
          quoteDecimals: snapshot.quoteDecimals,
          currentSqrtPriceX96: snapshot.pool.sqrtPriceX96,
        })
      : undefined,
  };
}

/**
 * Recent trades against one pool, ready for the activity feed.
 *
 * The swap history is cached, so the coin page calling this after
 * `hydratePool` costs no extra RPC.
 */
export async function poolActivity(row: JunoPoolRow, limit = 10): Promise<Activity[]> {
  return (await poolActivityRead(row, limit)).items;
}

/**
 * Recent trades, and whether the read was complete.
 *
 * Callers that render an *empty state* need the second half. An empty list from
 * a throttled endpoint and a pool nobody has traded look identical, and a coin
 * page was telling people "No trades yet" about a pool with four trades in it
 * because the history read came back short.
 */
export async function poolActivityRead(
  row: JunoPoolRow,
  limit = 10,
): Promise<{ items: Activity[]; partial: boolean }> {
  const quoteUsd = await quoteTokenUsdPrice(row.quoteToken).catch(() => null);
  const rate = quoteUsd ?? 1;

  const history = await listSwapHistory(row.token);
  return {
    items: history.swaps
      .slice(0, limit)
      .map((swap) => activityFromSwap(swap, rate)),
    partial: history.partial,
  };
}

/**
 * This pool's decoded fills, raw.
 *
 * `poolActivityRead` returns them shaped for a feed row, which loses the
 * trader's net position — the thing a holder book is built from. Both read the
 * same cached history, so asking for either after the other costs a cache
 * lookup rather than a walk.
 *
 * Null when the history could not be read at all, which is different from a
 * pool with no trades and has to stay different all the way to the UI.
 */
export async function poolSwapsRead(row: JunoPoolRow): Promise<PoolSwap[] | null> {
  const history = await listSwapHistory(row.token).catch(() => null);
  return history ? history.swaps : null;
}

/** The merged feed moves only when someone trades. */
type FeedItem = Activity & { coinName: string; coinAddress: string };
type Feed = {
  items: FeedItem[];
  /**
   * The walk did not see every trade on the network.
   *
   * True when a pool's history was refused or cut short, or when the item cap
   * stopped the walk before the registry ran out. The page above says "every
   * trade against a Juno pool"; with this flag set, it is not entitled to.
   */
  partial: boolean;
};

const feedCache = ttlCache<Feed>(60_000);

/**
 * The global trade feed: recent trades across every pool, newest first.
 *
 * Each pool's history is a database read once the log tail has recorded it,
 * so this is cheap — but it is still walked a few pools at a time and stopped
 * once a screenful is in hand, because a feed shows the last screenful of
 * trades and most pools have never traded.
 */
export async function globalActivity(
  rows: JunoPoolRow[],
  perPool = 10,
  width = 2,
  /**
   * Stop once this many items are in hand.
   *
   * Most pools have never traded, so walking all of them to fill one screen
   * spends the endpoint's patience on pools that will return nothing — and by
   * the time it reaches one that would have, it is being refused. Rows arrive
   * newest-first, which is also most-likely-to-have-traded-first.
   */
  enough = 40,
): Promise<Feed> {
  const key = rows.map((row) => row.token).join(",");

  return feedCache.get(
    key,
    async () => {
    const out: FeedItem[] = [];
    let cursor = 0;
    let partial = false;

    async function worker() {
      while (cursor < rows.length && out.length < enough) {
        const row = rows[cursor++];
        // Both halves count as incomplete: a read that threw, and a read that
        // came back short. Either one means a trade may exist that this feed
        // is not showing.
        const read = await poolActivityRead(row, perPool).catch(() => null);
        if (read === null || read.partial) partial = true;
        for (const entry of read?.items ?? []) {
          out.push({ ...entry, coinName: row.name, coinAddress: row.token });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(width, rows.length) }, worker));
    // Stopping at the cap also leaves pools unwalked.
    if (cursor < rows.length) partial = true;
    return {
      items: out.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
      partial,
    };
  },
    // An empty feed is almost always a throttled read rather than a quiet
    // market, so it is trusted for seconds instead of a minute.
    (feed) => (feed.items.length > 0 ? 60_000 : 8_000),
  );
}

/**
 * Hydrate many for a list view, dropping any whose pool is missing here.
 *
 * Bounded concurrency rather than `Promise.all`: firing every pool read
 * simultaneously is the burst a public RPC answers with 429s, and a grid of
 * four pools does not need to be four times as rude as one.
 *
 * `missing` is how many rows the registry had and this read could not resolve.
 * It is returned rather than swallowed because a list that quietly shrinks from
 * eleven to nine presents itself as the whole market: the caller has to be able
 * to say "two could not be read", and it cannot say that from a shorter array.
 */
export async function hydratePools(
  rows: JunoPoolRow[],
  width = 2,
  options: { nav?: boolean } = {},
): Promise<{ coins: Coin[]; missing: number }> {
  const out: Array<Coin | null> = new Array(rows.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      out[index] = await hydratePool(rows[index], { nav: options.nav }).catch(() => null);
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, rows.length) }, worker));
  const coins = out.filter((coin): coin is Coin => coin !== null);
  return { coins, missing: rows.length - coins.length };
}
