/**
 * Launch a Juno coin on Monad from the command line.
 *
 * Builds the call with `planLaunch` — the same path `POST /api/juno/tx/launch`
 * uses — signs it with the local script key, and records the launch with the
 * running app. The fastest way to prove a curve is accepted on-chain, and it
 * prints the MonadVision links a submission needs.
 *
 *   npm run juno:launch -- --preset ipo-book --name "AAPLx Issuance" --symbol AAPLXI
 *   npm run juno:launch -- --preset content --name "Night Market" --symbol NIGHT --first-buy 1 --yes
 *
 * Options:
 *   --preset content|thin-name|ipo-book|tight-nav   (default content)
 *   --quote mon|usdc                                (default mon)
 *   --initial N --migration N   opening / graduation valuations in quote units.
 *                               Default: $1,000 → $25,000 at the live Pyth price.
 *   --first-buy N               buy N quote units in the same transaction
 *   --venue uniswap-v2|kuru     where the curve graduates (default uniswap-v2;
 *                               kuru needs JUNO_KURU_GRADUATOR and a MON quote)
 *   --description, --image <gateway url>, --nav <feed id>,
 *   --format post|reel, --media, --poster, --mime, --width, --height
 *   --yes                       send it (otherwise a dry run: plan + gas estimate)
 *
 * Testnet unless NEXT_PUBLIC_MONAD_NETWORK=mainnet. Signs with
 * JUNO_SCRIPT_PRIVATE_KEY or `.juno/launcher.key` (created on first run).
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { erc20Abi, zeroAddress, type Address } from "viem";

import { CURVE_PRESETS, buildPresetParams } from "../lib/juno/curves";
import { sqrtX96ToPrice } from "../lib/juno/curve-math";
import {
  MON,
  USDC,
  buildApproveCall,
  planLaunch,
  quoteAllowance,
  uiToWei,
} from "../lib/juno/launchpad";
import { explorer, requireLaunchpad } from "../lib/juno/network";
import { pinTokenMetadata } from "../lib/juno/pinata";
import { quoteTokenUsdPrice } from "../lib/juno/pyth";
import type { CurvePresetId } from "../lib/juno/types";
import {
  amount,
  arg,
  describeError,
  estimate,
  flag,
  header,
  launchpadEvents,
  line,
  numberArg,
  requireBalance,
  run,
  scriptAccount,
  scriptReader,
  send,
} from "./lib/cli";

/** The app's default launch size, in dollars — see `lib/juno/tx.ts`. */
const DEFAULT_INITIAL_USD = 1_000;

/** Gas money to keep on top of any MON the launch itself spends. */
const GAS_ALLOWANCE = 10n ** 17n; // 0.1 MON

async function main() {
  const preset = (arg("preset", "content") ?? "content") as CurvePresetId;
  if (!CURVE_PRESETS[preset]) {
    throw new Error(`Unknown preset "${preset}". One of: ${Object.keys(CURVE_PRESETS).join(", ")}`);
  }
  const name = arg("name", "Juno Test Launch")!;
  const symbol = arg("symbol", "JUNOTEST")!;
  const quote = arg("quote", "mon")!.toLowerCase() === "usdc" ? USDC : MON;
  const venueArg = arg("venue", "uniswap-v2")!.toLowerCase();
  if (venueArg !== "uniswap-v2" && venueArg !== "kuru") throw new Error("--venue must be uniswap-v2 or kuru");
  const venue = venueArg as "uniswap-v2" | "kuru";
  const firstBuy = numberArg("first-buy", 0)!;

  const account = scriptAccount();
  header(account.address);
  const launchpad = requireLaunchpad();
  line("launchpad", launchpad);
  line("preset", `${CURVE_PRESETS[preset].label} — ${CURVE_PRESETS[preset].tagline}`);
  line("quote", `${quote.symbol} (${quote.address})`);

  // Valuations: explicit in quote units, or the app's dollar defaults converted
  // at the live price, exactly as the API does it.
  let initialMarketCap = numberArg("initial");
  let migrationMarketCap = numberArg("migration");
  if (initialMarketCap === undefined || migrationMarketCap === undefined) {
    const usd = await quoteTokenUsdPrice(quote.address);
    if (!usd || !(usd > 0)) {
      throw new Error(`No USD price for ${quote.symbol} right now. Pass --initial and --migration in ${quote.symbol}.`);
    }
    initialMarketCap ??= DEFAULT_INITIAL_USD / usd;
    // The preset's own range above the opening: 25x for a launch, 1.5x for tight-nav.
    migrationMarketCap ??= (DEFAULT_INITIAL_USD * CURVE_PRESETS[preset].defaultCapMultiple) / usd;
    line("price", `1 ${quote.symbol} = $${usd}`);
  }

  const curve = buildPresetParams({ preset, initialMarketCap, migrationMarketCap, quoteDecimals: quote.decimals });
  const top = curve.curve[curve.curve.length - 1].sqrtPriceX96;
  line("opens at", `${initialMarketCap.toFixed(2)} ${quote.symbol} FDV (${sqrtX96ToPrice(curve.sqrtStartPriceX96, 18, quote.decimals)} per token)`);
  line("graduates at", `${migrationMarketCap.toFixed(2)} ${quote.symbol} FDV (${sqrtX96ToPrice(top, 18, quote.decimals)} per token)`);
  line("raises", amount(curve.totals.threshold, quote.decimals, quote.symbol));
  line("curve sells", amount(curve.totals.curveBase, 18, symbol));
  line("AMM gets", amount(curve.totals.migrationBase, 18, symbol));
  line("fees", `${curve.startFeeBps / 100}% decaying to ${curve.endFeeBps / 100}% over ${curve.feeDecaySeconds}s`);
  if (firstBuy > 0) line("first buy", `${firstBuy} ${quote.symbol}`);

  const firstBuyRaw = uiToWei(firstBuy, quote.decimals);
  await requireBalance(account.address, GAS_ALLOWANCE + (quote.native ? firstBuyRaw : 0n), "this launch");

  // A USDC first buy is pulled with transferFrom, so it needs an allowance first.
  let needsApproval = false;
  if (!quote.native && firstBuyRaw > 0n) {
    const usdcBalance = await scriptReader().readContract({
      address: quote.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    line("USDC balance", amount(usdcBalance, quote.decimals, "USDC"));
    if (usdcBalance < firstBuyRaw) throw new Error(`Not enough USDC for a ${firstBuy} USDC first buy.`);
    needsApproval = (await quoteAllowance(account.address, quote, launchpad)) < firstBuyRaw;
  }

  if (!flag("yes")) {
    // A dry run still asks the chain: predict the token and estimate the call.
    const plan = await planLaunch({
      creator: account.address,
      quote,
      name,
      symbol,
      uri: "",
      preset,
      initialMarketCap,
      migrationMarketCap,
      firstBuy,
      venue,
    });
    line(
      "token",
      process.env.PINATA_JWT
        ? `${plan.token} before metadata is pinned — the URI is part of the address, so it moves`
        : plan.token,
    );
    if (needsApproval) {
      line("gas", "not estimated: the USDC approval has to land first");
    } else {
      try {
        line("gas", (await estimate(account.address, plan.call)).toString());
      } catch (error) {
        throw new Error(`The launchpad would refuse this launch: ${describeError(error)}`);
      }
    }
    console.log("\nDry run. Add --yes to send it.");
    return;
  }

  // Pin metadata before building. The URI is permanent once the token exists,
  // and it is part of the address the launchpad deploys to.
  let uri = "";
  if (process.env.PINATA_JWT) {
    const pinned = await pinTokenMetadata({
      name,
      symbol,
      description: arg("description", "") ?? "",
      imageUrl: arg("image") ?? arg("media"),
      mediaMimeType: arg("mime"),
      attributes: [
        { trait_type: "Curve", value: CURVE_PRESETS[preset].label },
        { trait_type: "Launchpad", value: "Juno" },
        { trait_type: "Market", value: "Juno bonding curve on Monad" },
        ...(arg("nav") ? [{ trait_type: "NAV feed", value: arg("nav")! }] : []),
      ],
    });
    uri = pinned.uri;
    line("metadata", pinned.url);
  } else {
    line("metadata", "skipped (PINATA_JWT is not set) — launching with an empty URI");
  }

  const plan = await planLaunch({
    creator: account.address,
    quote,
    name,
    symbol,
    uri,
    preset,
    initialMarketCap,
    migrationMarketCap,
    firstBuy,
    venue,
  });
  line("token", plan.token);

  if (needsApproval) await send(account, buildApproveCall(quote, launchpad));
  const receipt = await send(account, plan.call);

  const launched = launchpadEvents(receipt, launchpad).find((event) => event.eventName === "Launched");
  if (!launched || launched.eventName !== "Launched") {
    throw new Error(`The transaction confirmed but emitted no Launched event: ${explorer.tx(receipt.transactionHash)}`);
  }
  const token = launched.args.token as Address;
  const pair = launched.args.venue === zeroAddress ? null : (launched.args.venue as Address);
  if (token !== plan.token) console.warn(`Note: deployed at ${token}, not the predicted ${plan.token}.`);

  console.log("\nLaunched.\n");
  line("tx", explorer.tx(receipt.transactionHash));
  line("token", explorer.token(token));
  line("launchpad", explorer.address(launchpad));
  if (pair) line("AMM pair", explorer.address(pair));
  line("raises", amount(launched.args.migrationQuoteThreshold, quote.decimals, quote.symbol));
  if (uri) line("metadata", uri);

  // Record it so the app lists it. The same endpoint the phone calls after its
  // own submit; the server re-reads the pool and the transaction before writing.
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const num = (key: string) => {
    const value = Number(arg(key));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const record = await fetch(`${site}/api/juno/pools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      creator: account.address,
      name,
      symbol,
      description: arg("description", "") ?? "",
      format: arg("format", "post") ?? "post",
      curvePreset: preset,
      navFeedId: arg("nav") ?? undefined,
      mediaUrl: arg("media") ?? arg("image") ?? undefined,
      posterUrl: arg("poster") ?? arg("media") ?? arg("image") ?? undefined,
      mediaMime: arg("mime") ?? undefined,
      mediaWidth: num("width"),
      mediaHeight: num("height"),
      createTx: receipt.transactionHash,
    }),
  }).catch(() => null);
  if (!record) {
    line("indexed", `no — could not reach ${site} (is the app running?). The coin is live on-chain regardless.`);
  } else if (!record.ok) {
    line("indexed", `no — ${record.status} ${(await record.text()).slice(0, 200)}`);
  } else {
    line("indexed", `yes (${record.status}) — ${site}/coin/${token}`);
  }
}

run(main);
