import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { chain } from "@/lib/juno/network";

/**
 * Juno uses Monad's canonical testnet contracts rather than copies of its own
 * (addresses from docs.monad.xyz and checked to have code on testnet,
 * 7 Oct 2026): WMON for the swap router, Circle's USDC as the USDC quote, and
 * Multicall3 for batched reads.
 */
const deployment = JSON.parse(readFileSync(path.resolve(__dirname, "../../contracts/deployments/10143.json"), "utf8"));

describe("canonical Monad testnet contracts", () => {
  it("routes through the canonical WMON", () => {
    expect(deployment.wmon).toBe("0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
  });

  it("quotes USDC markets in Circle's testnet USDC", () => {
    expect(deployment.usdc).toBe("0x534b2f3A21130d7a60830c2Df862319e593943A3");
  });

  it("batches reads through the canonical Multicall3", () => {
    expect(chain().contracts?.multicall3?.address).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
  });
});
