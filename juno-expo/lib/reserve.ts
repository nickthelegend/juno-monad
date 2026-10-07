/**
 * Monad's reserve balance rule, as a trade sheet needs it.
 *
 * Monad executes three blocks behind consensus, so each account keeps a
 * reserve of 10 MON. A transaction whose value would leave the account below
 * min(10 MON, its balance before) reverts, with one exception: an account
 * that is not EIP-7702-delegated and has sent nothing in the last 3 blocks
 * (about 0.9 s at 300 ms a block) may dip below once. So a wallet holding
 * less than 10 MON can spend MON on a buy, but not twice within 0.9 s, and a
 * delegated one cannot end below 10 MON at all.
 */
export const RESERVE_MON = 10;
export const EMPTYING_WINDOW_MS = 3 * 300;

export type ReserveCheck =
  | { ok: true; rule: "above-reserve" | "no-value" }
  | { ok: true; rule: "emptying-allowed"; note: string }
  | { ok: false; rule: "too-soon" | "delegated"; note: string };

export function reserveCheck(input: {
  /** MON before the transaction. */
  balance: number;
  /** MON the transaction sends (its value), not gas. */
  value: number;
  /** When this account last sent a transaction, if known. */
  lastSentAt: number | null;
  /** The account carries an EIP-7702 delegation (code 0xef0100…). */
  delegated?: boolean;
  now?: number;
}): ReserveCheck {
  const now = input.now ?? Date.now();
  if (input.value <= 0) return { ok: true, rule: "no-value" };
  const floor = Math.min(RESERVE_MON, input.balance);
  if (input.balance - input.value >= floor) return { ok: true, rule: "above-reserve" };
  if (input.delegated) {
    return { ok: false, rule: "delegated", note: "This wallet is EIP-7702-delegated, and Monad never lets a delegated account end below its 10 MON reserve." };
  }
  if (input.lastSentAt !== null && now - input.lastSentAt < EMPTYING_WINDOW_MS) {
    return {
      ok: false,
      rule: "too-soon",
      note: "Wait a moment: under its 10 MON reserve, a wallet can spend on Monad once every 3 blocks (about 0.9 s).",
    };
  }
  return {
    ok: true,
    rule: "emptying-allowed",
    note: "Under 10 MON, Monad lets this wallet spend below its reserve once every 3 blocks (about 0.9 s).",
  };
}

/** When each wallet last sent, as this app saw it. */
const lastSent = new Map<string, number>();

export function recordSend(wallet: string, at = Date.now()): void {
  lastSent.set(wallet.toLowerCase(), at);
}

export function lastSendOf(wallet: string | null | undefined): number | null {
  return wallet ? (lastSent.get(wallet.toLowerCase()) ?? null) : null;
}
