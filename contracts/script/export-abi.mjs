#!/usr/bin/env node
// Writes the ABIs the app and scripts use to lib/juno/abi.ts, as `const`
// literals so viem infers argument and return types from them.
//
//   cd contracts && forge build && node script/export-abi.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");
const target = join(here, "..", "..", "lib", "juno", "abi.ts");

const contracts = [
  ["junoLaunchpadAbi", "JunoLaunchpad.sol/JunoLaunchpad.json"],
  ["junoTokenAbi", "JunoToken.sol/JunoToken.json"],
  ["uniswapV2GraduatorAbi", "UniswapV2Graduator.sol/UniswapV2Graduator.json"],
];

let body = `/**
 * Contract ABIs, generated from the Foundry build. Do not edit by hand:
 *
 *   cd contracts && forge build && node script/export-abi.mjs
 */

`;
for (const [name, file] of contracts) {
  const { abi } = JSON.parse(readFileSync(join(out, file), "utf8"));
  body += `export const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n\n`;
}
writeFileSync(target, body);
console.log(`wrote ${target}`);
