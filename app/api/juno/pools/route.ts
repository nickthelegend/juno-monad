import {
  TransactionReceiptNotFoundError,
  getAddress,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import {
  CallerError,
  junoHandler,
  junoJson,
  junoOptions,
  readJson,
  requireString,
} from "@/lib/juno/api";
import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { publicClient } from "@/lib/juno/client";
import { CURVE_PRESETS, presetFromIndex } from "@/lib/juno/curves";
import { fetchPoolSnapshot, readPool } from "@/lib/juno/launchpad";
import { networkKey, requireLaunchpad } from "@/lib/juno/network";
import { fetchPythPrice, quoteTokenUsdPrice } from "@/lib/juno/pyth";
import { isTesseraRef, tesseraToken } from "@/lib/juno/tessera";
import { listPools, recordLaunch } from "@/lib/juno/registry";
import type { CoinFormat, CurvePresetId } from "@/lib/juno/types";
import { launchpadMissing, requireAddress, requireTxHash } from "../_lib/guards";

export const runtime = "nodejs";
// The registry is a live index of on-chain state; a cached response would
// hide a launch that just confirmed.
export const dynamic = "force-dynamic";
/** The Expo client is a different origin; the preflight has to answer. */
export const OPTIONS = junoOptions;

/** The registry, newest first. Answered from the database alone. */
export async function GET() {
  return junoHandler(async () => {
    const rows = await listPools();
    return junoJson({ network: networkKey(), pools: rows });
  });
}

/**
 * Record a launch after its transaction has confirmed.
 *
 * `POST { token, name, symbol, description?, format, curvePreset, mediaUrl?,
 * posterUrl?, mediaMime?, mediaWidth?, mediaHeight?, navFeedId?, createTx }`.
 *
 * Nothing the caller says about the chain is taken on trust. Without these
 * checks this endpoint would accept any JSON and the "index of real pools"
 * would be an index of claims:
 *
 * - the pool is read from the launchpad, and must exist;
 * - its creator is the one the chain recorded, not one the body names — a
 *   caller cannot attribute someone else's coin to themselves;
 * - `createTx` must be a successful transaction whose receipt carries the
 *   launchpad's own `Launched` event for this token, which is also where the
 *   AMM pair, the name and the ticker are read from.
 *
 * What the body contributes is what the chain does not hold: the caption, the
 * media, the format and the reference a tracker is marked against.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;

    const body = await readJson<Record<string, unknown>>(request);
    const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
    const num = (key: string) =>
      typeof body[key] === "number" && Number.isFinite(body[key]) ? (body[key] as number) : null;

    const token = requireAddress(requireString(body.token, "token"), "token");
    const createTx = requireTxHash(body.createTx, "createTx");
    requireString(body.name, "name");
    requireString(body.symbol, "symbol");
    const curvePreset = str("curvePreset") as CurvePresetId;
    const format = (str("format") || "post") as CoinFormat;

    if (!CURVE_PRESETS[curvePreset]) {
      throw new CallerError(
        `Unknown curve preset "${curvePreset}". One of: ${Object.keys(CURVE_PRESETS).join(", ")}`,
      );
    }
    if (format !== "post" && format !== "reel") {
      throw new CallerError('"format" must be "post" or "reel"');
    }

    const launchpad = requireLaunchpad();

    // The chain is the authority on whether this pool exists and who made it.
    const pool = await readPool(token, launchpad);
    if (!pool) throw new CallerError("There is no Juno pool for this token on this network", 404);

    // A body that does name a creator must agree with the chain. One that does
    // not is fine: the creator is recorded from the pool either way.
    const claimed = body.creatorWallet ?? body.creator;
    if (claimed !== undefined && claimed !== null) {
      if (requireAddress(claimed, "creator") !== getAddress(pool.creator)) {
        throw new CallerError("That wallet did not launch this coin", 403);
      }
    }

    const receipt = await launchReceipt(createTx);
    if (receipt.status !== "success") {
      throw new CallerError("That launch transaction reverted, so it launched nothing");
    }
    const launched = parseEventLogs({
      abi: junoLaunchpadAbi,
      eventName: "Launched",
      logs: receipt.logs.filter((log) => getAddress(log.address) === launchpad),
    }).find((event) => getAddress(event.args.token) === token);
    if (!launched) {
      throw new CallerError("createTx is not the transaction that launched this token");
    }
    if (getAddress(launched.args.creator) !== getAddress(pool.creator)) {
      // Cannot happen with an honest launchpad; checked so it can never be
      // recorded quietly if it does.
      throw new CallerError("The launch event and the pool disagree about the creator");
    }

    /*
     * The preset the body names must be one Juno knows; the preset recorded is
     * the one the pool was actually launched with. The two only differ for a
     * client that is wrong, and the chain is the one that is not.
     */
    const onChainPreset = presetFromIndex(pool.preset);
    const quoteToken = getAddress(pool.quote);
    const navFeedId = str("navFeedId") || null;

    const row = await recordLaunch({
      token,
      launchpad,
      pair: launched.args.venue === zeroAddress ? null : getAddress(launched.args.venue),
      quoteToken,
      creatorWallet: getAddress(pool.creator),
      // As the token itself carries them — what every wallet and explorer
      // shows — rather than as the body spelled them.
      name: launched.args.name,
      symbol: launched.args.symbol,
      description: str("description") || null,
      format,
      curvePreset: onChainPreset,
      navFeedId,
      navUnitsPerToken: await parityRatio(navFeedId, token, launchpad, quoteToken),
      mediaUrl: str("mediaUrl") || null,
      posterUrl: str("posterUrl") || null,
      /*
       * Stored, where once it was dropped: `mediaKind` reads this column and
       * nothing else, so every video launched without it was recorded as an
       * image and could never appear in the reel feed. Only the two kinds the
       * app renders are accepted.
       */
      mediaMime: /^(image|video)\/[\w.+-]+$/.test(str("mediaMime")) ? str("mediaMime") : null,
      mediaWidth: num("mediaWidth"),
      mediaHeight: num("mediaHeight"),
      createTx,
      createBlock: Number(receipt.blockNumber),
    });

    return junoJson({ pool: row }, { status: 201 });
  });
}

/**
 * The launch's receipt, allowing for a node that has not seen it yet.
 *
 * The app calls this straight after `tx/submit` answered, which means the
 * receipt exists — but behind a load balancer the node answering this read may
 * be a block behind the one that answered that one. A short wait covers it; a
 * hash that still has no receipt after that is not a launch on this network.
 */
async function launchReceipt(hash: Hex): Promise<TransactionReceipt> {
  const client = publicClient();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw new CallerError("createTx has no receipt on this network — has it confirmed?", 404);
}

/**
 * How much of the reference one token stands for, fixed at launch.
 *
 * A curve token and a share are not the same kind of number — one costs a
 * hundredth of a cent, the other hundreds of dollars — so a NAV band needs a
 * conversion or it reports every tracker as 100% below its underlying. The
 * conversion is chosen once, here, as *whatever makes this market start at
 * parity*: the curve's opening price divided by the reference's price at the
 * same moment.
 *
 * That is the only defensible choice. Picking any other ratio would be
 * declaring the market mispriced on the day it opened, and the band exists to
 * measure drift from the issue, not to grade the issue itself.
 *
 * Null when the reference could not be read. A tracker with no ratio shows no
 * deviation, which is the honest outcome — better than one derived from a
 * price nobody managed to fetch.
 */
async function parityRatio(
  navFeedId: string | null,
  token: Address,
  launchpad: Address,
  quoteToken: Address,
): Promise<number | null> {
  if (!navFeedId) return null;

  const [reference, snapshot] = await Promise.all([
    referencePriceUsd(navFeedId),
    fetchPoolSnapshot(token, 1, launchpad).catch(() => null),
  ]);
  if (reference === null || !(reference > 0) || !snapshot) return null;

  // The curve's price in USD at this instant. `fetchPoolSnapshot` prices in
  // quote units, so it needs the quote's own dollar rate to compare.
  const quoteUsd = await quoteTokenUsdPrice(quoteToken).catch(() => null);
  const openingUsd = snapshot.price * (quoteUsd ?? 1);
  if (!(openingUsd > 0)) return null;

  return openingUsd / reference;
}

async function referencePriceUsd(navFeedId: string): Promise<number | null> {
  if (isTesseraRef(navFeedId)) {
    const token = await tesseraToken(navFeedId).catch(() => null);
    return token?.markPrice ?? null;
  }
  const price = await fetchPythPrice(navFeedId).catch(() => null);
  return price?.priceUsd ?? null;
}
