/**
 * Seed creator posts for the social feed.
 *
 * The feed mixes real trades with what creators wrote. Trades come from the
 * chain and are only there if someone traded; posts have to exist. A demo that
 * opens on an empty feed reads as a broken app rather than a quiet one, so the
 * post half is what guarantees the first screen has something on it.
 *
 * Posts are attached to coins that actually exist on this network, so every
 * "about $TICKER" link resolves to a real market. Idempotent: a post whose text
 * is already in the feed is skipped.
 *
 *   npm run juno:seed-posts
 *   npm run juno:seed-posts -- --author 0x…
 *
 * Needs the app running (npm run dev), or NEXT_PUBLIC_SITE_URL pointing at a
 * deployment. Posts are attributed to `--author`, else to the script wallet —
 * the same key that launched the demo coins, so the feed's authors are
 * accounts that really did something. Nothing is signed.
 *
 * Talks to the app over HTTP rather than importing the data layer:
 * `lib/juno/posts.ts` and the registry are `server-only`, which throws outside
 * Next's bundler (see `scripts/lib/cli.ts`) — and going through the API means
 * the seed exercises the same endpoint the phone does.
 */

import { getAddress, isAddress } from "viem";

import { arg, line, run, scriptAccount } from "./lib/cli";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Written to be true about this project rather than to fill space. */
const GENERIC: string[] = [
  "Every post here is a market. Publishing one launches its own token on a bonding curve on Monad, and the curve is the price.",
  "The four curve presets are the actual work. A memecoin back-loads its liquidity so it graduates fast; an equity issuance front-loads it so early size fills at the issue price instead of gapping the print.",
  "Creator fees accrue in the launchpad contract and are claimable on-chain. Not a rev-share agreement — a transaction.",
  "When a curve fills, anyone can graduate it: its reserves move into an AMM pair at exactly the price the curve finished on, and it keeps trading after the app is gone.",
  "MON prices here come from Pyth's contract on Monad — the same number a Monad contract would read.",
];

/** Said about a specific coin, chosen by the preset it was launched with. */
const BY_PRESET: Record<string, string[]> = {
  "ipo-book": [
    "Opened $%s on the ipo-book curve: deep at both ends, thin in the middle. The opening gets absorbed, price is discovered mid-curve, and the last buyers do not pay a vertical.",
    "$%s is book-shaped on purpose. Sixteen ranges, weighted like an order book rather than a memecoin.",
  ],
  "thin-name": [
    "$%s uses the thin-name curve — liquidity front-loaded so early size fills at the issue price instead of gapping the print.",
    "Front-loaded weights on $%s. A newly tokenised low-float name needs depth at the open, not after it.",
  ],
  "tight-nav": [
    "$%s is on tight-nav: uniform weights, so it behaves like a spread rather than a launch. It is meant to track, not to moon.",
    "The NAV band on $%s is the point. A bonding curve has no idea what the underlying costs — Pyth is what closes that loop.",
  ],
  content: [
    "$%s is a post that happens to be tradable. Cheap to enter, steepens as attention arrives.",
    "Back-loaded curve on $%s — the content preset. Early buyers are genuinely early.",
  ],
};

type PoolRow = { token: string; symbol: string; curvePreset: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SITE}${path}`, init).catch(() => {
    throw new Error(`Could not reach ${SITE}. Start the app (npm run dev) or set NEXT_PUBLIC_SITE_URL.`);
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function main() {
  const authorArg = arg("author");
  if (authorArg && !isAddress(authorArg)) throw new Error(`--author ${authorArg} is not an address`);
  const author = authorArg ? getAddress(authorArg) : scriptAccount().address;
  line("app", SITE);
  line("author", author);

  const pools = (await api<{ pools: PoolRow[] }>("/api/juno/pools")).pools;
  if (pools.length === 0) {
    console.log("No coins on this network yet — launch one first with npm run juno:launch.");
    return;
  }

  // Do not seed twice. A feed with the same sentence four times looks worse
  // than an empty one.
  const existing = (await api<{ posts: Array<{ body: string }> }>("/api/juno/posts?limit=100")).posts;
  const seen = new Set(existing.map((row) => row.body));

  const planned: Array<{ body: string; token: string | null }> = GENERIC.map((body) => ({ body, token: null }));
  pools.slice(0, 6).forEach((pool, index) => {
    const options = BY_PRESET[pool.curvePreset] ?? BY_PRESET.content;
    planned.push({ body: options[index % options.length].replace("%s", pool.symbol), token: pool.token });
  });

  let written = 0;
  for (const post of planned) {
    if (seen.has(post.body)) continue;
    await api("/api/juno/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author, body: post.body, token: post.token }),
    });
    written += 1;
  }

  const total = (await api<{ posts: unknown[] }>("/api/juno/posts?limit=100")).posts;
  console.log(`\nSeeded ${written} new post(s); skipped ${planned.length - written} already present. ${total.length} in the feed.`);
}

run(main);
