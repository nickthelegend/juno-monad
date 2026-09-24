import { getAddress, isAddress, zeroAddress, type Address, type Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";

/**
 * Which Monad network Juno talks to, where its contracts live, and how to link
 * to them.
 *
 * Testnet is the default on purpose: a launch is permanent, and rehearsing the
 * whole lifecycle — launch, trade, fill, graduate, claim — costs nothing there.
 * Switching to mainnet is `NEXT_PUBLIC_MONAD_NETWORK=mainnet` plus the
 * addresses of a mainnet deployment; nothing in the code is testnet-specific.
 */

export type Network = "testnet" | "mainnet";

export function network(): Network {
  return process.env.NEXT_PUBLIC_MONAD_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

export function isMainnet(): boolean {
  return network() === "mainnet";
}

/**
 * The value stored in every row's `network` column. Distinct per chain so a
 * database shared between environments cannot mix them.
 */
export function networkKey(): string {
  return isMainnet() ? "monad" : "monad-testnet";
}

export function chain(): Chain {
  return isMainnet() ? monad : monadTestnet;
}

export function chainId(): number {
  return chain().id;
}

/**
 * The public endpoints are rate-limited, and a live demo hits them in bursts.
 * A dedicated RPC (Alchemy, QuickNode, Dwellir…) belongs in `MONAD_RPC_URL`.
 * Falling back is deliberate — it keeps local development working without
 * credentials.
 */
export function rpcEndpoint(): string {
  return (
    process.env.MONAD_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_MONAD_RPC_URL?.trim() ||
    chain().rpcUrls.default.http[0]
  );
}

/**
 * Whether the server's RPC is a node on this machine: an anvil fork of Monad
 * testnet in development. Timings measured there are the fork's, not Monad's,
 * so the app must not present them as Monad's.
 */
export function localFork(): boolean {
  try {
    const host = new URL(rpcEndpoint()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  } catch {
    return false;
  }
}

export function usingPublicRpc(): boolean {
  return !process.env.MONAD_RPC_URL?.trim() && !process.env.NEXT_PUBLIC_MONAD_RPC_URL?.trim();
}

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

function envAddress(name: string): Address | null {
  const value = process.env[name]?.trim();
  return value && isAddress(value) ? getAddress(value) : null;
}

/**
 * The Juno launchpad. Null until one is deployed and configured — every read
 * and every route checks, and says so, rather than calling the zero address.
 */
export function launchpadAddress(): Address | null {
  return envAddress("NEXT_PUBLIC_JUNO_LAUNCHPAD");
}

export function requireLaunchpad(): Address {
  const address = launchpadAddress();
  if (!address) {
    throw new Error(
      "NEXT_PUBLIC_JUNO_LAUNCHPAD is not set. Deploy the launchpad (contracts/script/Deploy.s.sol) and set its address.",
    );
  }
  return address;
}

/**
 * The block the launchpad was deployed in — where the log scan starts. Zero
 * falls back to a recent window rather than scanning from genesis.
 */
export function launchpadDeployBlock(): bigint {
  const raw = process.env.JUNO_LAUNCHPAD_DEPLOY_BLOCK?.trim();
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

/**
 * The Kuru venue's graduator: a launch may choose to graduate into a Kuru
 * order-book market instead of the default Uniswap v2 pair. Null when this
 * deployment has none — always on mainnet, where Kuru's Router lets only
 * Kuru's own Safe create markets.
 */
export function kuruGraduatorAddress(): Address | null {
  return envAddress("JUNO_KURU_GRADUATOR");
}

/** Native MON, as the launchpad spells it. */
export const NATIVE: Address = zeroAddress;

/* ------------------------------------------------------------------ */
/* Explorer links — the proof a judge clicks                           */
/* ------------------------------------------------------------------ */

/**
 * MonadVision on both networks: it serves testnet and mainnet under parallel
 * paths, verifies contracts through Sourcify, and decodes the launchpad's
 * events once it is verified.
 */
function explorerBase(): string {
  return isMainnet() ? "https://monadvision.com" : "https://testnet.monadvision.com";
}

export const explorer = {
  tx: (hash: string) => `${explorerBase()}/tx/${hash}`,
  address: (address: string) => `${explorerBase()}/address/${address}`,
  token: (address: string) => `${explorerBase()}/token/${address}`,
};
