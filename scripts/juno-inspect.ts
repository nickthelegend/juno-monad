/**
 * Read a live Juno coin back from Monad.
 *
 * Exercises the `fetchPoolSnapshot` / `quoteTrade` path the API's coin routes
 * use, so a failure here is a failure in the app. Read-only; signs nothing and
 * needs no key.
 *
 *   npm run juno:inspect -- --token 0x…
 *   npm run juno:inspect -- --latest
 *   npm run juno:inspect -- --list 10          # the launchpad's newest coins
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { type Address } from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "../lib/juno/abi";
import { CURVE_PRESETS } from "../lib/juno/curves";
import { feeSchedule, tokenomics } from "../lib/juno/economics";
import { InsufficientLiquidityError, fetchPoolSnapshot, quoteTrade } from "../lib/juno/launchpad";
import { explorer, requireLaunchpad } from "../lib/juno/network";
import { quoteTokenUsdPrice } from "../lib/juno/pyth";
import { amount, arg, flag, header, line, numberArg, resolveToken, run, scriptReader } from "./lib/cli";

async function list(count: number) {
  const launchpad = requireLaunchpad();
  const reader = scriptReader();
  const total = await reader.readContract({ address: launchpad, abi: junoLaunchpadAbi, functionName: "tokenCount" });
  line("launchpad", explorer.address(launchpad));
  line("coins", total.toString());
  const first = total > BigInt(count) ? total - BigInt(count) : 0n;
  for (let i = total - 1n; i >= first && i >= 0n; i--) {
    const token = (await reader.readContract({
      address: launchpad,
      abi: junoLaunchpadAbi,
      functionName: "tokens",
      args: [i],
    })) as Address;
    const [symbol, snapshot] = await Promise.all([
      reader.readContract({ address: token, abi: junoTokenAbi, functionName: "symbol" }).catch(() => "?"),
      fetchPoolSnapshot(token).catch(() => null),
    ]);
    const state = snapshot?.curve.graduated ? "graduated" : snapshot?.curve.complete ? "full" : `${((snapshot?.curve.progress ?? 0) * 100).toFixed(2)}%`;
    console.log(`  #${i}  ${token}  $${symbol.padEnd(10)} ${(snapshot?.quote.symbol ?? "?").padEnd(5)} ${state}`);
    if (i === 0n) break;
  }
}

async function main() {
  header();
  if (flag("list")) {
    await list(numberArg("list", 10) ?? 10);
    return;
  }

  const token = await resolveToken();
  const probe = await fetchPoolSnapshot(token);
  if (!probe) throw new Error(`${token} has no pool on this launchpad`);
  const usd = await quoteTokenUsdPrice(probe.quote.address).catch(() => null);
  // Re-read with the dollar rate so the curve figures come back in USD too.
  const snapshot = usd ? ((await fetchPoolSnapshot(token, usd)) ?? probe) : probe;
  const { pool, quote } = snapshot;

  const symbol = await scriptReader()
    .readContract({ address: token, abi: junoTokenAbi, functionName: "symbol" })
    .catch(() => "?");

  line("token", `${token} ($${symbol})`);
  line("creator", pool.creator);
  line("launched", new Date(pool.launchedAt * 1000).toISOString());
  line("preset", `${snapshot.preset} — ${CURVE_PRESETS[snapshot.preset].label}`);
  line("quote", `${quote.symbol} (${quote.address}), ${quote.decimals} decimals`);
  line("price", `${snapshot.price} ${quote.symbol}${usd ? ` ($${snapshot.price * usd})` : ""}`);
  line("progress", `${(snapshot.curve.progress * 100).toFixed(4)}%`);
  line("raised", `${amount(pool.quoteReserve, quote.decimals, quote.symbol)} of ${amount(pool.migrationQuoteThreshold, quote.decimals, quote.symbol)}`);
  if (usd) line("raised (USD)", `$${snapshot.curve.raisedUsd.toFixed(2)} of $${snapshot.curve.thresholdUsd.toFixed(2)}`);
  line("state", pool.graduated ? "graduated" : pool.complete ? "curve full — ready to graduate" : "trading on the curve");
  line("pair", pool.venue);

  const fees = feeSchedule(pool);
  if (fees) {
    line("fee now", `${(fees.currentBps / 100).toFixed(3)}% (${fees.startBps / 100}% → ${fees.endBps / 100}%, period ${fees.period}/${fees.totalPeriods})`);
  }
  line("creator fees", `${amount(pool.creatorFees, quote.decimals, quote.symbol)} claimable, ${amount(pool.creatorFeesClaimed, quote.decimals, quote.symbol)} claimed`);

  const split = tokenomics({
    sqrtStartPriceX96: pool.sqrtStartPriceX96,
    curve: snapshot.segments,
    totalSupply: 10n ** 27n,
    baseDecimals: snapshot.baseDecimals,
  });
  if (split) {
    line("supply split", `curve ${(split.curvePct * 100).toFixed(2)}% · AMM ${(split.migrationPct * 100).toFixed(2)}% · burned ${(split.leftoverPct * 100).toFixed(2)}%`);
  }

  // A quote proves the curve maths runs against live state, through the same
  // `quoteBuy` view the app calls.
  if (!pool.complete && !pool.graduated) {
    const size = numberArg("amount", quote.native ? 1 : 10)!;
    try {
      const buy = await quoteTrade({ snapshot, side: "buy", amountIn: size });
      console.log(`\nquote: buy with ${size} ${quote.symbol}`);
      line("  out", `${buy.amountOut} tokens`);
      line("  min out", `${buy.minimumAmountOut} tokens`);
      line("  fee", `${buy.fee} ${quote.symbol}`);
      line("  impact", `${(buy.priceImpact * 100).toFixed(4)}% (curve ${(buy.curveImpact * 100).toFixed(4)}%)`);
    } catch (error) {
      if (!(error instanceof InsufficientLiquidityError)) throw error;
      line("quote", "the curve cannot fill that size");
    }
  }

  console.log("");
  line("token", explorer.token(token));
  line("launchpad", explorer.address(snapshot.launchpad));
  if (arg("site") ?? process.env.NEXT_PUBLIC_SITE_URL) {
    line("app", `${(arg("site") ?? process.env.NEXT_PUBLIC_SITE_URL)!.replace(/\/$/, "")}/coin/${token}`);
  }
}

run(main);
