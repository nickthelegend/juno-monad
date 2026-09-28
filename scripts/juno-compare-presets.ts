/**
 * The four curve presets, measured side by side.
 *
 * Every preset is built by the same builder the launch route uses, opened at
 * the same valuation in the same quote token, so the only differences between
 * rows are the sixteen liquidity weights and the range each preset owns. That
 * is what the taglines claim — "deep at the issue price", "near-flat" — and
 * this measures it instead of asserting it.
 *
 * Pure maths over the curve's own ranges: no RPC, no pool, no transaction.
 *
 *   npx tsx scripts/juno-compare-presets.ts [--initial 1000] [--markdown]
 *
 * How the numbers are read: inside one range the curve is concentrated
 * liquidity, so the quote that moves the square-root price from a to b is
 * L·(b − a) — `quoteDelta`, the same function `JunoLaunchpad` validates with —
 * and a 1% price move is a √1.01 move in root price. The ranges sum to the
 * curve's `threshold`, which the contract recomputes at launch, so a wrong
 * scale cannot hide.
 */

import { CURVE_PRESET_LIST, buildPresetParams, type CurveParams, type CurvePreset } from "../lib/juno/curves";
import { quoteDelta, sqrtX96ToPrice, type RawSegment } from "../lib/juno/curve-math";

const QUOTE_DECIMALS = 6; // USDC: every quote figure below reads directly as dollars
const BASE_DECIMALS = 18;
const SCALE = 1_000_000n; // fixed point for √1.01 and √2

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const INITIAL = Number(arg("initial") ?? 1_000);
const MARKDOWN = process.argv.includes("--markdown");

const toUsd = (raw: bigint) => Number(raw) / 10 ** QUOTE_DECIMALS;
const ROOT_1PCT = BigInt(Math.round(Math.sqrt(1.01) * 1e6));

type Position = { sqrtP: bigint; segment: RawSegment };

/** Where the price sits once `raised` quote has come in. */
function positionAt(params: CurveParams, raised: bigint): Position {
  let lower = params.sqrtStartPriceX96;
  let left = raised;
  for (const segment of params.curve) {
    const inRange = quoteDelta(lower, segment.sqrtPriceX96, segment.liquidity, true);
    if (left <= inRange) {
      // Solve L·(s − lower)/2^96 = left for s.
      const sqrtP = lower + (left * (1n << 96n)) / segment.liquidity;
      return { sqrtP, segment };
    }
    left -= inRange;
    lower = segment.sqrtPriceX96;
  }
  const last = params.curve[params.curve.length - 1];
  return { sqrtP: last.sqrtPriceX96, segment: last };
}

/** Quote that moves the price 1% from a position (within its range). */
function onePercentAt({ sqrtP, segment }: Position): number {
  const target = (sqrtP * ROOT_1PCT) / SCALE;
  return toUsd(quoteDelta(sqrtP, target, segment.liquidity, true));
}

/** Quote it takes to take the price from the open to `multiple` times it, or null past the top. */
function quoteToMultiply(params: CurveParams, multiple: number): number | null {
  const target = (params.sqrtStartPriceX96 * BigInt(Math.round(Math.sqrt(multiple) * 1e6))) / SCALE;
  let lower = params.sqrtStartPriceX96;
  let total = 0n;
  for (const segment of params.curve) {
    const top = segment.sqrtPriceX96 < target ? segment.sqrtPriceX96 : target;
    total += quoteDelta(lower, top, segment.liquidity, true);
    if (segment.sqrtPriceX96 >= target) return toUsd(total);
    lower = segment.sqrtPriceX96;
  }
  return null;
}

type Row = {
  preset: CurvePreset;
  range: number;
  raised: number;
  startPrice: number;
  endPrice: number;
  onePct: number[]; // at 0, 25, 50, 75 and 99.9% of the raise
  spread: number; // most / least expensive 1% move along the curve
  toDouble: number | null;
};

function measure(preset: CurvePreset, range: number): Row {
  const params = buildPresetParams({
    preset: preset.id,
    initialMarketCap: INITIAL,
    migrationMarketCap: INITIAL * range,
    quoteDecimals: QUOTE_DECIMALS,
  });
  const threshold = params.totals.threshold;
  const points = [0, 0.25, 0.5, 0.75, 0.999].map((f) =>
    onePercentAt(positionAt(params, (threshold * BigInt(Math.round(f * 1000))) / 1000n)),
  );
  // Sample densely for the spread; the ends and range boundaries are where it peaks.
  const samples = Array.from({ length: 200 }, (_, i) =>
    onePercentAt(positionAt(params, (threshold * BigInt(i)) / 200n)),
  );
  const top = params.curve[params.curve.length - 1].sqrtPriceX96;
  return {
    preset,
    range,
    raised: toUsd(threshold),
    startPrice: sqrtX96ToPrice(params.sqrtStartPriceX96, BASE_DECIMALS, QUOTE_DECIMALS),
    endPrice: sqrtX96ToPrice(top, BASE_DECIMALS, QUOTE_DECIMALS),
    onePct: points,
    spread: Math.max(...samples) / Math.min(...samples),
    toDouble: quoteToMultiply(params, 2),
  };
}

const usd = (n: number | null) =>
  n === null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

// Each preset at its own range, and tight-nav once more at the widest range
// it accepts. A uniform curve's spread is √range, which is why tight-nav owns
// a narrow one: at 25x the same weights would spread 5x.
const rows = [
  ...CURVE_PRESET_LIST.map((preset) => measure(preset, preset.defaultCapMultiple)),
  ...CURVE_PRESET_LIST.filter((preset) => preset.maxCapMultiple !== undefined).map((preset) =>
    measure(preset, preset.maxCapMultiple!),
  ),
];

function table(title: string, rows: Row[]) {
  const head = ["preset", "range", "raises", "1% at open", "at 25%", "at 50%", "at 75%", "at close", "spread", "to double"];
  const body = rows.map((r) => [
    r.preset.id,
    `${r.range}x`,
    usd(r.raised),
    ...r.onePct.map(usd),
    `${r.spread.toFixed(2)}x`,
    usd(r.toDouble),
  ]);
  if (MARKDOWN) {
    console.log(`\n**${title}**\n`);
    console.log(`| ${head.join(" | ")} |`);
    console.log(`|${head.map(() => "---").join("|")}|`);
    for (const row of body) console.log(`| ${row.join(" | ")} |`);
  } else {
    console.log(`\n${title}`);
    const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
    const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    console.log(fmt(head));
    for (const row of body) console.log(fmt(row));
  }
}

table(`Each preset at its own range, opening at ${usd(INITIAL)} FDV in USDC`, rows);
console.log(
  "\n1% at …: USDC that moves the price 1% once that share of the graduation raise has come in." +
    "\nspread: the most expensive 1% move along the curve over the cheapest — 1.00x is perfectly flat." +
    "\nto double: USDC from the open to twice the opening price; — when the curve's top is below 2x.",
);
