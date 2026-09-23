/**
 * Graduate a filled Juno curve into its AMM pair on Monad.
 *
 *   npm run juno:graduate -- --token 0x…          # check whether it can
 *   npm run juno:graduate -- --token 0x… --yes    # do it
 *
 * Once a buy takes the curve to its top, trading on the curve stops and
 * anyone may move its reserves into the pair — the outcome does not depend on
 * who sends it. Built with `buildGraduateCall`, the path
 * `POST /api/juno/tx/graduate` uses. Fill a curve first with
 * `npm run juno:trade -- --token 0x… --fill --yes`.
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { buildGraduateCall, fetchPoolSnapshot, invalidatePoolSnapshot } from "../lib/juno/launchpad";
import { explorer } from "../lib/juno/network";
import {
  amount,
  flag,
  header,
  launchpadEvents,
  line,
  requireBalance,
  resolveToken,
  run,
  scriptAccount,
  send,
} from "./lib/cli";

async function main() {
  const token = await resolveToken();
  const account = scriptAccount();
  header(account.address);

  const snapshot = await fetchPoolSnapshot(token);
  if (!snapshot) throw new Error(`${token} has no pool on this launchpad`);
  const { pool, quote } = snapshot;

  line("token", token);
  line("progress", `${(snapshot.curve.progress * 100).toFixed(4)}%`);
  line("complete", pool.complete);
  line("graduated", pool.graduated);
  line("pair", pool.venue);
  line("reserves", `${amount(pool.quoteReserve, quote.decimals, quote.symbol)} / ${amount(pool.baseReserve, 18, "tokens")}`);

  if (pool.graduated) {
    console.log(`\nAlready graduated. It trades on ${explorer.address(pool.venue)}.`);
    return;
  }
  if (!pool.complete) {
    throw new Error(
      `The curve has not filled yet. Fill it: npm run juno:trade -- --token ${token} --fill --yes`,
    );
  }
  if (!flag("yes")) {
    console.log("\nReady to graduate. Add --yes to send it.");
    return;
  }

  await requireBalance(account.address, 5n * 10n ** 16n, "graduation's gas");
  const receipt = await send(account, buildGraduateCall({ token, launchpad: snapshot.launchpad }));
  const graduated = launchpadEvents(receipt, snapshot.launchpad).find((event) => event.eventName === "Graduated");

  invalidatePoolSnapshot(token);
  console.log("\nGraduated.\n");
  line("tx", explorer.tx(receipt.transactionHash));
  if (graduated && graduated.eventName === "Graduated") {
    line("pair", explorer.address(graduated.args.venue));
    line("seeded", `${amount(graduated.args.baseAmount, 18, "tokens")} + ${amount(graduated.args.quoteAmount, quote.decimals, quote.symbol)}`);
    line("LP minted", graduated.args.liquidity.toString());
    line("burned", amount(graduated.args.burned, 18, "tokens"));
  }
}

run(main);
