import { NextResponse } from "next/server";

/**
 * The app's own IPFS gateway.
 *
 * Public gateways rate-limit, throttle, and go away — `gateway.pinata.cloud`
 * handed out 429s in the middle of a demo, and every tile that pointed at it
 * broke at once. This route fails over across gateways server-side, where the
 * client's network and rate-limit budget do not apply, and caches immutably:
 * content is addressed by hash, so a response can never go stale.
 *
 * Video seeking needs Range, which is forwarded to the upstream gateway.
 */

const FALLBACK_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.pinata.network/ipfs",
  "https://w3s.link/ipfs",
  "https://dweb.link/ipfs",
];

const CID_V0 = /^[1-9A-HJ-NP-Za-km-z]{44,46}$/;
const CID_V1 = /^b[a-z2-7]{58}$/;

function gateways(): string[] {
  const configured = process.env.NEXT_PUBLIC_IPFS_GATEWAY?.replace(/\/$/, "");
  const list = configured ? [configured, ...FALLBACK_GATEWAYS] : FALLBACK_GATEWAYS;
  return [...new Set(list)];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cid: string }> },
) {
  const { cid } = await params;
  if (!CID_V0.test(cid) && !CID_V1.test(cid)) {
    return NextResponse.json({ error: "Not a content hash" }, { status: 400 });
  }

  const range = request.headers.get("range");

  for (const gateway of gateways()) {
    try {
      const response = await fetch(`${gateway}/${cid}`, {
        headers: range ? { range } : undefined,
        signal: AbortSignal.timeout(30_000),
        // Content is immutable; one fetch per cold instance is the budget.
        cache: "no-store",
      });

      // 206 keeps a video's Range request valid; a 200 on a ranged request
      // means the upstream ignored it — still fine to stream from zero.
      if (!response.ok && response.status !== 206) continue;

      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/octet-stream",
          "content-length": response.headers.get("content-length") ?? "",
          ...(response.headers.get("content-range")
            ? { "content-range": response.headers.get("content-range")! }
            : {}),
          "accept-ranges": "bytes",
          // A hash-addressed response is immutable for as long as the bytes exist.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // Try the next gateway. If they all fail, fall through.
    }
  }

  return NextResponse.json({ error: "No gateway could serve this content" }, { status: 502 });
}
