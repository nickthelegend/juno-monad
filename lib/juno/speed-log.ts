/**
 * The confirmation times this server measured, most recent last.
 *
 * Every transaction Juno submits is timed from broadcast to receipt
 * (`submitSigned`). The landing page shows the latest and the median of the
 * last twenty, so a visitor sees Monad's speed before they trade. Kept in
 * memory, per server process: a fresh process has measured nothing yet, and
 * says so rather than inventing a number.
 */
type Confirmation = { ms: number; at: number; block: number };

const KEEP = 20;
const shared = globalThis as typeof globalThis & { __junoConfirmations?: Confirmation[] };

function log(): Confirmation[] {
  shared.__junoConfirmations ??= [];
  return shared.__junoConfirmations;
}

export function recordConfirmation(ms: number, block: number, at = Date.now()): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const entries = log();
  entries.push({ ms: Math.round(ms), at, block });
  if (entries.length > KEEP) entries.splice(0, entries.length - KEEP);
}

export type ConfirmationSummary = { lastMs: number; lastAt: string; medianMs: number; samples: number } | null;

export function recentConfirmations(): ConfirmationSummary {
  const entries = log();
  if (entries.length === 0) return null;
  const sorted = entries.map((entry) => entry.ms).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const last = entries[entries.length - 1];
  return { lastMs: last.ms, lastAt: new Date(last.at).toISOString(), medianMs: median, samples: entries.length };
}

/** For tests. */
export function clearConfirmations(): void {
  log().length = 0;
}
