/**
 * Post fresh Pyth prices to Monad — the keeper for the NAV band.
 *
 * Pyth is a pull oracle on EVM chains: a price is on-chain once someone posts a
 * signed update. Pyth's sponsored pushes keep MON/USD current on Monad, but
 * nobody pushes equities, so the on-chain AAPL or NVDA mark an equity-preset
 * coin is measured against can be weeks old. This fetches signed updates from
 * Hermes (`pythUpdateCall` in `lib/juno/pyth.ts`) and posts them to Pyth's
 * contract, paying Pyth's update fee in MON.
 *
 *   npx dotenv -e .env.local -- tsx scripts/pyth-push.ts                 # show ages + fee
 *   npx dotenv -e .env.local -- tsx scripts/pyth-push.ts --yes           # post once
 *   npx dotenv -e .env.local -- tsx scripts/pyth-push.ts --yes --every 300
 *
 * Options:
 *   --feeds AAPL,NVDA | --feeds all   which feeds (default: every equity feed)
 *   --max-age <s>                     only post feeds whose on-chain mark is
 *                                     older than this (default 0: post all)
 *   --every <s>                       keep running, posting every <s> seconds
 *   --yes                             send (otherwise report and estimate only)
 *
 * Requires PYTH_API_KEY — Hermes has required a key since 2026-08-26, and
 * without one there is nothing signed to post. Signs with
 * JUNO_SCRIPT_PRIVATE_KEY or `.juno/launcher.key`.
 *
 * Imports only `lib/juno` modules without `server-only`, which throws outside
 * Next's bundler — see `scripts/lib/cli.ts`.
 */

import { encodeFunctionData, formatUnits, type Address, type Hex } from "viem";

import {
  PYTH_ABI,
  PYTH_FEEDS,
  pythUpdateCall,
  pythWriteContract,
  type PythFeedName,
} from "../lib/juno/pyth";
import {
  arg,
  describeError,
  estimate,
  flag,
  header,
  line,
  links,
  numberArg,
  requireBalance,
  run,
  scriptAccount,
  scriptReader,
  send,
} from "./lib/cli";

type Feed = { name: PythFeedName; id: string };

function selectedFeeds(): Feed[] {
  const all = (Object.keys(PYTH_FEEDS) as PythFeedName[]).map((name) => ({ name, id: PYTH_FEEDS[name] }));
  const wanted = arg("feeds");
  if (!wanted) return all.filter((feed) => feed.name.startsWith("Equity."));
  if (wanted === "all") return all;
  const tickers = wanted.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const picked = all.filter((feed) => tickers.some((t) => feed.name.toUpperCase().includes(`.${t}/`)));
  if (picked.length === 0) throw new Error(`No known feed matches --feeds ${wanted}`);
  return picked;
}

/** Seconds since each feed was last posted to the contract we write to, or null when it has never been. */
async function onChainAges(contract: Address, feeds: Feed[]): Promise<Map<string, number | null>> {
  const now = Math.floor(Date.now() / 1000);
  const ages = new Map<string, number | null>();
  for (const feed of feeds) {
    const reading = await scriptReader()
      .readContract({ address: contract, abi: PYTH_ABI, functionName: "getPriceUnsafe", args: [`0x${feed.id}` as Hex] })
      .catch(() => null);
    ages.set(feed.id, reading && reading.publishTime > 0n ? now - Number(reading.publishTime) : null);
  }
  return ages;
}

function age(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "never posted";
  if (seconds < 120) return `${seconds}s old`;
  if (seconds < 2 * 3600) return `${Math.round(seconds / 60)}m old`;
  if (seconds < 2 * 86400) return `${Math.round(seconds / 3600)}h old`;
  return `${Math.round(seconds / 86400)}d old`;
}

async function pushOnce(feeds: Feed[], maxAge: number, send_: boolean): Promise<void> {
  const account = scriptAccount();
  const contract = pythWriteContract();
  const before = await onChainAges(contract, feeds);
  for (const feed of feeds) line(feed.name, age(before.get(feed.id)));

  const due = feeds.filter((feed) => {
    const seconds = before.get(feed.id);
    return seconds === null || seconds === undefined || seconds > maxAge;
  });
  if (due.length === 0) {
    console.log(`\nEvery feed is fresher than ${maxAge}s. Nothing to post.`);
    return;
  }

  const update = await pythUpdateCall(due.map((feed) => feed.id));
  if (!update) throw new Error("Hermes returned no update. Check PYTH_API_KEY and PYTH_HERMES_URL.");
  const call = {
    to: update.to,
    data: encodeFunctionData({ abi: PYTH_ABI, functionName: "updatePriceFeeds", args: [update.data] }),
    value: update.fee,
    label: `Posting ${due.length} Pyth update(s)`,
  };
  line("posting", due.map((feed) => feed.name).join(", "));
  line("update fee", `${formatUnits(update.fee, 18)} MON`);

  if (!send_) {
    try {
      line("gas", (await estimate(account.address, call)).toString());
    } catch (error) {
      line("gas", `estimate failed: ${describeError(error)}`);
    }
    console.log("\nReport only. Add --yes to post.");
    return;
  }

  await requireBalance(account.address, update.fee + 5n * 10n ** 16n, "the update fee and gas");
  const receipt = await send(account, call);
  const after = await onChainAges(contract, due);
  console.log("");
  line("tx", links.tx(receipt.transactionHash));
  for (const feed of due) line(feed.name, `${age(before.get(feed.id))} → ${age(after.get(feed.id))}`);
}

async function main() {
  if (!process.env.PYTH_API_KEY?.trim()) {
    throw new Error(
      "PYTH_API_KEY is not set. Hermes needs a key to serve signed updates, and without one there is nothing to post.",
    );
  }
  const feeds = selectedFeeds();
  const maxAge = numberArg("max-age", 0)!;
  const every = numberArg("every");
  const send_ = flag("yes");

  const account = scriptAccount();
  header(account.address);
  line("pyth", links.address(pythWriteContract()));

  if (!every) {
    await pushOnce(feeds, maxAge, send_);
    return;
  }
  if (every < 10) throw new Error("--every must be at least 10 seconds");
  // Keeper mode: one failed round is logged, not fatal — the next may land.
  for (;;) {
    console.log(`\n[${new Date().toISOString()}]`);
    await pushOnce(feeds, maxAge, send_).catch((error: unknown) => {
      console.error(`round failed: ${error instanceof Error ? error.message : describeError(error)}`);
    });
    await new Promise((resolve) => setTimeout(resolve, every * 1000));
  }
}

run(main);
