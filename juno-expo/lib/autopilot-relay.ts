import { ApiError, juno, type AutopilotConfig, type AutopilotStatus, type SubmitResult, type UnsignedTransaction } from "./api";
import type { Signer } from "./wallet";

/**
 * What the app knows about autopilot per wallet, and the sponsored send.
 *
 * Kept apart from the hook (`autopilot.tsx`) so the wallet provider can ask
 * "does this trade go through autopilot?" without importing React state.
 */

const statuses = new Map<string, AutopilotStatus>();
const listeners = new Set<() => void>();

export function autopilotConfig(): AutopilotConfig | null {
  return juno.loadedConfig()?.autopilot ?? null;
}

export function cachedAutopilot(wallet: string | null): AutopilotStatus | null {
  return wallet ? (statuses.get(wallet.toLowerCase()) ?? null) : null;
}

export function rememberAutopilot(wallet: string, status: AutopilotStatus) {
  statuses.set(wallet.toLowerCase(), status);
  for (const listener of listeners) listener();
}

export function onAutopilot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sending through autopilot instead of signing, for a Privy wallet whose
 * autopilot is on while Privy sponsors gas: the person needs no MON. Null
 * when that does not apply, and the trade is signed as usual.
 */
export function sponsoredSend(signer: Signer): ((steps: UnsignedTransaction[]) => Promise<SubmitResult[]>) | null {
  const config = autopilotConfig();
  if (!config?.sponsor || signer.mode !== "privy" || !signer.accessToken) return null;
  if (cachedAutopilot(signer.address)?.status !== "active") return null;
  return async (steps) => {
    const accessToken = await signer.accessToken!();
    if (!accessToken) throw new Error("Your Privy session ended. Sign in again.");
    const { results } = await juno.autopilotSend({
      wallet: signer.address,
      accessToken,
      steps: steps.map((step) => ({ to: step.request.to, data: step.request.data, value: step.request.value, label: step.label })),
    });
    return results;
  };
}

/** Autopilot said no for a reason signing can get around: off, expired or busy. */
export function autopilotUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
