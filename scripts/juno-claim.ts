/**
 * Claim a creator's accrued trading fees from the Juno launchpad on Monad.
 *
 *   npm run juno:claim -- --token 0x…            # show what is claimable
 *   npm run juno:claim -- --token 0x… --yes      # claim it to the script wallet
 *   npm run juno:claim -- --latest --to 0x… --yes
 *
 * Only the coin's creator can claim, so this signs with the same script key
 * `juno:launch` used. Built with `buildClaimCreatorFeesCall` — the path
 * `POST /api/juno/tx/claim` uses.
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { getAddress, isAddress } from "viem";

import { buildClaimCreatorFeesCall, fetchCreatorFees, fetchPoolSnapshot, invalidatePoolSnapshot } from "../lib/juno/launchpad";
import { explorer } from "../lib/juno/network";
import {
  amount,
  arg,
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

  const toArg = arg("to");
  if (toArg && !isAddress(toArg)) throw new Error(`--to ${toArg} is not an address`);
  const to = toArg ? getAddress(toArg) : account.address;

  const snapshot = await fetchPoolSnapshot(token);
  if (!snapshot) throw new Error(`${token} has no pool on this launchpad`);
  const { pool, quote } = snapshot;

  line("token", token);
  line("creator", pool.creator);
  line("claimable", amount(pool.creatorFees, quote.decimals, quote.symbol));
  line("claimed so far", amount(pool.creatorFeesClaimed, quote.decimals, quote.symbol));

  if (pool.creator !== account.address) {
    throw new Error(`Only the creator (${pool.creator}) can claim; this key is ${account.address}.`);
  }
  if (pool.creatorFees === 0n) {
    console.log("\nNothing to claim yet.");
    return;
  }
  if (!flag("yes")) {
    console.log(`\nAdd --yes to claim to ${to}.`);
    return;
  }

  await requireBalance(account.address, 10n ** 16n, "the claim's gas");
  const receipt = await send(
    account,
    buildClaimCreatorFeesCall({ token, to, launchpad: snapshot.launchpad }),
  );
  const claimed = launchpadEvents(receipt, snapshot.launchpad).find((event) => event.eventName === "CreatorFeesClaimed");

  invalidatePoolSnapshot(token);
  const after = await fetchCreatorFees(token).catch(() => null);
  console.log("\nClaimed.\n");
  line("tx", explorer.tx(receipt.transactionHash));
  if (claimed && claimed.eventName === "CreatorFeesClaimed") {
    line("paid", `${amount(claimed.args.amount, quote.decimals, quote.symbol)} to ${claimed.args.to}`);
  }
  line("remaining", after ? `${after.quoteAmount} ${quote.symbol}` : "?");
}

run(main);
