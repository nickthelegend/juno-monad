import { NextResponse } from "next/server";

import { MAX_CACHED_BYTES, recallContent, rememberContent } from "@/lib/juno/ipfs-cache";

/**
 * The app's own IPFS gateway.
 *
 * Public gateways rate-limit, throttle, and go away — `gateway.pinata.cloud`
 * handed out 429s in the middle of a demo, and every tile that pointed at it
 * broke at once. This route fails over across gateways server-side, where the
 * client's network and rate-limit budget do not apply, and caches immutably:
 * content is addressed by hash, so a response can never go stale.
 *
 * It serves from memory first (`lib/juno/ipfs-cache.ts`): whatever this server
 * uploaded, and whatever it has already fetched. A photo posted a second ago
 * is not on most gateways yet, and a gateway's answer in that window is an
 * HTML error page or a JSON error — both of which a browser refuses to draw as
 * an image, leaving the creator's own post blank. Such answers are skipped,
 * not relayed.
 *
 * Video seeking needs Range, which is forwarded to the upstream gateway, or
 * answered from memory for content held here.
 */

const FALLBACK_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.pinata.network/ipfs",
  "https://w3s.link/ipfs",
  "https://dweb.link/ipfs",
];

const CID_V0 = /^[1-9A-HJ-NP-Za-km-z]{44,46}$/;
const CID_V1 = /^b[a-z2-7]{58}$/;

/** A gateway's error or interstitial page, never the content itself. */
const NOT_CONTENT = /^(text\/html|application\/json|text\/plain)/i;

const IMMUTABLE = "public, max-age=31536000, immutable";

function gateways(): string[] {
  const configured = process.env.NEXT_PUBLIC_IPFS_GATEWAY?.replace(/\/$/, "");
  const list = configured ? [configured, ...FALLBACK_GATEWAYS] : FALLBACK_GATEWAYS;
  return [...new Set(list)];
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a known length; null if unusable. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

function fromMemory(entry: { bytes: Uint8Array; type: string }, range: string | null): Response {
  const size = entry.bytes.byteLength;
  const span = range ? parseRange(range, size) : null;
  if (range && !span) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const body = span ? entry.bytes.subarray(span.start, span.end + 1) : entry.bytes;
  return new Response(body as BodyInit, {
    status: span ? 206 : 200,
    headers: {
      "content-type": entry.type,
      "content-length": String(body.byteLength),
      ...(span ? { "content-range": `bytes ${span.start}-${span.end}/${size}` } : {}),
      "accept-ranges": "bytes",
      "cache-control": IMMUTABLE,
    },
  });
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
  const held = recallContent(cid);
  if (held) return fromMemory(held, range);

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
      const type = response.headers.get("content-type") ?? "application/octet-stream";
      if (NOT_CONTENT.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }

      // Whole, and small enough to keep: read it once and serve it from
      // memory from now on.
      const length = Number(response.headers.get("content-length") ?? NaN);
      if (response.status === 200 && Number.isFinite(length) && length <= MAX_CACHED_BYTES) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        rememberContent(cid, bytes, type);
        return fromMemory({ bytes, type }, range);
      }

      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": type,
          "content-length": response.headers.get("content-length") ?? "",
          ...(response.headers.get("content-range")
            ? { "content-range": response.headers.get("content-range")! }
            : {}),
          "accept-ranges": "bytes",
          // A hash-addressed response is immutable for as long as the bytes exist.
          "cache-control": IMMUTABLE,
        },
      });
    } catch {
      // Try the next gateway. If they all fail, fall through.
    }
  }

  return NextResponse.json({ error: "No gateway could serve this content" }, { status: 502 });
}
