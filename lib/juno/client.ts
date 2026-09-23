import { createPublicClient, http, type PublicClient } from "viem";

import { chain, rpcEndpoint } from "./network";
import { gatedFetch } from "./rpc";

/**
 * The one read client every server path shares.
 *
 * Multicall batching is on, so the dozen `readContract` calls a coin page makes
 * in one tick go out as a single `eth_call` to Multicall3 rather than a dozen
 * requests against a rate-limited endpoint. Transport retries are off: the
 * callers that can survive a refusal retry through `withRetry`, with a budget
 * each chooses, and the ones that cannot should fail fast.
 */
let cached: PublicClient | null = null;

export function publicClient(): PublicClient {
  cached ??= createPublicClient({
    chain: chain(),
    transport: http(rpcEndpoint(), {
      fetchFn: gatedFetch,
      retryCount: 0,
      timeout: 20_000,
    }),
    batch: { multicall: { wait: 16 } },
  }) as PublicClient;
  return cached;
}
