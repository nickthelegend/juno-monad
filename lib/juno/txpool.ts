/**
 * Monad's transaction pool, asked directly.
 *
 * `eth_getTransactionByHash` on Monad does not return a transaction that is
 * not in a block yet, so "is it pending, dropped, or unknown?" is a separate,
 * Monad-only question: `txpool_statusByHash`, and `txpool_statusByAddress`
 * for everything one address has in flight. A local anvil fork has neither
 * method, and the answer says so rather than guessing.
 */

export type TxpoolStatus =
  | { supported: false }
  | { supported: true; status: "unknown" }
  | { supported: true; status: string; reason: string | null };

type RpcAnswer = { result?: unknown; error?: { code?: number; message?: string } };

/** Read one `txpool_statusByHash` answer. */
export function readStatus(answer: RpcAnswer): TxpoolStatus {
  if (answer.error) {
    if (answer.error.code === -32601 || /not (found|supported)|does not exist/i.test(answer.error.message ?? "")) return { supported: false };
    if (/unknown tx/i.test(answer.error.message ?? "")) return { supported: true, status: "unknown" };
    return { supported: true, status: "error", reason: answer.error.message ?? null };
  }
  const result = answer.result as { status?: unknown; reason?: unknown } | string | null | undefined;
  if (typeof result === "string") return { supported: true, status: result, reason: null };
  if (result && typeof result.status === "string") {
    return { supported: true, status: result.status, reason: typeof result.reason === "string" ? result.reason : null };
  }
  return { supported: true, status: "unknown" };
}

/** Read one `txpool_statusByAddress` answer: nonce → status. Empty when nothing is in flight. */
export function readAddressStatus(answer: RpcAnswer): { supported: boolean; inFlight: Array<{ nonce: number; status: string }> } {
  if (answer.error) {
    if (answer.error.code === -32601 || /not (found|supported)|does not exist/i.test(answer.error.message ?? "")) return { supported: false, inFlight: [] };
    return { supported: true, inFlight: [] };
  }
  const result = (answer.result ?? {}) as Record<string, unknown>;
  const inFlight = Object.entries(result)
    .map(([nonce, value]) => ({
      nonce: Number(nonce),
      status: typeof value === "string" ? value : typeof (value as { status?: unknown })?.status === "string" ? String((value as { status: string }).status) : "unknown",
    }))
    .filter((entry) => Number.isFinite(entry.nonce))
    .sort((a, b) => a.nonce - b.nonce);
  return { supported: true, inFlight };
}

export async function askTxpool(rpcUrl: string, method: "txpool_statusByHash" | "txpool_statusByAddress", param: string): Promise<RpcAnswer> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [param] }),
    signal: AbortSignal.timeout(5_000),
  });
  return (await response.json()) as RpcAnswer;
}
