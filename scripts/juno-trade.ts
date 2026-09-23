/**
 * Trade against a live Juno curve on Monad.
 *
 * Runs `quoteTrade` → `buildSwapCall` — the path `POST /api/juno/tx/swap`
 * uses — and signs with the local script key instead of a phone.
 *
 *   npm run juno:trade -- --token 0x… --side buy --amount 0.5 --yes
 *   npm run juno:trade -- --token 0x… --side sell --amount all --yes
 *   npm run juno:trade -- --latest --fill --yes      # buy out the rest of the curve
 *
 * Options:
 *   --token <address> | --latest   the coin (latest = the launchpad's newest)
 *   --side buy|sell                (default buy)
 *   --amount N | all               quote units to spend on a buy, tokens to sell;
 *                                  `all` sells the whole balance
 *   --fill                         buy whatever is left on the curve. Sends a
 *                                  generous amount: the launchpad fills the curve
 *                                  to its top and refunds the rest in the same
 *                                  transaction.
 *   --slippage <bps>               (default 100)
 *   --yes                          send it (otherwise quote only)
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { erc20Abi, type Address } from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "../lib/juno/abi";
import {
  buildApproveCall,
  buildSwapCall,
  fetchPoolSnapshot,
  invalidatePoolSnapshot,
  quoteAllowance,
  quoteTrade,
  tradeDeadline,
  weiToUi,
  type PoolSnapshot,
} from "../lib/juno/launchpad";
import { explorer } from "../lib/juno/network";
import type { TradeSide } from "../lib/juno/types";
import {
  amount,
  arg,
  flag,
  header,
  launchpadEvents,
  line,
  numberArg,
  requireBalance,
  resolveToken,
  run,
  scriptAccount,
  scriptReader,
  send,
} from "./lib/cli";

/** Gas money to keep on top of any MON the trade itself spends. */
const GAS_ALLOWANCE = 5n * 10n ** 16n; // 0.05 MON

/** Headroom on a fill, in bps. Unused quote is refunded, so this costs nothing. */
const FILL_HEADROOM_BPS = 1_000n;

function progress(snapshot: PoolSnapshot | null): string {
  return snapshot ? `${(snapshot.curve.progress * 100).toFixed(4)}%` : "?";
}

/**
 * What it takes to push the curve to its top, with room to spare.
 *
 * The fee comes off a buy's input, so delivering the missing reserve takes
 * `missing / (1 − fee)`. The contract stops at the top and refunds the rest.
 */
async function fillAmount(snapshot: PoolSnapshot): Promise<number> {
  const missing = snapshot.pool.migrationQuoteThreshold - snapshot.pool.quoteReserve;
  if (missing <= 0n) return 0;
  const feePpm = await scriptReader().readContract({
    address: snapshot.launchpad,
    abi: junoLaunchpadAbi,
    functionName: "currentFeePpm",
    args: [snapshot.token],
  });
  const gross = (missing * 1_000_000n) / (1_000_000n - feePpm);
  const generous = gross + (gross * FILL_HEADROOM_BPS) / 10_000n + 1n;
  return weiToUi(generous, snapshot.quoteDecimals);
}

async function main() {
  const token = await resolveToken();
  const fill = flag("fill");
  const side = (fill ? "buy" : arg("side", "buy")) as TradeSide;
  if (side !== "buy" && side !== "sell") throw new Error("--side must be buy or sell");
  const slippageBps = numberArg("slippage", 100)!;

  const account = scriptAccount();
  header(account.address);

  const snapshot = await fetchPoolSnapshot(token);
  if (!snapshot) throw new Error(`${token} has no pool on this launchpad`);
  const { quote: quoteToken } = snapshot;

  line("token", token);
  line("price", `${snapshot.price} ${quoteToken.symbol}`);
  line("progress", progress(snapshot));
  if (snapshot.curve.graduated) throw new Error("This coin has graduated — it trades on its AMM pair now.");
  if (snapshot.curve.complete) {
    throw new Error(`The curve is full. Graduate it: npm run juno:graduate -- --token ${token} --yes`);
  }

  // Size the trade.
  let amountIn: number;
  let tokenBalance: bigint | null = null;
  let sellAll = false;
  if (fill) {
    amountIn = await fillAmount(snapshot);
    line("mode", "fill the rest of the curve (unused quote is refunded)");
  } else if (side === "sell") {
    tokenBalance = await scriptReader().readContract({
      address: token,
      abi: junoTokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    line("holding", amount(tokenBalance, snapshot.baseDecimals, "tokens"));
    const raw = arg("amount", "all")!;
    sellAll = raw === "all";
    amountIn = sellAll ? weiToUi(tokenBalance, snapshot.baseDecimals) : Number(raw);
  } else {
    amountIn = Number(arg("amount", "0.1"));
  }
  if (!Number.isFinite(amountIn) || amountIn <= 0) throw new Error("Nothing to trade: the amount is zero.");

  const quote = await quoteTrade({ snapshot, side, amountIn, slippageBps });
  if (tokenBalance !== null && quote.raw.amountIn > tokenBalance) {
    // Selling "all" goes through a float and can round a wei above the
    // balance; that is clamped. Asking for more than is held is refused.
    if (!sellAll) throw new Error("That is more than this wallet holds.");
    quote.raw.amountIn = tokenBalance;
  }

  const inSymbol = side === "buy" ? quoteToken.symbol : "tokens";
  const outSymbol = side === "buy" ? "tokens" : quoteToken.symbol;
  line("side", side);
  line("amount in", `${amountIn} ${inSymbol}`);
  if (side === "buy" && quote.amountUsed < amountIn) {
    line("spends", `${quote.amountUsed} ${inSymbol} (the rest is refunded)`);
  }
  line("expected out", `${quote.amountOut} ${outSymbol}`);
  line("minimum out", `${quote.minimumAmountOut} ${outSymbol}`);
  line("fee", `${quote.fee} ${quoteToken.symbol}`);
  line("price impact", `${(quote.priceImpact * 100).toFixed(4)}% (curve alone ${(quote.curveImpact * 100).toFixed(4)}%)`);
  if (quote.raw.amountOut === 0n) throw new Error("That amount is too small to trade.");

  // Can this wallet pay for it?
  const spendsMon = side === "buy" && quoteToken.native ? quote.raw.amountIn : 0n;
  await requireBalance(account.address, GAS_ALLOWANCE + spendsMon, "this trade");
  let needsApproval = false;
  if (side === "buy" && !quoteToken.native) {
    const held = await scriptReader().readContract({
      address: quoteToken.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    line(quoteToken.symbol, amount(held, quoteToken.decimals, quoteToken.symbol));
    if (held < quote.raw.amountIn) throw new Error(`Not enough ${quoteToken.symbol} for this buy.`);
    needsApproval = (await quoteAllowance(account.address, quoteToken, snapshot.launchpad)) < quote.raw.amountIn;
  }

  if (!flag("yes")) {
    console.log(`\nQuote only.${needsApproval ? ` Sending will approve ${quoteToken.symbol} first.` : ""} Add --yes to send.`);
    return;
  }

  if (needsApproval) await send(account, buildApproveCall(quoteToken, snapshot.launchpad));
  const call = buildSwapCall({
    snapshot,
    owner: account.address as Address,
    side,
    quote,
    deadline: tradeDeadline(),
  });
  const receipt = await send(account, call);

  const events = launchpadEvents(receipt, snapshot.launchpad);
  for (const event of events) {
    if (event.eventName === "Trade") {
      line(
        "filled",
        `${event.args.isBuy ? "bought" : "sold"} ${amount(event.args.baseAmount, snapshot.baseDecimals, "tokens")} for ${amount(event.args.quoteAmount, quoteToken.decimals, quoteToken.symbol)} (fee ${amount(event.args.fee, quoteToken.decimals, quoteToken.symbol)})`,
      );
    }
  }
  const completed = events.some((event) => event.eventName === "CurveCompleted");

  invalidatePoolSnapshot(token);
  const after = await fetchPoolSnapshot(token).catch(() => null);
  console.log("\nTrade confirmed.\n");
  line("tx", explorer.tx(receipt.transactionHash));
  line("progress", `${progress(snapshot)} → ${progress(after)}`);
  line("price", `${snapshot.price} → ${after?.price ?? "?"} ${quoteToken.symbol}`);
  if (completed) {
    console.log(`\nThe curve is full. Graduate it: npm run juno:graduate -- --token ${token} --yes`);
  }
}

run(main);
