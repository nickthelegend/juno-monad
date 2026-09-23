import { junoError, junoHandler, junoJson, junoOptions, readJson } from "@/lib/juno/api";
import { networkKey } from "@/lib/juno/network";
import { getPool } from "@/lib/juno/registry";
import { addComment, listComments, MAX_COMMENT } from "@/lib/juno/social";
import { requireAddress, requireTxHash } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The Expo client is a different origin; the preflight has to answer. */
export const OPTIONS = junoOptions;

/** `GET ?coin={token}` — comments on a coin, newest first. */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const token = requireAddress(new URL(request.url).searchParams.get("coin") ?? "", "coin");
    return junoJson({ comments: await listComments(token, networkKey()) });
  });
}

/**
 * `POST {token, wallet, body, side?, txHash?}`.
 *
 * `side` and `txHash` are what turn a comment into an announcement: the row
 * carries which way the trader went and the transaction that proves it, so the
 * claim is checkable by anyone on an explorer rather than asserted.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);

    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const token = requireAddress(body.token, "token");
    const wallet = requireAddress(body.wallet, "wallet");
    const text = str("body").trim();

    if (!text) return junoError("Comment is empty");
    if (text.length > MAX_COMMENT) return junoError(`Comment is over ${MAX_COMMENT} characters`);

    // Lowercased, the spelling the chain's logs use, so the feed can find the
    // note for a trade by the hash it read.
    const txHash =
      body.txHash === undefined || body.txHash === null || body.txHash === ""
        ? undefined
        : requireTxHash(body.txHash, "txHash");

    // Only coins Juno actually launched can be commented on; otherwise this is
    // an open write endpoint keyed on an arbitrary string.
    const pool = await getPool(token);
    if (!pool) return junoError("No such coin", 404);

    const side = str("side");
    const comment = await addComment({
      token: pool.token,
      network: networkKey(),
      wallet,
      body: text,
      side: side === "buy" || side === "sell" ? side : undefined,
      txHash,
    });

    return junoJson({ comment }, { status: 201 });
  });
}
