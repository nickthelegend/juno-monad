/**
 * Writes contracts/test/fixtures/PresetFixtures.sol: every curve preset, built
 * by the app's own builder (`lib/juno/curves.ts`), for both quote tokens —
 * together with the totals the TypeScript port of CurveMath says the
 * launchpad will compute for it.
 *
 * `contracts/test/PresetParity.t.sol` launches each one on the real contract
 * and asserts the chain agrees to the wei. Regenerate after touching the
 * presets, the builder or curve-math.ts, then run the parity suite:
 *
 *   npx tsx scripts/curve-fixtures.ts          (from anywhere in the repo)
 *   cd contracts && forge test --match-contract PresetParity
 *
 * The output is deterministic (no timestamps), so an unchanged builder
 * produces an unchanged file and a changed one shows up in the diff.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURVE_PRESETS,
  CURVE_SEGMENTS,
  PRESET_INDEX,
  buildPresetParams,
  validateCurveParams,
  type CurveParams,
} from "../lib/juno/curves";
import type { CurvePresetId } from "../lib/juno/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "contracts", "test", "fixtures", "PresetFixtures.sol");

/**
 * The two quote configurations the app launches with: ~$1k → $25k FDV.
 * MON is priced at $0.025, so the MON caps are 40,000 → 1,000,000 MON.
 */
const QUOTES = [
  { key: "Mon", label: "MON", decimals: 18, initialMarketCap: 40_000, migrationMarketCap: 1_000_000 },
  { key: "Usdc", label: "USDC", decimals: 6, initialMarketCap: 1_000, migrationMarketCap: 25_000 },
] as const;

const PRESETS = Object.keys(CURVE_PRESETS) as CurvePresetId[];

type Case = {
  fn: string;
  label: string;
  preset: CurvePresetId;
  quote: (typeof QUOTES)[number];
  params: CurveParams;
};

function camel(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Fail here, not in forge, if a value would not fit its Solidity type. */
function fits(value: bigint, bits: number, what: string): string {
  if (value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${what} = ${value} does not fit uint${bits}`);
  return value.toString();
}

const cases: Case[] = [];
for (const preset of PRESETS) {
  for (const quote of QUOTES) {
    const params = buildPresetParams({
      preset,
      initialMarketCap: quote.initialMarketCap,
      migrationMarketCap: quote.migrationMarketCap,
      quoteDecimals: quote.decimals,
    });
    const problem = validateCurveParams(params);
    if (problem) throw new Error(`${preset}/${quote.label}: ${problem}`);
    if (params.curve.length !== CURVE_SEGMENTS) throw new Error(`${preset}/${quote.label}: not ${CURVE_SEGMENTS} ranges`);
    if (params.preset !== PRESET_INDEX[preset]) throw new Error(`${preset}: preset index mismatch`);
    cases.push({ fn: `${camel(preset)}${quote.key}`, label: `${preset} / ${quote.label}`, preset, quote, params });
  }
}

function fixtureFunction(c: Case): string {
  const p = c.params;
  const symbol = `${camel(c.preset).slice(0, 8).toUpperCase()}${c.quote.label}`.slice(0, 16);
  const lines = [
    `    function ${c.fn}() internal pure returns (Fixture memory f) {`,
    `        f.label = "${c.label}";`,
    `        f.quoteDecimals = ${c.quote.decimals};`,
    `        f.initialMarketCap = ${c.quote.initialMarketCap};`,
    `        f.migrationMarketCap = ${c.quote.migrationMarketCap};`,
    `        f.params.name = "Parity ${c.label}";`,
    `        f.params.symbol = "${symbol}";`,
    `        f.params.uri = "ipfs://parity";`,
    `        f.params.preset = ${fits(BigInt(p.preset), 8, "preset")};`,
    `        f.params.sqrtStartPriceX96 = ${fits(p.sqrtStartPriceX96, 160, "sqrtStartPriceX96")};`,
  ];
  p.curve.forEach((segment, i) => {
    const sqrt = fits(segment.sqrtPriceX96, 160, `curve[${i}].sqrtPriceX96`);
    const liquidity = fits(segment.liquidity, 128, `curve[${i}].liquidity`);
    lines.push(`        f.params.curve[${i}] = seg(${sqrt}, ${liquidity});`);
  });
  lines.push(
    `        f.params.startFeeBps = ${fits(BigInt(p.startFeeBps), 16, "startFeeBps")};`,
    `        f.params.endFeeBps = ${fits(BigInt(p.endFeeBps), 16, "endFeeBps")};`,
    `        f.params.feeDecaySeconds = ${fits(BigInt(p.feeDecaySeconds), 32, "feeDecaySeconds")};`,
    `        f.params.feeDecayWad = ${fits(p.feeDecayWad, 64, "feeDecayWad")};`,
    `        f.curveBase = ${p.totals.curveBase};`,
    `        f.threshold = ${p.totals.threshold};`,
    `        f.migrationBase = ${p.totals.migrationBase};`,
    `    }`,
  );
  return lines.join("\n");
}

const dispatch = cases.map((c, i) => `        if (i == ${i}) return ${c.fn}();`).join("\n");

const source = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// GENERATED FILE — do not edit by hand.
//
// Written by scripts/curve-fixtures.ts from the app's curve builder
// (lib/juno/curves.ts, buildPresetParams) and its bigint CurveMath port
// (lib/juno/curve-math.ts). Regenerate from the repo root with:
//
//     npx tsx scripts/curve-fixtures.ts
//
// The file is committed, so \`forge test\` needs no Node, npm or network: it is
// only the generator that does. Every preset appears twice — native MON
// (18 decimals, 40,000 → 1,000,000 MON FDV, ~$1k → $25k at $0.025) and USDC
// (6 decimals, 1,000 → 25,000 USDC FDV). \`curveBase\`, \`threshold\` and
// \`migrationBase\` are what the TypeScript side predicts the launchpad will
// compute; PresetParity.t.sol checks the chain agrees exactly.

import {JunoLaunchpad} from "../../src/JunoLaunchpad.sol";

library PresetFixtures {
    struct Fixture {
        string label;
        /// @dev 18 = native MON (quote address(0)); 6 = USDC.
        uint8 quoteDecimals;
        /// @dev FDV at the start and at the top of the curve, in whole quote tokens.
        uint256 initialMarketCap;
        uint256 migrationMarketCap;
        /// @dev \`launch\` arguments. \`quote\` is left zero; the test sets it.
        JunoLaunchpad.LaunchParams params;
        /// @dev TypeScript's prediction of the launchpad's own totals.
        uint256 curveBase;
        uint256 threshold;
        uint256 migrationBase;
    }

    uint256 internal constant COUNT = ${cases.length};

    function get(uint256 i) internal pure returns (Fixture memory) {
${dispatch}
        revert("PresetFixtures: no such fixture");
    }

    /// @dev One range: its upper sqrt price (Q64.96) and its liquidity.
    function seg(uint160 sqrt, uint128 liquidity) private pure returns (JunoLaunchpad.Segment memory) {
        return JunoLaunchpad.Segment({sqrtPriceX96: sqrt, liquidity: liquidity});
    }

${cases.map(fixtureFunction).join("\n\n")}
}
`;

mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, source);

console.log(`wrote ${path.relative(process.cwd(), target)}`);
for (const c of cases) {
  const t = c.params.totals;
  console.log(
    `  ${c.label.padEnd(20)} threshold ${t.threshold.toString().padStart(28)}  curveBase ${t.curveBase}  migrationBase ${t.migrationBase}`,
  );
}
