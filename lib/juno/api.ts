import "server-only";

/**
 * Shared plumbing for the mobile-facing API.
 *
 * The Expo client is a different origin from this server, so every route it
 * touches needs CORS. It is also a client we do not control the release cycle
 * of: once a build is on someone's phone it keeps calling whatever it was
 * compiled against, which is why errors here are shaped consistently
 * (`{ error }`) rather than left to each route's improvisation.
 */

const CORS_HEADERS: Record<string, string> = {
  // The app is distributed as a native binary and an Expo dev client, neither
  // of which has a stable web origin to allow-list. These routes are public
  // reads and unsigned transaction builders — nothing here is authorised by
  // the caller's origin, and the only state-changing route submits a
  // transaction that is already signed by a key we never see.
  "Access-Control-Allow-Origin": "*",
  // PATCH and DELETE are here because the plans route uses them: a preflight
  // that omits a method the route implements is a route the Expo client cannot
  // call from its own origin, and the failure looks like a network error rather
  // than a CORS one.
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export function junoJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

export function junoError(message: string, status = 400): Response {
  return junoJson({ error: message }, { status });
}

/** Preflight. Every mobile route re-exports this. */
export function junoOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * An error the caller caused and can fix — bad input, or a request the chain
 * will not honour ("this pool has graduated").
 *
 * This is a class rather than a pattern match on the message. Classifying by
 * regex looked fine until "Not a Monad address" came back as a 500, because it
 * happened not to contain any of the words the pattern looked for. The
 * distinction matters on a phone, where a 400 is worth showing the user and a
 * 500 is worth retrying — so it has to be stated at the throw site, not guessed
 * at the catch site.
 */
export class CallerError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CallerError";
    this.status = status;
  }
}

/** A public-RPC refusal, as opposed to a fault in this server. */
export function isRpcBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /429|rate limit|Too Many Requests|503|Connection rate limits/i.test(message);
}

/**
 * Run read-only work again when the RPC refused it.
 *
 * Monad's public RPC limits requests per IP, and a hosted server's egress IP is
 * shared, so it refuses in bursts that pass in a second or two. For the reads
 * and builds a person is waiting on, a short pause beats "try again". Only for
 * work that sends nothing: a retried build is a new unsigned transaction,
 * never a second submission.
 */
export async function retryWhenBusy<T>(run: () => Promise<T>, delays = [1_200, 2_500]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= delays.length || !isRpcBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * `junoHandler` for a read: a brief RPC refusal is waited out instead of being
 * answered with a 503. Only for handlers that change nothing.
 */
export function junoRead(run: () => Promise<Response>): Promise<Response> {
  return junoHandler(() => retryWhenBusy(run));
}

/** Run a handler, turning a thrown error into a clean 4xx/5xx. */
export async function junoHandler(
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CallerError) {
      return junoError(error.message, error.status);
    }
    // A throttled chain read is not a server fault and must not read like one.
    // Juno runs on the public RPC by choice; when it refuses, the honest answer
    // is "busy, try again", with a 503 so a client can retry rather than treat
    // it as broken. This used to surface as a flat 500 and took whole screens
    // down for a pool that was perfectly fine.
    if (isRpcBusy(error)) {
      // Logged, quietly. It is not a fault, but without it there is no way to
      // tell *which* read the endpoint refused.
      console.warn("[juno rpc busy]", error instanceof Error ? error.stack : error);
      return junoError(
        "The Monad RPC is rate-limiting us right now. Try again in a moment.",
        503,
      );
    }

    // Ours. Log it with the stack, and do not leak internals to the client —
    // a failed SQL statement is not something a phone should be shown.
    console.error("[juno api]", error);
    return junoError("Something went wrong on our side. Try again.", 500);
  }
}

/** Read and validate a JSON body without trusting its shape. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new CallerError("Invalid JSON body");
  }
}

export function requireString(value: unknown, field: string): string {
  // Sent but not text is a different mistake from not sent: telling a caller
  // who passed `issuedAt: 1790669000000` that it "is required" sends them
  // looking for a field they already have.
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new CallerError(`"${field}" must be a string`);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CallerError(`"${field}" is required`);
  }
  return value.trim();
}

export function requireNumber(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new CallerError(`"${field}" must be a number`);
  return n;
}
