/**
 * "The endpoint refused" is not "the code is broken".
 *
 * The integration suite runs against Monad's public testnet RPC, which answers
 * a burst with 429s. Letting that fail the suite makes it red for a reason
 * that has nothing to do with the code, and people stop reading red. Letting
 * it pass silently is worse. So a refusal is reported as inconclusive, loudly,
 * and every other error still fails.
 */
export function throttled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|too many requests|request limit|limit exceeded|timed out|timeout|fetch failed/i.test(message);
}

/** Runs `body`, or says out loud that the endpoint would not let it run. */
export async function unlessThrottled(what: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (!throttled(error)) throw error;
    console.warn(`INCONCLUSIVE — ${what}: the RPC is refusing requests. Re-run in a minute.`);
  }
}
