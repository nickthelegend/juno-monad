import { getAddress, isAddress } from "viem";

import { junoError, junoHandler, junoJson, junoOptions, readJson } from "@/lib/juno/api";
import { networkKey } from "@/lib/juno/network";
import { getPool } from "@/lib/juno/registry";
import { setLike, socialCounts } from "@/lib/juno/social";
import { requireAddress } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Likes on coins.
 *
 * `GET ?coins=a,b,c&viewer=` — counts for up to 60 coins, plus whether the
 * viewer liked each. `POST {token, wallet, liked}` — idempotent both ways.
 *
 * A like is social signal and nothing else: it moves no money and is not a
 * position. That is why it lives beside comments in Mongo and never near the
 * trade record.
 *
 * Addresses are checksummed on the way in, so the counts come back keyed by the
 * same spelling every `Coin.address` uses.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokens = [
    ...new Set(
      (url.searchParams.get("coins") ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter((token) => isAddress(token))
        .map((token) => getAddress(token)),
    ),
  ].slice(0, 60);
  const rawViewer = url.searchParams.get("viewer");
  if (rawViewer && !isAddress(rawViewer)) {
    return junoError("Not a Monad address: viewer");
  }
  const viewer = rawViewer ? getAddress(rawViewer) : null;
  try {
    const counts = await socialCounts(tokens, networkKey(), viewer);
    return junoJson({ counts: Object.fromEntries(counts) });
  } catch (error) {
    // Mongo absent or down. Market data never depends on this, so neither does
    // the status code a client uses to decide whether the screen works.
    console.warn("[juno likes]", error);
    return junoJson({ counts: {}, error: "Likes are unavailable right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const token = requireAddress(body.token, "token");
    const wallet = requireAddress(body.wallet, "wallet");

    // Only coins Juno launched; otherwise this is an open write keyed on any string.
    if (!(await getPool(token))) return junoError("No such coin", 404);

    // A boolean, not "anything but false": the string "false" liked a coin.
    if (typeof body.liked !== "boolean") return junoError('"liked" must be true or false');

    const result = await setLike({
      token,
      network: networkKey(),
      wallet,
      like: body.liked,
    });
    return junoJson({ token, ...result });
  });
}
