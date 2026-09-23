import "server-only";

/**
 * Rate limiting for the endpoints where abuse costs real money.
 *
 * Deliberately in-process: a fixed-window counter in a Map, no Redis, no extra
 * infrastructure to run. The tradeoff is honest — each serverless instance keeps
 * its own counter, so the effective limit is `limit × instances` and it resets
 * on cold start. That is a real weakness against a determined distributed
 * attacker, and it still turns "unbounded" into "bounded per instance", which is
 * the difference between one script draining your Replicate credit and one
 * script getting 10 requests in.
 *
 * If this app ever runs at a scale where that gap matters, swap the store for
 * Upstash/Redis behind the same `check()` signature — nothing else changes.
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
 * Outside production the limits are relaxed by this factor.
 *
 * The threat model is abuse by strangers, not a developer or an e2e suite
 * hammering their own dev server — throttling those only teaches people to
 * disable the limiter. The *logic* is covered directly in tests/unit/rate-limit,
 * so relaxing here costs no real coverage, and production is unaffected.
 */
function devMultiplier(): number {
  return process.env.NODE_ENV === "production" ? 1 : 50;
}

/**
 * Consume one token for `key`.
 *
 * @param key    Caller identity. Prefer a user id over an IP: IPs are shared
 *               (NAT, mobile carriers) and spoofable via forwarded headers.
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

/** Limits, named by what they protect rather than by number. */
export const LIMITS = {
  /** Moves real money out of the platform. */
  withdraw: { limit: 5, windowMs: 60_000 },
  /** Moves real money between users. */
  tip: { limit: 20, windowMs: 60_000 },
  /** Spends the platform's gas provisioning a wallet. */
  deposit: { limit: 10, windowMs: 60_000 },
  /** Each call spends real money at a paid vendor (Replicate). */
  blurIngest: { limit: 10, windowMs: 60_000 },
  /** Each token mints a paid ElevenLabs session. */
  voiceToken: { limit: 10, windowMs: 60_000 },
  /** Uploads cost storage and CPU (sharp). */
  upload: { limit: 20, windowMs: 60_000 },
} as const;

/**
 * 429 with Retry-After, or null when the caller is within limits.
 * Returning a Response (not throwing) keeps call sites a single early return.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Response | null {
  const result = check(key, limit * devMultiplier(), windowMs);
  if (result.ok) return null;
  return Response.json(
    { error: "Too many requests — slow down.", retryAfter: result.retryAfter },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}
