import { junoJson, junoOptions } from "@/lib/juno/api";
import { QUOTE_TOKENS } from "@/lib/juno/launchpad";
import { chain, chainId, explorer, launchpadAddress, network, networkKey } from "@/lib/juno/network";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Which chain this server talks to, and where to look things up on it.
 *
 * `GET` → `{ network, chainId, rpcUrl, launchpad, explorer, quoteTokens, faucet }`.
 *
 * The app reads this once at start rather than compiling any of it in, so one
 * build can follow a server from testnet to mainnet. Nothing here is a secret
 * and nothing is read from the chain — it cannot fail on a busy RPC.
 *
 * `rpcUrl` is the *public* endpoint: `NEXT_PUBLIC_MONAD_RPC_URL` when set,
 * otherwise the chain's default. `MONAD_RPC_URL` is never sent — it is the
 * server's dedicated endpoint and usually carries an API key in its path.
 *
 * `explorer` is the base URL; links are `${explorer}/tx/${hash}`,
 * `/address/${a}` and `/token/${t}`. `launchpad` is null on a server that has
 * not been pointed at a deployment, which is also why every build route
 * answers 503 there.
 */
export async function GET() {
  return junoJson({
    network: networkKey(),
    chainId: chainId(),
    rpcUrl: process.env.NEXT_PUBLIC_MONAD_RPC_URL?.trim() || chain().rpcUrls.default.http[0],
    launchpad: launchpadAddress(),
    // Derived from the one place explorer links are built, so the two cannot
    // point at different sites.
    explorer: explorer.tx("").replace(/\/tx\/$/, ""),
    quoteTokens: QUOTE_TOKENS,
    faucet: network() === "testnet",
  });
}
