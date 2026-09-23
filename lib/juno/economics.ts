import { FEE_PERIODS } from "./curves";
import { curveTotals, type RawSegment } from "./curve-math";

/**
 * The economics a pool was launched with, read back off the chain.
 *
 * Juno's presets promise two things a trader cannot otherwise verify: that the
 * opening fee decays to an equity-like spread, and that supply is split a
 * particular way between the curve, the AMM and the rounding buffer. Both are
 * fixed in the launchpad's pool record; this reads them rather than repeating
 * the preset's own marketing.
 */

export type FeePoint = { period: number; bps: number };

export type FeeSchedule = {
  /** Fee right now, in basis points. */
  currentBps: number;
  startBps: number;
  endBps: number;
  /** Periods elapsed since launch. */
  period: number;
  totalPeriods: number;
  /** Seconds until the fee reaches its floor; 0 once it has. */
  secondsRemaining: number;
  /** Sampled curve for plotting. */
  points: FeePoint[];
  mode: "linear" | "exponential";
};

/** The pool fields the fee schedule depends on, as `getPool` returns them. */
export type FeeFields = {
  startFeeBps: number;
  endFeeBps: number;
  feeDecaySeconds: number;
  feeDecayWad: bigint;
  /** Unix seconds. */
  launchedAt: number;
};

/** `JunoLaunchpad._feePpm`, in basis points and floating point. */
function bpsAt(fields: FeeFields, period: number): number {
  if (fields.startFeeBps === fields.endFeeBps || fields.feeDecaySeconds === 0) return fields.endFeeBps;
  if (period >= FEE_PERIODS) return fields.endFeeBps;
  const factor = 1 - Number(fields.feeDecayWad) / 1e18;
  return Math.max(fields.endFeeBps, fields.startFeeBps * Math.pow(factor, period));
}

export function feeSchedule(fields: FeeFields, nowSeconds = Math.floor(Date.now() / 1000)): FeeSchedule | null {
  if (!(fields.startFeeBps > 0)) return null;
  const periodSeconds = Math.max(1, Math.floor(fields.feeDecaySeconds / FEE_PERIODS));
  const elapsed = Math.max(0, nowSeconds - fields.launchedAt);
  const period = Math.min(FEE_PERIODS, Math.floor(elapsed / periodSeconds));

  const sampleCount = 32;
  const points: FeePoint[] = Array.from({ length: sampleCount + 1 }, (_, i) => {
    const p = Math.round((i / sampleCount) * FEE_PERIODS);
    return { period: p, bps: bpsAt(fields, p) };
  });

  return {
    currentBps: bpsAt(fields, period),
    startBps: fields.startFeeBps,
    endBps: fields.endFeeBps,
    period,
    totalPeriods: FEE_PERIODS,
    secondsRemaining: Math.max(0, FEE_PERIODS * periodSeconds - elapsed),
    points,
    mode: "exponential",
  };
}

export type Tokenomics = {
  totalSupply: number;
  /** Sold along the bonding curve. */
  curveAmount: number;
  /** Seeded into the AMM pair at graduation. */
  migrationAmount: number;
  /** The rounding buffer, burned at graduation. */
  leftoverAmount: number;
  curvePct: number;
  migrationPct: number;
  leftoverPct: number;
};

/**
 * Where the supply actually goes.
 *
 * Computed from the curve with the contract's own arithmetic, so it holds
 * after trading and after graduation, when the pool's live reserves no longer
 * show the original split.
 */
export function tokenomics(params: {
  sqrtStartPriceX96: bigint;
  curve: RawSegment[];
  totalSupply: bigint;
  baseDecimals: number;
}): Tokenomics | null {
  if (params.totalSupply <= 0n) return null;
  const totals = curveTotals(params.sqrtStartPriceX96, params.curve);
  const scale = 10 ** params.baseDecimals;
  const total = Number(params.totalSupply) / scale;
  const curve = Number(totals.curveBase) / scale;
  const migration = Number(totals.migrationBase) / scale;
  const leftover = Math.max(0, total - curve - migration);
  return {
    totalSupply: total,
    curveAmount: curve,
    migrationAmount: migration,
    leftoverAmount: leftover,
    curvePct: curve / total,
    migrationPct: migration / total,
    leftoverPct: leftover / total,
  };
}
