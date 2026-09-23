import { junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { hydratePools } from "@/lib/juno/chain";
import { networkKey } from "@/lib/juno/network";
import { listPools } from "@/lib/juno/registry";
import { TESSERA_PREFIX, tesseraRef, tesseraTokens } from "@/lib/juno/tessera";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Pre-IPO names: Tessera's mark, and the Juno markets tracking it.
 *
 * Two things in one payload because they are one question — *what is this
 * company worth, and what has anyone built on it* — and splitting them would
 * make the screen fetch twice to answer it.
 *
 * Tessera's own T-tokens live on another chain, and Juno on Monad neither holds
 * nor bridges them: the mark is read from Tessera's public API and used as the
 * reference a `tight-nav` or `ipo-book` curve is measured against, exactly as a
 * Pyth feed is for a listed name. So there is nothing on-chain to report about
 * the T-token here — only the published mark, and the Monad markets priced
 * against it.
 */
export async function GET() {
  return junoHandler(async () => {
    const tokens = await tesseraTokens();
    if (tokens.length === 0) {
      /*
       * A quiet third-party API is not "there are no pre-IPO names".
       *
       * 503 rather than an empty 200, so a client can retry instead of
       * rendering "nothing here" over a working market.
       */
      return junoJson(
        { error: "Tessera's mark API did not answer. Nothing here is a reading." },
        { status: 503 },
      );
    }

    // The markets Juno itself has launched against each name. Registry first
    // so a chain hiccup costs prices, not the list.
    const rows = await listPools(60);
    const referenced = rows.filter((row) => row.navFeedId?.startsWith(TESSERA_PREFIX));
    // With the reference read too: the deviation from the mark is the point
    // of a tracker, and without `nav` it would always come back null.
    const { coins, missing } = referenced.length
      ? await hydratePools(referenced, 2, { nav: true })
      : { coins: [], missing: 0 };
    const refOf = new Map(referenced.map((row) => [row.token, row.navFeedId]));

    const withMarkets = tokens.map((token) => {
      const markets = coins.filter((coin) => refOf.get(coin.address) === tesseraRef(token.id));

      return {
        ...token,
        /** `tessera:T-OpenAI` — what a launch stores in `nav_feed_id`. */
        ref: tesseraRef(token.id),
        /**
         * What one T-token represents of the company, as a ratio.
         *
         * `markPrice / markValuation` — the only figure here that is derived
         * rather than published, and it is null when the valuation is unknown
         * because a share of nothing is not a number.
         */
        shareOfCompany:
          token.markValuation > 0 ? token.markPrice / token.markValuation : null,
        /** Total value of every T-token in existence, at the mark. */
        floatUsd: token.supply === null ? null : token.supply * token.markPrice,
        markets: markets.map((coin) => ({
          address: coin.address,
          name: coin.name,
          symbol: coin.symbol,
          priceUsd: coin.priceUsd,
          marketCap: coin.marketCap,
          currency: coin.marketCapCurrency,
          curvePreset: coin.curvePreset,
          progress: coin.curve.progress,
          graduated: coin.curve.graduated,
          /** Where the curve sits against Tessera's mark, if it could be read. */
          deviation: coin.nav?.deviation ?? null,
          withinBand: coin.nav?.withinBand ?? null,
        })),
      };
    });

    return junoJson({
      network: networkKey(),
      source: "https://rest-api.tessera.pe/v1/public/token-details",
      tokens: withMarkets,
      /** Referenced pools whose curve could not be read. */
      missing,
    });
  });
}
