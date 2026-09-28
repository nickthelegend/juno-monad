import { createEffect, S, type EvmOnEventContext } from "envio";

import { ZERO_ADDRESS } from "./math";

/**
 * Decimals of a pool's quote token.
 *
 * The launchpad only prices in quotes its owner allowed, and the ones Juno uses
 * are known: native MON (the zero address) and Circle's USDC. Anything else is
 * read once with `decimals()` through an Effect, which batches, memoises and
 * caches the call, and falls back to 18 (uncached, so a later run retries) if
 * the RPC cannot answer.
 */

const KNOWN_DECIMALS: Record<number, Record<string, number>> = {
  // Monad testnet
  10143: {
    [ZERO_ADDRESS]: 18,
    "0x534b2f3a21130d7a60830c2df862319e593943a3": 6, // USDC
  },
  // Monad mainnet
  143: {
    [ZERO_ADDRESS]: 18,
    "0x754704bc059f8c67012fed69bc8a327a5aafb603": 6, // USDC
  },
};

function rpcUrl(chainId: number): string | undefined {
  if (chainId === 10143) return process.env.ENVIO_MONAD_TESTNET_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";
  if (chainId === 143) return process.env.ENVIO_MONAD_RPC_URL?.trim() || "https://rpc.monad.xyz";
  return undefined;
}

const FALLBACK_DECIMALS = 18;

/** `decimals()` selector. */
const DECIMALS_CALL = "0x313ce567";

export const readDecimals = createEffect(
  {
    name: "erc20Decimals",
    input: S.string,
    output: S.number,
    rateLimit: { calls: 5, per: "second" },
    cache: true,
    crossChain: false,
  },
  async ({ input, context }) => {
    const url = rpcUrl(context.chain.id);
    try {
      if (!url) throw new Error(`no RPC configured for chain ${context.chain.id}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: input, data: DECIMALS_CALL }, "latest"],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as { result?: string; error?: { message?: string } };
      if (!body.result || body.result === "0x") throw new Error(body.error?.message ?? "empty result");
      const decimals = Number(BigInt(body.result));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`implausible decimals ${decimals}`);
      return decimals;
    } catch (error) {
      context.cache = false;
      context.log.warn(`decimals() failed for quote ${input}; assuming ${FALLBACK_DECIMALS}`, {
        err: error instanceof Error ? error.message : String(error),
      });
      return FALLBACK_DECIMALS;
    }
  },
);

export async function quoteDecimals(context: Pick<EvmOnEventContext, "effect">, chainId: number, quote: string): Promise<number> {
  const known = KNOWN_DECIMALS[chainId]?.[quote.toLowerCase()];
  if (known !== undefined) return known;
  return context.effect(readDecimals, quote);
}

/**
 * Wrapped MON per chain: the other side of a MON-quoted coin's v2 pair.
 * (`Deploy.s.sol` uses the same addresses.)
 */
const WRAPPED_NATIVE: Record<number, string> = {
  10143: "0xfb8bf4c1cc7a94c73d209a149ea2abea852bc541",
  143: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
};

/**
 * Kuru's MarginAccount per chain. A coin that will graduate into Kuru locks
 * this address at launch instead of a v2 pair, so it is never a pair to index.
 */
const KURU_MARGIN_ACCOUNTS: Record<number, string[]> = {
  10143: ["0xd029c2d98ff85d8f64799017fe00a59b1159ce02"],
  143: [],
};

/** The pair side a coin's quote sits on: WMON for native MON, else the token itself. */
export function pairQuoteAddress(chainId: number, quote: string): string | null {
  if (quote.toLowerCase() !== ZERO_ADDRESS) return quote.toLowerCase();
  return WRAPPED_NATIVE[chainId] ?? null;
}

/**
 * Whether the address a launch locked is a Uniswap v2 pair: not the zero
 * address (no graduator), and not Kuru's MarginAccount (the Kuru venue).
 */
export function isV2Lock(chainId: number, venue: string): boolean {
  const lock = venue.toLowerCase();
  return lock !== ZERO_ADDRESS && !(KURU_MARGIN_ACCOUNTS[chainId] ?? []).includes(lock);
}

