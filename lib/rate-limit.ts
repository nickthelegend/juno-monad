import "server-only";

import { junoJson } from "@/lib/juno/api";

/**
 * Rate limiting for the endpoints where a stranger's requests cost Juno
 * something: the faucet (testnet MON) and IPFS pinning (Pinata storage, on the
 * project's key).
 *
 * Deliberately in-process: a fixed-window counter in a Map, no Redis, no extra
 * infrastructure to run. Each server instance keeps its own counter, so the
 * effective limit is `limit × instances` and it resets on restart. That is a
 * real weakness against a distributed attacker; it still turns "unbounded"
 * into "bounded per instance". Swap the store for Redis behind the same
 * `check()` signature if that gap ever matters.
 */

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

// Keep the map from growing without bound across a long-lived instance.
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
  // Still oversized (all windows live) — drop the oldest to bound memory.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED_KEYS / 2))) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window resets — for Retry-After. */
  retryAfter: number;
};

/**
 * The caller's address, as far as it can be known without trusting the caller.
 *
 * `x-forwarded-for` is a list the client can start: whatever it sends arrives
 * first, and each proxy appends the address it saw. The faucet took the first
 * entry, so sending a fresh header per request walked around its per-address
 * limit. What a proxy writes itself is trusted instead — the headers Fly,
 * Cloudflare and Vercel set, then the last `x-forwarded-for` entry, appended
 * by the proxy nearest the server. With no proxy at all every header is the
 * client's, and all of this is best effort; the per-wallet limits still hold.
 */
export function clientIp(headers: Headers): string {
  for (const name of ["fly-client-ip", "cf-connecting-ip", "x-vercel-forwarded-for"]) {
    const value = headers.get(name)?.split(",")[0]?.trim();
    if (value) return value;
  }
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}

/**
 * Consume one token for `key`.
 *
 * @param key    Caller identity. Prefer a wallet over an IP: IPs are shared
 *               (NAT, mobile carriers), and see `clientIp` on spoofing.
 * @param limit  Requests allowed per window.
 * @param windowMs Window length.
 */
export function check(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.max(Math.ceil((existing.resetAt - now) / 1000), 1);
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfter };
  }
  return { ok: true, remaining: limit - existing.count, retryAfter };
}

/** Limits, named by what they protect. Per client address, per window. */
export const LIMITS = {
  /** A photo or video pinned to IPFS on Juno's Pinata key. */
  upload: { limit: 20, windowMs: 10 * 60_000 },
  /** Token metadata pinned to IPFS on the same key. */
  metadata: { limit: 20, windowMs: 10 * 60_000 },
} as const;

/**
 * 429 with a sentence and Retry-After, or null when the caller is within
 * limits. Returning a Response (not throwing) keeps call sites a single early
 * return.
 */
export function rateLimit(
  request: Request,
  name: keyof typeof LIMITS,
): Response | null {
  const { limit, windowMs } = LIMITS[name];
  const result = check(`${name}:${clientIp(request.headers)}`, limit, windowMs);
  if (result.ok) return null;
  const minutes = Math.ceil(result.retryAfter / 60);
  // junoJson, not Response.json: without its CORS headers the browser hides
  // the 429 from the app, which could then only say "network error".
  return junoJson(
    { error: `Too many uploads from here. Try again in ${minutes} min.`, retryAfter: result.retryAfter },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}
