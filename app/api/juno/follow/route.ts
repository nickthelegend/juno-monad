import { junoError, junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { assertAddress, follow, followStats, following, unfollow } from "@/lib/juno/social-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * The social graph.
 *
 * `GET ?wallet=` returns that wallet's follower and following counts, the list
 * it follows, and — when `?viewer=` is given — whether the viewer follows it.
 * The viewer is a separate parameter rather than inferred from a session
 * because the mobile client has a device key and no session at all.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const url = new URL(request.url);
    const raw = url.searchParams.get("wallet") ?? "";
    if (!raw) return junoError("A wallet is required");
    const wallet = assertAddress(raw);

    const [stats, targets] = await Promise.all([
      followStats(wallet, url.searchParams.get("viewer")),
      following(wallet),
    ]);

    // `stats.following` is a count and `targets` is the list; spreading stats
    // last would have one silently overwrite the other.
    return junoJson({ wallet, ...stats, followingList: targets });
  });
}

/** `POST {follower, target, following: boolean}` — idempotent both ways. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const follower = requireString(body.follower, "follower");
    const target = requireString(body.target, "target");
    const on = body.following !== false;

    if (on) await follow(follower, target);
    else await unfollow(follower, target);

    // The fresh counts come back with the write, so the button does not need a
    // second round trip to show the number it just changed.
    const stats = await followStats(target, follower);
    // `stats.following` is the target's own following count; `isFollowing` is
    // the relationship the caller just changed. Two different numbers that one
    // key was quietly collapsing.
    return junoJson({ target: assertAddress(target, "target"), isFollowing: on, ...stats }, { status: 200 });
  });
}
