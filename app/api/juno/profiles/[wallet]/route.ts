import { getAddress, isAddress } from "viem";

import { hydratePools } from "@/lib/juno/chain";
import { CallerError, junoHandler, junoJson, junoOptions, junoRead, readJson, requireString } from "@/lib/juno/api";
import { networkKey } from "@/lib/juno/network";
import { identitiesFor } from "@/lib/juno/privy";
import { profileOf, saveDetails } from "@/lib/juno/profiles";
import { listPoolsByCreator } from "@/lib/juno/registry";
import { followStats } from "@/lib/juno/social-graph";
import { socialCounts } from "@/lib/juno/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /profiles/<wallet>?viewer=` — one creator's profile page, in one read.
 *
 * - who they are: name, bio and link (each null when never set), and an X
 *   account verified through Privy;
 * - the follow graph: followers, following, and whether `viewer` follows them
 *   (null without a viewer);
 * - what they launched: every listed coin they created, newest first, priced
 *   from the chain with its day change, likes and comment counts. `missing` counts coins the
 *   chain read could not price, so a grid that is short says so.
 *
 * What they hold is the portfolio route's job (`/portfolio/<wallet>`); the
 * profile does not read it twice.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  return junoRead(async () => {
    const { wallet: raw } = await params;
    if (!isAddress(raw)) throw new CallerError("That is not a Monad address.");
    const wallet = getAddress(raw);
    const viewerParam = new URL(request.url).searchParams.get("viewer");
    const viewer = viewerParam && isAddress(viewerParam) ? getAddress(viewerParam) : null;

    const [profile, graph, identities, rows] = await Promise.all([
      profileOf(wallet),
      followStats(wallet, viewer),
      // Optional: a read failure here must not cost the page.
      identitiesFor([wallet]).catch(() => ({}) as Awaited<ReturnType<typeof identitiesFor>>),
      listPoolsByCreator(wallet),
    ]);

    // With each coin's history: a creator has a handful of coins, and the grid
    // shows every one's day change, which only the trades can say.
    const { coins, missing } = await hydratePools(
      rows.filter((row) => row.listed),
      2,
      { history: true },
    );
    const counts = await socialCounts(
      coins.map((coin) => coin.address),
      networkKey(),
      viewer,
    ).catch(() => null);
    if (counts) {
      for (const coin of coins) {
        const entry = counts.get(coin.address);
        if (!entry) continue;
        coin.likes = entry.likes;
        coin.commentCount = entry.comments;
        coin.viewerLiked = entry.viewerLiked;
      }
    }

    return junoJson({
      network: networkKey(),
      ...profile,
      identity: identities[wallet] ?? null,
      followers: graph.followers,
      following: graph.following,
      viewerFollows: graph.viewerFollows,
      coins,
      missing,
    });
  });
}

/**
 * `POST /profiles/<wallet> {bio, link, issuedAt, signature}` — set the bio
 * and link.
 *
 * `signature` is an EIP-191 `personal_sign` of `detailsMessage(wallet, bio,
 * link, issuedAt)` by the wallet itself. An empty string clears either one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  return junoHandler(async () => {
    const { wallet } = await params;
    const body = await readJson<Record<string, unknown>>(request);
    const bio = typeof body.bio === "string" ? body.bio : "";
    const link = typeof body.link === "string" ? body.link : "";
    const result = await saveDetails({
      wallet,
      bio,
      link,
      issuedAt: requireString(body.issuedAt, "issuedAt"),
      signature: requireString(body.signature, "signature"),
    });
    return junoJson(result);
  });
}
