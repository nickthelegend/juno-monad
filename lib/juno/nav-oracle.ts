import "server-only";

import { getAddress, isAddress, parseAbi, type Address } from "viem";

import { publicClient } from "./client";
import { ttlCache, withRetry } from "./rpc";
import type { NavAttestation } from "./types";

/**
 * What Chainlink CRE attested about a tracker coin, read from `JunoNavOracle`
 * on Monad (`contracts/src/cre/JunoNavOracle.sol`, written by `cre/juno-nav`).
 *
 * Juno's own NAV line is computed by this server. This is the same comparison
 * made by a Chainlink DON (the underlying's price agreed across nodes, the
 * curve read on chain) and written on chain, so it can be checked without
 * trusting Juno. Null when `JUNO_NAV_ORACLE` is not set or the coin has never
 * been attested.
 */

const abi = parseAbi([
  "struct Attestation { bytes32 feedId; uint256 navUsdE18; uint256 impliedUsdE18; int256 premiumBps; uint64 navPublishTime; uint64 observedAt; uint16 bandBps; bool withinBand; }",
  "function navOf(address token) view returns (Attestation)",
]);

export function navOracleAddress(): Address | null {
  const raw = process.env.JUNO_NAV_ORACLE?.trim();
  return raw && isAddress(raw) ? getAddress(raw) : null;
}

const cache = ttlCache<NavAttestation | null>(30_000);

export function attestedNav(token: string): Promise<NavAttestation | null> {
  const oracle = navOracleAddress();
  if (!oracle) return Promise.resolve(null);
  return cache.get(`${oracle}:${token}`, async () => {
    const a = await withRetry(() =>
      publicClient().readContract({ address: oracle, abi, functionName: "navOf", args: [getAddress(token)] }),
    );
    if (a.observedAt === 0n) return null;
    return {
      oracle,
      navUsd: Number(a.navUsdE18) / 1e18,
      impliedUsd: Number(a.impliedUsdE18) / 1e18,
      premium: Number(a.premiumBps) / 10_000,
      withinBand: a.withinBand,
      bandBps: a.bandBps,
      observedAt: new Date(Number(a.observedAt) * 1000).toISOString(),
    };
  });
}
